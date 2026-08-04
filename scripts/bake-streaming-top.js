/* Splices data/streaming-top.json into index.html between the STREAMTOP
   markers, so the Best of Streaming list works offline like everything else.
   Run after build-streaming-top.js:
     node scripts/build-streaming-top.js && node scripts/bake-streaming-top.js */
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data', 'streaming-top.json');
const htmlPath = path.join(__dirname, '..', 'index.html');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
if (!data.movies || !data.movies.length) {
  console.error('streaming-top.json has no movies — refusing to bake an empty list.');
  process.exit(1);
}

/* Exactly the fields the client renders — nothing speculative rides along. */
const lean = data.movies.map(m => ({
  tmdb: m.tmdb, title: m.title, services: m.services, year: m.year,
  release: m.release, poster: m.poster, backdrop: m.backdrop, tagline: m.tagline,
  overview: m.overview, genre: m.genre,
  runtime: m.runtime, cert: m.cert, imdb: m.imdb, imdbVotes: m.imdbVotes,
  imdbId: m.imdbId, rtCritics: m.rtCritics, rtAudience: m.rtAudience,
  rtCertified: m.rtCertified, rtUrl: m.rtUrl, trailer: m.trailer,
  cast: m.cast, castRoles: m.castRoles, director: m.director,
}));

const payload = {
  checked: data.checked, bar: data.bar, services: data.services, movies: lean,
};

const html = fs.readFileSync(htmlPath, 'utf8');
const BEGIN = '/*STREAMTOP:BEGIN*/', END = '/*STREAMTOP:END*/';
const a = html.indexOf(BEGIN), b = html.indexOf(END);
if (a === -1 || b === -1 || b < a) {
  console.error('STREAMTOP markers not found in index.html — nothing changed.');
  process.exit(1);
}
const next = html.slice(0, a + BEGIN.length) +
  '\nconst STREAMTOP=' + JSON.stringify(payload) + ';\n' +
  html.slice(b);
fs.writeFileSync(htmlPath, next);

const perSvc = {};
for (const m of lean) for (const s of m.services) perSvc[s] = (perSvc[s] || 0) + 1;
console.log('Baked', lean.length, 'unique films into index.html (checked ' + data.checked + ').');
console.log('Per service:', JSON.stringify(perSvc));
