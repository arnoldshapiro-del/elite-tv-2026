/* 2026 Elite TV — Narrator (read-aloud).
   Arnie's STANDARD whole-page Narrator, copied from the canonical implementation in
   trend-check-pro/narrator.js. Only the four things listed below were changed.

   Reads the WHOLE visible page continuously; only stops on Pause or Stop.
   Floating bottom-right bar: Ava default voice + voice picker, pause/resume, stop,
   rewind 1m/30s/15s, forward 15s/30s/1m, speed slider. Includes the mandatory
   session-token triple-cancel stop-safety so Stop truly stops on Windows SAPI voices.

   ⭐ CLICK-TO-READ-FROM-HERE (Arnie's standard, 2026-07-16): clicking anywhere in the page
   text starts reading FROM THAT SPOT and continues to the end of the page. Clicking
   somewhere else while it's already reading jumps straight to the new spot and keeps
   going — no need to Stop first. Clicks on real controls (buttons/inputs/selects/links)
   and clicks that are really text-selections are ignored, so the app stays usable.

   App-specific adaptations vs. the trend-check-pro original:
   - localStorage keys use the `eliteTV` prefix, so speed and voice are remembered per app.
   - narrateRoot() is the `.app` container — the nav, the hero and whichever .section is
     showing. Inactive sections are display:none and the walker is visibility-aware, so
     only what is actually on screen gets read. The show/film modal sits outside .app on
     purpose: it is not read, and opening it stops the read instead.
   - CTRL_SEL carries this app's clickable cards and rows. Nearly every card, episode row,
     showtime and chip here is a div with an onclick handler, so a click on one must move
     the app, never start reading.
   - Auto-stop when the page changes underneath the voice: switching nav tabs (the
     .section elements swap their `active` class) or opening/closing the modal.
*/
(function () {
  "use strict";
  if (typeof window === "undefined") return;

  var LS_RATE = "eliteTV_tts_rate";
  var LS_VOICE = "eliteTV_tts_voice";
  var FEMALE = ["ava","aria","jenny","emma","michelle","nancy","sara","cora","monica","serena","libby","sonia","zira","samantha","susan","karen","catherine","hazel","female","natasha","clara","amber","ashley","jane","joanna","salli","kimberly"];

  var voices = [], selectedVoice = null;
  var rate = parseFloat(localStorage.getItem(LS_RATE) || "0.95");
  var queue = [], timings = [], startWall = 0, idx = 0;
  var speaking = false, paused = false, cancelled = false;
  var pendingTimeout = null, sessionToken = 0;

  function $(id){ return document.getElementById(id); }
  function clearPending(){ if(pendingTimeout!==null){ clearTimeout(pendingTimeout); pendingTimeout=null; } }

  /* ---------- voices ---------- */
  function scoreVoice(v){ var s=0, n=v.name.toLowerCase();
    if(FEMALE.some(function(f){return n.indexOf(f)>=0;})) s+=10;
    if(n.indexOf("natural")>=0) s+=5; if(n.indexOf("neural")>=0) s+=4;
    if(n.indexOf("enhanced")>=0) s+=3; if(n.indexOf("microsoft")>=0) s+=2; if(n.indexOf("google")>=0) s+=1;
    return s;
  }
  function loadVoices(){
    if(!window.speechSynthesis) return;
    var raw = window.speechSynthesis.getVoices(); if(!raw.length) return;
    var filtered = raw.filter(function(v){return v.lang && v.lang.indexOf("en-US")===0;});
    if(!filtered.length) filtered = raw.filter(function(v){return v.lang && v.lang.indexOf("en")===0;});
    if(!filtered.length) filtered = raw;
    var seen={}, dedup=[];
    filtered.forEach(function(v){ var k=v.name+"__"+v.lang; if(!seen[k]){ seen[k]=1; dedup.push(v); } });
    voices = dedup.map(function(v){return {voice:v, score:scoreVoice(v)};}).sort(function(a,b){return b.score-a.score;}).map(function(o){return o.voice;});
    // default: stored name, else Ava, else best-scored female
    var storedName = localStorage.getItem(LS_VOICE);
    selectedVoice = null;
    if(storedName){ selectedVoice = voices.filter(function(v){return v.name===storedName;})[0] || null; }
    if(!selectedVoice){ selectedVoice = voices.filter(function(v){return v.name.toLowerCase().indexOf("ava")>=0;})[0] || null; }
    if(!selectedVoice) selectedVoice = voices[0] || null;
    fillVoicePicker();
  }
  function fillVoicePicker(){
    var sel=$("nar-voice"); if(!sel) return;
    sel.innerHTML = voices.map(function(v){
      var label = v.name.replace(/Microsoft\s+/i,"").replace(/\s+Online.*$/i,"").replace(/\(.*\)/,"").trim();
      return '<option value="'+v.name.replace(/"/g,"&quot;")+'"'+(selectedVoice&&v.name===selectedVoice.name?" selected":"")+">"+label+"</option>";
    }).join("");
  }

  /* ---------- what counts as "the page" ---------- */
  function narrateRoot(){
    var explicit = document.querySelector("[data-narrate]");
    if(explicit) return explicit;
    // The whole body, not just .app: the show and movie modals live OUTSIDE .app,
    // and an open modal IS the visible page — it must be readable too. Hidden
    // sections, the closed modal and the bar itself are filtered by the walk.
    return document.body;
  }

  /* ---------- text extraction (live DOM, visibility-aware) ---------- */
  var SKIP_TAGS = {SCRIPT:1,STYLE:1,NOSCRIPT:1,SVG:1,CANVAS:1,BUTTON:1,INPUT:1,SELECT:1,TEXTAREA:1,IMG:1,VIDEO:1,AUDIO:1};
  function isHidden(el){
    if(el.hidden) return true;
    var cs = window.getComputedStyle(el);
    if(!cs) return false;
    return cs.display==="none" || cs.visibility==="hidden" || parseFloat(cs.opacity||"1")===0;
  }
  /* Mimics innerText's line model: inline elements merge into the current line, block
     elements start a new one. Each line remembers the element it started in, so a click
     can be mapped back to a position in the queue. */
  function collectLines(root){
    var out=[], buf=[], bufEl=null;
    function flush(){
      if(!buf.length) return;
      var s=buf.join(" ").replace(/\s+/g," ").trim();
      if(s) out.push({text:s, el:bufEl||root});
      buf=[]; bufEl=null;
    }
    (function walk(node){
      for(var c=node.firstChild; c; c=c.nextSibling){
        if(c.nodeType===3){
          var t=c.nodeValue;
          if(t && t.trim()){ buf.push(t.trim()); if(!bufEl) bufEl=node; }
          continue;
        }
        if(c.nodeType!==1) continue;
        if(c.tagName==="BR"){ flush(); continue; }
        if(SKIP_TAGS[c.tagName]) continue;
        if(c.id==="narrator") continue;          // never read our own bar
        if(c.classList && c.classList.contains("rail")) continue; // nav rail is chrome
        if(isHidden(c)) continue;
        var disp=window.getComputedStyle(c).display;
        if(disp.indexOf("inline")===0 || disp==="contents"){ walk(c); }
        else { flush(); walk(c); flush(); }
      }
    })(root);
    flush();
    return out;
  }
  function usefulLine(l){
    if(!l || l.length<4) return false;
    if(/^[\d\s.,;:!?()%\-+×÷=$]*$/.test(l)) return false;   // pure numbers/symbols
    if(/^[^\w]{1,4}$/.test(l)) return false;                 // lone emoji/symbol
    return true;
  }

  /* ---------- build the queue, keeping line→sentence offsets for click-to-read ---------- */
  var built = null;   // {recs, queue, lineOff, sOff}
  function build(){
    var sec=narrateRoot(); if(!sec) return null;
    var recs=collectLines(sec).filter(function(r){ return usefulLine(r.text); });
    if(!recs.length) return null;
    var parts=[], lineOff=[], pos=0;
    recs.forEach(function(r){
      var t = /[.!?:;]$/.test(r.text) ? r.text : r.text+".";
      lineOff.push(pos);
      parts.push(t);
      pos += t.length + 1;                       // +1 for the joining space
    });
    var text=parts.join(" ");
    var q=text.match(/[^.!?]+[.!?]+/g) || [text];
    var sOff=[], p=0;
    q.forEach(function(s){ sOff.push(p); p+=s.length; });
    return {recs:recs, queue:q, lineOff:lineOff, sOff:sOff};
  }
  function sentenceForLine(b, li){
    if(!b || li<0 || li>=b.lineOff.length) return 0;
    var off=b.lineOff[li], best=0;
    for(var i=0;i<b.sOff.length;i++){ if(b.sOff[i]<=off) best=i; else break; }
    return best;
  }
  /* Map a clicked node to the line it belongs to: walk up from the click, first looking
     for the exact element a line started in, then for any container holding one. */
  function lineFromNode(b, node){
    if(!b) return -1;
    var n = (node && node.nodeType===3) ? node.parentElement : node;
    while(n && n !== document.documentElement){
      for(var i=0;i<b.recs.length;i++){ if(b.recs[i].el === n) return i; }
      for(var j=0;j<b.recs.length;j++){ if(n.contains && n.contains(b.recs[j].el)) return j; }
      n = n.parentElement;
    }
    return -1;
  }

  /* ---------- timings + seek ---------- */
  function buildTimings(){
    timings=[]; var cumulative=0, wpm=150*(rate||1), spw=60/wpm;
    for(var i=0;i<queue.length;i++){ timings.push(cumulative);
      var words=(queue[i]||"").split(/\s+/).filter(function(w){return w.length>0;}).length;
      cumulative += words*spw + 0.15;
    }
  }
  function seek(delta){
    if(!speaking || !queue.length) return;
    if(!timings.length) buildTimings();
    var startSec = timings[idx] || 0;
    var elapsed = (startWall && !paused) ? Math.max(0,(Date.now()-startWall)/1000) : 0;
    var target = Math.max(0, startSec + elapsed + delta);
    var newIdx=0;
    for(var i=timings.length-1;i>=0;i--){ if(timings[i]<=target){ newIdx=i; break; } }
    if(newIdx>=queue.length){ stop(); return; }
    var wasPaused=paused, mySession=sessionToken;
    cancelled=true; clearPending();
    try{ window.speechSynthesis.cancel(); }catch(e){}
    pendingTimeout=setTimeout(function(){
      pendingTimeout=null;
      if(mySession!==sessionToken) return;
      if(!speaking || !queue.length) return;
      idx=newIdx; cancelled=false; paused=false; updateBar(); speakNext();
      if(wasPaused){ setTimeout(function(){ if(mySession!==sessionToken) return; try{window.speechSynthesis.pause();}catch(e){} paused=true; updateBar(); },120); }
    },120);
  }

  /* ---------- speak ---------- */
  function speakNext(){
    if(cancelled){ setSpeaking(false); return; }
    if(idx>=queue.length){ setSpeaking(false); return; }
    var sentence=(queue[idx]||"").trim();
    if(!sentence){ idx++; speakNext(); return; }
    var u=new SpeechSynthesisUtterance(sentence);
    if(selectedVoice) u.voice=selectedVoice;
    u.rate=rate; u.pitch=1.0; u.volume=1.0;
    var mySession=sessionToken;
    u.onstart=function(){ if(mySession===sessionToken) startWall=Date.now(); };
    u.onend=function(){ if(mySession!==sessionToken || cancelled) return; idx++; clearPending(); pendingTimeout=setTimeout(function(){pendingTimeout=null; speakNext();},150); };
    u.onerror=function(){ if(mySession!==sessionToken || cancelled) return; idx++; clearPending(); pendingTimeout=setTimeout(function(){pendingTimeout=null; speakNext();},150); };
    try{ window.speechSynthesis.speak(u); }catch(e){}
  }
  function setSpeaking(on){
    speaking=on; if(!on) paused=false;
    var nar=$("narrator"), ctrls=$("nar-controls"), read=$("nar-read");
    if(ctrls) ctrls.hidden=!on;
    if(read) read.hidden=on;
    if(nar) nar.classList.toggle("playing", on);
    updateBar();
  }
  function updateBar(){
    var label=$("nar-status-label"), pause=$("nar-pause"), nar=$("narrator");
    if(nar) nar.classList.toggle("paused", paused);
    if(paused){ if(label) label.textContent="Paused"; if(pause) pause.textContent="▶ Resume"; }
    else { if(label) label.textContent="Reading…"; if(pause) pause.textContent="⏸ Pause"; }
  }

  /* ---------- public controls ---------- */
  /* startFrom(lineIdx): -1 = from the top. Always (re)starts cleanly, so clicking a new
     spot mid-read just jumps there — no Stop needed first. */
  function startFrom(lineIdx){
    if(!window.speechSynthesis){ alert("This browser can’t read aloud. Try Chrome or Edge."); return; }
    built = build();
    if(!built || !built.queue.length) return;
    sessionToken++; clearPending();
    try{ window.speechSynthesis.cancel(); }catch(e){}
    cancelled=false;
    queue = built.queue;
    idx = lineIdx >= 0 ? sentenceForLine(built, lineIdx) : 0;
    startWall=0; buildTimings(); setSpeaking(true);
    setTimeout(speakNext,50);
  }
  function start(){ startFrom(-1); }
  function pauseResume(){
    if(!speaking) return;
    if(paused){ try{window.speechSynthesis.resume();}catch(e){} paused=false; }
    else { try{window.speechSynthesis.pause();}catch(e){} paused=true; }
    updateBar();
  }
  function stop(){
    sessionToken++; cancelled=true; clearPending();
    try{ window.speechSynthesis.cancel(); }catch(e){}
    setTimeout(function(){ try{window.speechSynthesis.cancel();}catch(e){} },60);
    setTimeout(function(){ try{window.speechSynthesis.cancel();}catch(e){} },250);
    queue=[]; timings=[]; idx=0; startWall=0; setSpeaking(false);
  }
  function setRate(r){ rate=r; localStorage.setItem(LS_RATE,String(r)); var l=$("nar-rate-label"); if(l) l.textContent=r.toFixed(2)+"×"; if(queue.length) buildTimings(); }

  /* ---------- click-to-read-from-here ---------- */
  /* Real controls must keep working — never hijack a click on one. In this app almost
     every card, episode row, showtime and chip is a plain div carrying an onclick, so
     those are listed here too: clicking a show must open the show, not start reading. */
  var CTRL_SEL = "button,a,input,select,textarea,label,summary,[role=button],[contenteditable],.rail,.rail-item,.slot,#narrator,#premortem-overlay," +
    "[onclick],.card,.movie-card,.tcard,.upnext-row,.cal-item,.similar-item,.ep-row,.cast-card,.chip,.wall," +
    ".st-time,.mood-btn,.big-btn,.view-btn,.nav-tab,.icon-btn,.star-btn,.ep-star,.ep-note-btn,.ep-mini,.ep-upto,.upnext-btn,.movie-want,.movie-play," +
    ".tix-btn,.st-daytab,.watch-btn,.find-remove";
  function isControlClick(t){
    if(!t || !t.closest) return false;
    return !!t.closest(CTRL_SEL);
  }
  function onPageClick(e){
    if(e.button && e.button!==0) return;              // left click only
    /* The modal/trailer BACKDROP itself closes the overlay — never read from it.
       Text INSIDE the open modal stays clickable-to-read, which is the point. */
    if(e.target && (e.target.id==="modal" ||
       (e.target.classList && e.target.classList.contains("trailer-player-overlay")))) return;
    if(isControlClick(e.target)) return;              // let the app's own controls work
    try{ if((window.getSelection()||"").toString().trim()) return; }catch(err){}  // selecting text, not asking to read
    var root = narrateRoot(); if(!root) return;
    if(!root.contains(e.target)) return;              // clicked outside the readable area
    var b = build(); if(!b) return;
    var li = lineFromNode(b, e.target);
    if(li < 0) return;                                // clicked empty space with no text under it
    startFrom(li);
  }

  /* ---------- wire up ---------- */
  function init(){
    var nar=$("narrator"); if(!nar) return;
    if(!window.speechSynthesis){ nar.hidden=true; return; }  // no support → hide entirely
    nar.hidden=false;                                        // no passcode lock in this app
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    var polls=0; var poll=setInterval(function(){ if(voices.length || ++polls>25) clearInterval(poll); else loadVoices(); },400);

    $("nar-read").addEventListener("click", start);
    $("nar-pause").addEventListener("click", pauseResume);
    $("nar-stop").addEventListener("click", stop);
    nar.querySelectorAll(".nar-seek").forEach(function(b){ b.addEventListener("click", function(){ seek(parseFloat(b.getAttribute("data-seek"))); }); });
    var rslider=$("nar-rate"); if(rslider){ rslider.value=rate; setRate(rate); rslider.addEventListener("input", function(){ setRate(parseFloat(this.value)); }); }
    var vsel=$("nar-voice");
    if(vsel){ vsel.addEventListener("change", function(){
      var want=this.value;
      selectedVoice = voices.filter(function(v){return v.name===want;})[0] || selectedVoice;
      if(selectedVoice) localStorage.setItem(LS_VOICE, selectedVoice.name);
    }); }

    // ⭐ click anywhere in the text → read from there (and re-click → jump, no stop needed)
    document.addEventListener("click", onPageClick, true);

    // Stop the moment the page underneath changes: a nav tab swaps which .section is
    // active, and the show/film modal opens and closes by toggling .open on #modal.
    if(window.MutationObserver){
      document.querySelectorAll(".section").forEach(function(s){
        new MutationObserver(function(){ if(speaking) stop(); }).observe(s, {attributes:true, attributeFilter:["class"]});
      });
      var modal=$("modal");
      if(modal){
        new MutationObserver(function(){ if(speaking) stop(); }).observe(modal, {attributes:true, attributeFilter:["class"]});
      }
    }
    window.addEventListener("hashchange", function(){ if(speaking) stop(); });
    window.addEventListener("beforeunload", function(){ try{window.speechSynthesis.cancel();}catch(e){} });
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.Narrator = { start:start, startFrom:startFrom, stop:stop, pauseResume:pauseResume, seek:seek };
})();
