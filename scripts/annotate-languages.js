/* ---------------------------------------------------------------------------
   annotate-languages.js — writes data/languages.json: the ORIGINAL LANGUAGE of
   every baked show (SHOWS via MEDIA's tmdb ids) and every Best of Streaming
   film, read from each title's own TMDB page ("Original Language" fact).
   Nothing is guessed: a page that cannot be read leaves the entry out, and the
   app treats a missing language as "unknown", never as English.

   Usage: node scripts/annotate-languages.js        (~2 minutes, paced)
   Then:  node scripts/bake-languages.js            (splices it into index.html)
--------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'languages.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function langOf(kind, tmdb) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://www.themoviedb.org/${kind}/${tmdb}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 429 || r.status >= 500) { await sleep(2500 * (i + 1)); continue; }
      if (r.status !== 200) return null;
      const t = await r.text();
      const m = t.match(/Original Language<\/bdi><\/strong>\s*([^<]+)</);
      return m ? m[1].trim() : null;
    } catch { await sleep(1500 * (i + 1)); }
  }
  return null;
}

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const tv = {};
  const mediaBlock = html.slice(html.indexOf('const MEDIA = {'), html.indexOf('const MEDIA = {') + 40000);
  for (const m of mediaBlock.matchAll(/^\s*(\d+): \{[^}]*tmdb: (\d+)/gm)) tv[m[1]] = { tmdb: +m[2] };
  const films = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'streaming-top.json'), 'utf8')).movies;
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { tv: {}, movies: {} };
  const out = { checked: null, tv: { ...(prev.tv || {}) }, movies: { ...(prev.movies || {}) } };

  let n = 0;
  for (const [id, v] of Object.entries(tv)) {
    if (out.tv[id]) continue;
    const l = await langOf('tv', v.tmdb);
    if (l) out.tv[id] = l;
    console.log(`tv ${id} (tmdb ${v.tmdb}) -> ${l || 'UNREAD'}`);
    if (++n % 5 === 0) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    await sleep(350);
  }
  for (const f of films) {
    if (out.movies[f.tmdb]) continue;
    const l = await langOf('movie', f.tmdb);
    if (l) out.movies[f.tmdb] = l;
    console.log(`movie ${f.tmdb} ${f.title} -> ${l || 'UNREAD'}`);
    if (++n % 5 === 0) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    await sleep(350);
  }
  const d = new Date();
  out.checked = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const tally = o => Object.values(o).reduce((a, l) => (a[l] = (a[l] || 0) + 1, a), {});
  console.log('TV:', tally(out.tv));
  console.log('MOVIES:', tally(out.movies));
  console.log('written', OUT);
})();
