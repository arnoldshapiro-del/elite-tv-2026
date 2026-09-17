/* ---------------------------------------------------------------------------
   bake-languages.js — puts data/languages.json to work:
     1. stamps `lang` on every film in data/streaming-top.json
     2. splices SHOW_LANG (show id -> original language) into index.html between
        the LANG markers
     3. re-runs bake-streaming-top.js so the baked STREAMTOP carries `lang` too

   Run after annotate-languages.js:
     node scripts/annotate-languages.js && node scripts/bake-languages.js
   Never edit the baked SHOW_LANG const by hand.
--------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const langPath = path.join(ROOT, 'data', 'languages.json');
const topPath = path.join(ROOT, 'data', 'streaming-top.json');
const htmlPath = path.join(ROOT, 'index.html');

const L = JSON.parse(fs.readFileSync(langPath, 'utf8'));
if (!L.tv || !Object.keys(L.tv).length) {
  console.error('languages.json has no tv entries — refusing to bake an empty map.');
  process.exit(1);
}

// 1 — films
const top = JSON.parse(fs.readFileSync(topPath, 'utf8'));
let stamped = 0, unknown = [];
for (const m of top.movies) {
  const l = L.movies[String(m.tmdb)];
  if (l) { m.lang = l; stamped++; } else unknown.push(m.title);
}
fs.writeFileSync(topPath, JSON.stringify(top, null, 1));
console.log(`Films: ${stamped} stamped with a language` + (unknown.length ? `; unknown: ${unknown.join(', ')}` : ''));

// 2 — shows (the working copy may be CRLF under git autocrlf; keep whatever it is)
let html = fs.readFileSync(htmlPath, 'utf8');
const crlf = html.includes('\r\n');
if (crlf) html = html.split('\r\n').join('\n');
const BEGIN = '/*LANG:BEGIN*/', END = '/*LANG:END*/';
const a = html.indexOf(BEGIN), b = html.indexOf(END);
if (a === -1 || b === -1 || b < a) {
  console.error('LANG markers not found in index.html — nothing changed.');
  process.exit(1);
}
const map = {};
Object.keys(L.tv).map(Number).sort((x, y) => x - y).forEach(id => { map[id] = L.tv[id]; });
html = html.slice(0, a + BEGIN.length) +
  '\nconst SHOW_LANG=' + JSON.stringify(map) + '; // checked ' + (L.checked || 'unknown') + '\n' +
  html.slice(b);
fs.writeFileSync(htmlPath, crlf ? html.split('\n').join('\r\n') : html);
const tally = Object.values(map).reduce((acc, l) => (acc[l] = (acc[l] || 0) + 1, acc), {});
console.log(`Shows: ${Object.keys(map).length} languages baked into index.html`, JSON.stringify(tally));

// 3 — the baked STREAMTOP now carries lang
execFileSync(process.execPath, [path.join(__dirname, 'bake-streaming-top.js')], { stdio: 'inherit' });
