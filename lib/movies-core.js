/* ---------------------------------------------------------------------------
   MOVIES — "In Theaters Now" + "Coming in the Next 3 Weeks"

   Shared by the Vercel function (api/movies.js) and the Netlify function
   (netlify/functions/movies.js) so there is exactly one implementation.

   Same design rule as discover-core.js: THIS MUST WORK WITH NO API KEY.
   Everything below reads public pages. An OMDb key (already set on this project)
   only upgrades the IMDb number from "not available" to the real IMDb score.

   WHERE EACH NUMBER COMES FROM — nothing here is invented:
     - what is playing / coming  -> themoviedb.org public browse pages
     - poster, backdrop, plot,
       cast, runtime, MPAA rating-> themoviedb.org public movie page
     - RT audience (Popcornmeter)-> rottentomatoes.com movie page, real score
     - RT critics (Tomatometer)  -> rottentomatoes.com movie page, real score
     - IMDb user rating          -> OMDb API (real IMDb score)
     - trailer                   -> YouTube, verified through oEmbed

   A number we could not verify is returned as null and the UI shows "—".
   That is the same rule the TV side of this app has always followed.

   SHOWTIMES: AMC's own site and every free showtimes feed (AMC API, Fandango's
   napi, Atom, showtimes.com) block server-side reads or require a paid vendor
   key. So this file never claims to know showtimes. Instead every movie carries
   a deep link straight to AMC West Chester 18's own showtimes page, which is
   always correct and one tap away. The list itself is US wide theatrical
   releases currently playing — which is what an 18-screen AMC runs.
--------------------------------------------------------------------------- */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Arnie's theatre. Verified 2026-07-31 against Fandango's own listing:
   AMC West Chester 18, 9415 Civic Center Blvd., West Chester, OH 45069.
   Fandango theatre id AAWWU. Both links below are real and were checked. */
const THEATRE = {
  name: 'AMC West Chester 18',
  address: '9415 Civic Center Blvd., West Chester, OH 45069',
  amc: 'https://www.amctheatres.com/movie-theatres/cincinnati/amc-west-chester-18',
  fandango: 'https://www.fandango.com/amc-west-chester-18-AAWWU/theater-page',
  fandangoId: 'AAWWU',
};

/* The bar. Deliberately the same numbers the TV side uses (IMDb 7.5), with the
   RT audience equivalent (75%) accepted too — both are user scores, both are
   the same height. A brand-new release often has one before the other. */
const MIN_IMDB = 7.5;
const MIN_RT_AUDIENCE = 75;

const GENRE_FIX = { 'Science Fiction': 'Sci-Fi', 'Action & Adventure': 'Action' };
const TMDB_IMG = 'https://media.themoviedb.org/t/p/w500/';

const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/&/g, 'and')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const decode = s => String(s || '')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#8217;/g, '’').replace(/&#8212;/g, '—')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

async function get(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        redirect: 'follow', signal: AbortSignal.timeout(15000),
      });
      if (r.status === 429 || r.status >= 500) { await sleep(900 * (i + 1)); continue; }
      return { status: r.status, text: await r.text() };
    } catch { if (i === tries - 1) return { status: 0, text: '' }; await sleep(700 * (i + 1)); }
  }
  return { status: 0, text: '' };
}
async function getJSON(url) {
  const r = await get(url, 2);
  try { return JSON.parse(r.text); } catch { return null; }
}

/* Small parallel map with a concurrency cap — a serverless function has a hard
   wall-clock limit, so none of this can be a plain sequential loop. */
async function pmap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const at = i++; out[at] = await fn(items[at], at); }
  }));
  return out;
}

/* ---- step 1: what is playing / what is coming (TMDB public pages, no key) ---- */
const CARD_RE = /href="\/movie\/(\d+)[^"]*"><div class="image[^"]*"><img alt="([^"]*)"[^>]*?src="https:\/\/media\.themoviedb\.org\/t\/p\/[a-z0-9_]+\/([A-Za-z0-9]+\.jpg)"/g;

function parseCards(html) {
  const out = []; CARD_RE.lastIndex = 0; let m;
  while ((m = CARD_RE.exec(html))) {
    // posterFile, not poster — the movie's own page supplies a bigger one later
    // and must not be able to blank this fallback out when it spreads over it.
    out.push({ tmdb: +m[1], title: decode(m[2]).trim(), posterFile: m[3] });
  }
  return out;
}

async function browseMovies(url, usRegion) {
  const r = await get(url);
  if (r.status !== 200) return [];
  return parseCards(r.text).map(c => ({ ...c, usRegion: !!usRegion }));
}

/* "In theaters now": TMDB's own now-playing list, plus a date-bounded discover
   for US theatrical releases, unioned. Two sources means a slow week on one of
   them cannot empty the section. */
async function nowPlayingCandidates(todayISO) {
  const back = shiftISO(todayISO, -75);
  const urls = [
    ['https://www.themoviedb.org/movie/now-playing', false],
    ['https://www.themoviedb.org/movie/now-playing?page=2', false],
    [`https://www.themoviedb.org/movie?release_date.gte=${back}&release_date.lte=${todayISO}` +
      '&with_release_type=3&region=US&sort_by=popularity.desc&page=1', true],
    [`https://www.themoviedb.org/movie?release_date.gte=${back}&release_date.lte=${todayISO}` +
      '&with_release_type=3&region=US&sort_by=popularity.desc&page=2', true],
  ];
  const lists = await pmap(urls, 4, u => browseMovies(u[0], u[1]).catch(() => []));
  return dedupeById(lists.flat());
}

/* "Coming in the next N weeks": TMDB upcoming + a date-bounded discover. */
async function upcomingCandidates(todayISO, days) {
  const from = shiftISO(todayISO, 1);
  const to = shiftISO(todayISO, days);
  const urls = [
    [`https://www.themoviedb.org/movie?release_date.gte=${from}&release_date.lte=${to}` +
      '&with_release_type=3&region=US&sort_by=popularity.desc&page=1', true],
    [`https://www.themoviedb.org/movie?release_date.gte=${from}&release_date.lte=${to}` +
      '&with_release_type=3&region=US&sort_by=popularity.desc&page=2', true],
    ['https://www.themoviedb.org/movie/upcoming', false],
  ];
  const lists = await pmap(urls, 3, u => browseMovies(u[0], u[1]).catch(() => []));
  return dedupeById(lists.flat());
}

/* Dedupe, then float the US-region results to the front. Both lists are already
   in TMDB's popularity order, so this keeps the ranking while making sure the
   enrichment budget is spent on films that actually open in American theatres. */
function dedupeById(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (!r.tmdb) continue;
    const prev = seen.get(r.tmdb);
    if (!prev) seen.set(r.tmdb, r);
    else if (r.usRegion && !prev.usRegion) seen.set(r.tmdb, { ...prev, usRegion: true });
  }
  const all = [...seen.values()];
  return all.filter(r => r.usRegion).concat(all.filter(r => !r.usRegion));
}

function shiftISO(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---- step 2: the movie's own TMDB page — plot, art, cast, runtime, rating ---- */
async function tmdbDetail(id) {
  const r = await get(`https://www.themoviedb.org/movie/${id}`, 2);
  if (r.status !== 200) return null;
  const t = r.text;

  const ovBlock = t.match(/<div class="overview"[^>]*>\s*<p>([\s\S]*?)<\/p>/);
  const overview = ovBlock ? decode(ovBlock[1].replace(/<[^>]*>/g, '')).trim() : null;

  const genres = (t.match(/<span class="genres">([\s\S]*?)<\/span>/) || [])[1];
  const genreList = genres
    ? [...genres.matchAll(/>([^<>]{3,30})<\/a>/g)].map(x => decode(x[1]).trim())
        .map(g => GENRE_FIX[g] || g).filter(Boolean)
    : [];

  const rt = (t.match(/<span class="runtime">\s*([\s\S]*?)<\/span>/) || [])[1];
  let minutes = null;
  if (rt) {
    const h = (rt.match(/(\d+)h/) || [])[1], mm = (rt.match(/(\d+)m/) || [])[1];
    minutes = (h ? +h * 60 : 0) + (mm ? +mm : 0) || null;
  }

  const rel = (t.match(/<span class="release">\s*([\s\S]*?)<\/span>/) || [])[1];
  let releaseISO = null, releaseText = null;
  if (rel) {
    releaseText = rel.replace(/\s+/g, ' ').trim();
    const d = releaseText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (d) releaseISO = `${d[3]}-${d[1]}-${d[2]}`;
  }

  const cast = [...t.matchAll(/<li class="card">[\s\S]{0,1200}?<p><a href="\/person\/\d+[^"]*">([^<]*)<\/a><\/p>\s*<p class="character">([^<]*)</g)]
    .slice(0, 6).map(c => ({ name: decode(c[1]).trim(), role: decode(c[2]).trim() }));

  const backdrop = (t.match(/url\('?(https:\/\/media\.themoviedb\.org\/t\/p\/w1920[^')]*)'?\)/) || [])[1] || null;
  const poster = (t.match(/<meta property="og:image" content="([^"]*)"/) || [])[1] || null;
  const tagline = decode((t.match(/<h3 class="tagline"[^>]*>([^<]*)</) || [])[1] || '').trim() || null;
  const cert = ((t.match(/<span class="certification">\s*([\s\S]*?)<\/span>/) || [])[1] || '').trim() || null;
  const score = (t.match(/data-percent="([\d.]+)"/) || [])[1];

  return {
    overview, genre: genreList.slice(0, 3).join(', ') || null, runtime: minutes,
    releaseISO, releaseText, cast, backdrop, poster, tagline, cert,
    tmdbScore: score ? Math.round(+score) : null,
  };
}

/* ---- step 3: REAL Rotten Tomatoes scores ------------------------------------
   RT has no public API, and this app has never invented an RT number. But the
   score IS published in the page's own markup, as the same JSON blob the site
   renders from. Reading it is reading RT's published score, not guessing one.

   FINDING THE RIGHT PAGE IS THE WHOLE PROBLEM. Guessing the slug from the title
   silently returns the WRONG FILM for every remake: "Moana" guesses /m/moana,
   which is the 2016 original (audience 57%), not the 2026 release (/m/moana_2026).
   Publishing that would be exactly the invented-score failure this app forbids.

   So the slug is not guessed — it is looked up. Wikidata stores the Rotten
   Tomatoes id (P1258) and the IMDb id (P345) against the TMDB id (P4947), and
   one SPARQL query resolves every candidate in a single request. Verified
   2026-07-31: Moana -> m/moana_2026, Supergirl -> m/supergirl_2026,
   The Odyssey -> m/the_odyssey_2026. The IMDb id it returns is then used to ask
   OMDb by id instead of by title, which removes the same class of mismatch from
   the IMDb number too.

   Slug guessing survives only as a fallback for films too new to be in Wikidata,
   and in that path the year-suffixed slug is tried FIRST and the page title and
   year must both check out.
--------------------------------------------------------------------------- */
function rtSlug(title) {
  return norm(title).replace(/\s+/g, '_');
}

const WD_UA = 'elite-tv-2026/1.2 (personal watchlist app)';

/* One query, every candidate: TMDB id -> { rt slug, imdb id }.
   `prop` picks which TMDB identifier to match on:
     P4947 = TMDb MOVIE id   (Rotten Tomatoes ids come back as "m/<slug>")
     P4983 = TMDb TV series id (Rotten Tomatoes ids come back as "tv/<slug>")
   Verified 2026-07-31 on both. The TV side is why the New Finds cards can now
   show a real RT score instead of the dash they carried since the app was built. */
async function wikidataIds(tmdbIds, prop) {
  const out = {};
  if (!tmdbIds.length) return out;
  const property = prop === 'tv' ? 'P4983' : 'P4947';
  const values = tmdbIds.map(i => '"' + String(i) + '"').join(' ');
  const q = `SELECT ?tmdb ?rt ?imdb WHERE {
    VALUES ?tmdb { ${values} }
    ?film wdt:${property} ?tmdb .
    OPTIONAL { ?film wdt:P1258 ?rt . }
    OPTIONAL { ?film wdt:P345 ?imdb . }
  }`;
  try {
    const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), {
      headers: { 'User-Agent': WD_UA, 'Accept': 'application/sparql-results+json' },
      signal: AbortSignal.timeout(20000),
    });
    if (r.status !== 200) return out;
    const j = await r.json();
    for (const b of (j.results && j.results.bindings) || []) {
      const id = b.tmdb && b.tmdb.value;
      if (!id) continue;
      const rt = b.rt && b.rt.value;                      // "m/moana_2026" or "tv/shoresy"
      const imdb = b.imdb && b.imdb.value;                // e.g. "tt27419466"
      out[id] = out[id] || {};
      // keep the whole path so the caller does not have to know m/ from tv/
      if (rt && /^(m|tv)\/[A-Za-z0-9_-]+$/.test(rt)) {
        out[id].rtPath = rt;
        out[id].rtSlug = rt.replace(/^(m|tv)\//, '');
      }
      if (imdb && /^tt\d+$/.test(imdb)) out[id].imdbId = imdb;
    }
  } catch { /* Wikidata down -> fall back to slug guessing, never fatal */ }
  return out;
}

function parseRT(html) {
  const grab = which => {
    const m = html.match(new RegExp('"' + which + '":\\{[\\s\\S]{0,800}?\\}'));
    if (!m) return null;
    try {
      const o = JSON.parse(m[0].slice(m[0].indexOf('{')));
      const n = o.score !== undefined && o.score !== null && o.score !== ''
        ? Number(String(o.score).replace('%', '')) : null;
      return {
        score: Number.isFinite(n) ? n : null,
        certified: !!o.certified,
        sentiment: o.sentiment || null,
        count: o.ratingCount || o.reviewCount || null,
        banded: o.bandedRatingCount || null,
        average: o.averageRating || null,
      };
    } catch { return null; }
  };
  return { audience: grab('audienceScore'), critics: grab('criticsScore') };
}

// Confirms the RT page we landed on is really this movie (title + year),
// so a wrong-slug collision can never publish someone else's score.
function rtPageMatches(html, title, year) {
  // RT's <h1> wraps the title in a nested <sr-text> element, so a "no angle
  // brackets inside" regex never matches it. og:title is clean and always
  // present ("Spider-Man: Brand New Day | Rotten Tomatoes"); the stripped <h1>
  // is the backup.
  const og = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
  const h1 = (html.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/) || [])[1];
  const raw = og || (h1 ? h1.replace(/<[^>]*>/g, ' ') : '');
  const name = decode(raw).replace(/\s*\|\s*Rotten Tomatoes\s*$/i, '');
  const want = norm(title), got = norm(name);
  if (!got) return false;
  const words = want.split(' ').filter(w => w.length > 2);
  const hit = words.length ? words.filter(w => got.includes(w)).length / words.length : 0;
  if (hit < 0.7) return false;
  if (year) {
    const years = [...html.matchAll(/\b(19|20)\d{2}\b/g)].map(m => +m[0]);
    if (years.length && !years.some(y => Math.abs(y - year) <= 1)) return false;
  }
  return true;
}

/* Reads one known RT page. Returns null on anything unverified — including the
   403 RT serves when it decides you have asked too often. A missing score shows
   as "—"; it never becomes a guess. */
async function rtFromSlug(slug, title, year, { verify = true, kind = 'm' } = {}) {
  const path = /^(m|tv)\//.test(slug) ? slug : kind + '/' + slug;
  const r = await get('https://www.rottentomatoes.com/' + path, 1);
  if (r.status !== 200 || !/audienceScore|criticsScore/.test(r.text)) return null;
  if (verify && !rtPageMatches(r.text, title, year)) return null;
  const s = parseRT(r.text);
  if (!s.audience && !s.critics) return null;
  return { ...s, url: 'https://www.rottentomatoes.com/' + path, slug: path };
}

/* Rotten Tomatoes for a TV SERIES, by the exact page Wikidata pointed at.
   Exported so lib/discover-core.js can give discovered shows real RT scores
   without keeping a second copy of any of this. */
async function rtForSeries(rtPath, title) {
  if (!rtPath) return null;
  return rtFromSlug(rtPath, title, null, { verify: false, kind: 'tv' });
}

async function rtScoresFor(title, year, knownSlug) {
  // Wikidata gave us the exact page — no verification dance needed.
  if (knownSlug) {
    const hit = await rtFromSlug(knownSlug, title, year, { verify: false });
    if (hit) return hit;
  }
  // Fallback for films Wikidata does not carry yet. Year-suffixed FIRST, because
  // the bare slug belongs to the original whenever there is a remake.
  const base = rtSlug(title);
  const tries = [year ? base + '_' + year : null, base].filter(Boolean);
  for (const slug of tries) {
    if (slug === knownSlug) continue;
    const hit = await rtFromSlug(slug, title, year);
    if (hit) return hit;
  }
  return null;
}

/* ---- step 4: real IMDb user rating (OMDb) ---- */
/* Asks by IMDb id when Wikidata supplied one — an exact lookup that cannot land
   on a same-named remake — and only falls back to title+year matching when it
   did not. */
async function omdbMovie(title, year, omdbKey, imdbId) {
  if (!omdbKey) return null;
  const url = 'https://www.omdbapi.com/?' +
    (imdbId ? 'i=' + encodeURIComponent(imdbId)
            : 't=' + encodeURIComponent(title) + '&type=movie' + (year ? '&y=' + year : '')) +
    '&apikey=' + encodeURIComponent(omdbKey);
  const j = await getJSON(url);
  if (!j || j.Response === 'False') return null;
  const num = v => (v && v !== 'N/A' ? Number(v) : null);
  return {
    imdb: Number.isFinite(num(j.imdbRating)) ? num(j.imdbRating) : null,
    imdbId: j.imdbID && j.imdbID !== 'N/A' ? j.imdbID : null,
    votes: j.imdbVotes && j.imdbVotes !== 'N/A' ? Number(String(j.imdbVotes).replace(/,/g, '')) : 0,
    plot: j.Plot && j.Plot !== 'N/A' ? j.Plot : null,
    actors: j.Actors && j.Actors !== 'N/A' ? j.Actors : null,
    director: j.Director && j.Director !== 'N/A' ? j.Director : null,
    genre: j.Genre && j.Genre !== 'N/A' ? j.Genre : null,
    rated: j.Rated && j.Rated !== 'N/A' ? j.Rated : null,
    runtime: j.Runtime && j.Runtime !== 'N/A' ? Number((j.Runtime.match(/(\d+)/) || [])[1]) : null,
    metascore: j.Metascore && j.Metascore !== 'N/A' ? Number(j.Metascore) : null,
    awards: j.Awards && j.Awards !== 'N/A' ? j.Awards : null,
    boxOffice: j.BoxOffice && j.BoxOffice !== 'N/A' ? j.BoxOffice : null,
    released: j.Released && j.Released !== 'N/A' ? j.Released : null,
  };
}

/* ---- step 5: official trailer, verified through oEmbed (never hand-written) ---- */
const OFFICIAL = ['marvel', 'sony pictures', 'warner bros', 'universal pictures', 'paramount',
  'disney', 'a24', '20th century', 'lionsgate', 'focus features', 'searchlight', 'neon',
  'mgm', 'amazon mgm', 'netflix', 'apple tv', 'rotten tomatoes', 'ign', 'kinocheck',
  'movieclips', 'fandango', 'legendary', 'blumhouse', 'illumination', 'pixar', 'dreamworks'];
const isOfficial = c => OFFICIAL.some(o => String(c || '').toLowerCase().includes(o));

async function trailerFor(title, year) {
  const q = `${title}${year ? ' ' + year : ''} official trailer`;
  const r = await get('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), 1);
  const ids = []; const re = /"videoId":"([A-Za-z0-9_-]{11})"/g; let m;
  while ((m = re.exec(r.text))) if (!ids.includes(m[1])) ids.push(m[1]);
  const words = norm(title).split(' ').filter(w => w.length > 2);
  let fallback = null;
  for (const id of ids.slice(0, 4)) {
    const o = await getJSON('https://www.youtube.com/oembed?url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&format=json');
    if (!o || !o.title) continue;
    const hit = words.length ? words.filter(w => norm(o.title).includes(w)).length / words.length : 0;
    if (hit < 0.6) continue;
    if (isOfficial(o.author_name) && /trailer|teaser/i.test(o.title)) return id;
    if (!fallback) fallback = id;
  }
  return fallback;
}

/* ---- the whole run ---- */
const TIME_BUDGET_MS = 40000;   // headroom under the function's 60s ceiling

async function runMovies({ mode, todayISO, omdbKey, days, minImdb, minRt, want }) {
  const t0 = Date.now();
  const outOfTime = () => Date.now() - t0 > TIME_BUDGET_MS;
  const soon = mode === 'soon';
  const WANT = want || (soon ? 14 : 16);
  const barImdb = Number.isFinite(minImdb) ? minImdb : MIN_IMDB;
  const barRt = Number.isFinite(minRt) ? minRt : MIN_RT_AUDIENCE;
  const window = days || 21;

  const candidates = soon
    ? await upcomingCandidates(todayISO, window)
    : await nowPlayingCandidates(todayISO);

  if (!candidates.length) {
    return {
      ok: true, mode, today: todayISO, theatre: THEATRE, found: 0, scanned: 0,
      movies: [], rejected: [],
      message: 'TMDB returned no movies for that window just now — try again in a minute.',
    };
  }

  // Cap the work: enrich the most popular slice only, in TMDB's own popularity
  // order, so a run always finishes inside the function's wall-clock limit.
  const pool = candidates.slice(0, soon ? 26 : 30);

  const rejectedEarly = [];

  // Pass 1 — TMDB detail for each (plot, art, cast, runtime, US release date)
  const detailed = (await pmap(pool, 8, async c => {
    if (outOfTime()) return null;
    const d = await tmdbDetail(c.tmdb).catch(() => null);
    if (!d) return null;
    // keep the browse-card poster whenever the detail page did not yield one
    return { ...c, ...d, poster: d.poster || (c.posterFile ? TMDB_IMG + c.posterFile : null) };
  })).filter(Boolean);

  /* Date gate. "Soon" must land inside the window. "Now" must already be out AND
     be a recent release — TMDB's now-playing list carries restored classics on
     limited re-run (a 1997 anime dated 2024 turned up in testing), and those are
     not what "what's on at the multiplex" means. */
  const from = shiftISO(todayISO, 1), to = shiftISO(todayISO, window);
  const earliest = shiftISO(todayISO, -110);
  const dateOk = m => {
    if (!m.releaseISO) return !soon;             // undated: keep for now-playing only
    return soon ? (m.releaseISO >= from && m.releaseISO <= to)
                : (m.releaseISO <= todayISO && m.releaseISO >= earliest);
  };

  /* An 18-screen AMC in Ohio runs US releases. TMDB's now-playing is worldwide,
     so films certified by a non-US board (India's A/U/UA, the UK's 12A/15/18,
     Australia's MA15+) are dropped — they are showing somewhere, just not here. */
  const NON_US_CERT = /^(A|U|U\/A|UA(\s*\d+\+?)?|12A?|15|18|R18\+?|PG12|G12|M|MA15\+|CTC|E)$/i;
  const US_CERT = /^(G|PG|PG-13|R|NC-17|NR|UR|Not Rated)$/i;
  const certOk = m => {
    const c = (m.cert || '').trim();
    if (!c) return true;                          // unrated is common and fine
    if (US_CERT.test(c)) return true;
    return !NON_US_CERT.test(c);
  };

  const inWindow = detailed.filter(m => {
    if (!dateOk(m)) return false;
    if (!certOk(m)) { rejectedEarly.push({ title: m.title, why: `not a US release (rated "${m.cert}")` }); return false; }
    return true;
  });

  // One Wikidata query resolves the exact RT slug + IMDb id for the whole batch,
  // so neither score can land on a same-titled different film.
  const idMap = await wikidataIds(inWindow.map(m => m.tmdb)).catch(() => ({}));

  /* Pass 2 — the real scores. Upcoming films have not been reviewed or rated by
     anybody yet, so they are NOT score-gated; they are ranked by anticipation and
     their score slots stay empty until release rather than showing a made-up
     number. Films already playing must clear the bar.

     RT concurrency is kept low on purpose: it starts returning 403 when hit hard,
     and a 403 costs a real score. The response is CDN-cached by the host, so a
     repeat visit the same day does not touch RT at all. */
  const scored = (await pmap(inWindow, 4, async m => {
    if (outOfTime()) return null;
    const year = m.releaseISO ? +m.releaseISO.slice(0, 4) : null;
    const ids = idMap[String(m.tmdb)] || {};
    const [rt, om] = await Promise.all([
      rtScoresFor(m.title, year, ids.rtSlug).catch(() => null),
      omdbMovie(m.title, year, omdbKey, ids.imdbId).catch(() => null),
    ]);
    return { ...m, rtData: rt, om, wdImdbId: ids.imdbId || null };
  })).filter(Boolean);

  const rejected = rejectedEarly.slice();
  const kept = [];
  for (const m of scored) {
    const imdb = m.om && m.om.imdb !== null ? m.om.imdb : null;
    const rtAud = m.rtData && m.rtData.audience ? m.rtData.audience.score : null;
    const rtCrit = m.rtData && m.rtData.critics ? m.rtData.critics.score : null;

    if (!soon) {
      const haveAny = imdb !== null || rtAud !== null;
      const passes = (imdb !== null && imdb >= barImdb) || (rtAud !== null && rtAud >= barRt);
      if (!haveAny) { rejected.push({ title: m.title, why: 'no verified IMDb or RT score yet' }); continue; }
      if (!passes) {
        rejected.push({
          title: m.title,
          why: `below the bar (${imdb !== null ? 'IMDb ' + imdb : 'no IMDb'}, ` +
               `${rtAud !== null ? 'RT audience ' + rtAud + '%' : 'no RT audience'})`,
        });
        continue;
      }
    }
    kept.push({ ...m, imdb, rtAud, rtCrit });
  }

  // Pass 3 — trailers, only for what survived (the most expensive lookup)
  const shortlist = kept.slice(0, WANT);
  await pmap(shortlist, 6, async m => {
    if (outOfTime()) { m.trailer = null; return; }
    const year = m.releaseISO ? +m.releaseISO.slice(0, 4) : null;
    m.trailer = await trailerFor(m.title, year).catch(() => null);
  });

  const movies = shortlist.map(m => ({
    tmdb: m.tmdb,
    title: m.title,
    tagline: m.tagline,
    poster: m.poster || null,
    backdrop: m.backdrop || null,
    overview: m.overview || (m.om && m.om.plot) || null,
    genre: m.genre || (m.om && m.om.genre) || null,
    runtime: m.runtime || (m.om && m.om.runtime) || null,
    cert: m.cert || (m.om && m.om.rated) || null,
    release: m.releaseISO,
    releaseText: m.releaseText,
    trailer: m.trailer || null,
    // every score below is a real published number or null — never invented
    imdb: m.imdb,
    imdbVotes: m.om ? m.om.votes : null,
    imdbId: (m.om && m.om.imdbId) || m.wdImdbId || null,
    rtAudience: m.rtAud,
    rtCritics: m.rtCrit,
    rtCertified: !!(m.rtData && m.rtData.critics && m.rtData.critics.certified),
    rtAudienceCount: m.rtData && m.rtData.audience ? (m.rtData.audience.banded || m.rtData.audience.count) : null,
    rtUrl: m.rtData ? m.rtData.url : null,
    metascore: m.om ? m.om.metascore : null,
    tmdbScore: m.tmdbScore,
    cast: m.cast && m.cast.length ? m.cast.map(c => c.name).join(', ') : (m.om ? m.om.actors : null),
    castRoles: m.cast || [],
    director: m.om ? m.om.director : null,
    awards: m.om ? m.om.awards : null,
    boxOffice: m.om ? m.om.boxOffice : null,
  }));

  // Playing now: best first. Coming soon: soonest first — that is the useful order.
  if (soon) movies.sort((a, b) => String(a.release || '9999').localeCompare(String(b.release || '9999')));
  else movies.sort((a, b) =>
    ((b.rtAudience || 0) + (b.imdb || 0) * 10) - ((a.rtAudience || 0) + (a.imdb || 0) * 10));

  return {
    ok: true, mode, today: todayISO, theatre: THEATRE,
    windowDays: soon ? window : null,
    bar: soon ? null : { imdb: barImdb, rtAudience: barRt },
    ratingSource: omdbKey ? 'IMDb via OMDb, Rotten Tomatoes read from RT' : 'Rotten Tomatoes only (no OMDb key set)',
    found: movies.length, scanned: candidates.length, considered: inWindow.length,
    elapsedMs: Date.now() - t0,
    truncated: kept.length > shortlist.length,
    movies, rejected: rejected.slice(0, 25),
  };
}

/* ---- request handling shared by both hosts ---- */
function readKeys(env) {
  const raw = n => (env[n] === undefined || env[n] === null) ? undefined : String(env[n]);
  const omdbKey = (raw('OMDB_API_KEY') || raw('OMDB_KEY') || '').trim();
  const notes = [];
  if (!omdbKey) notes.push('No OMDB_API_KEY set, so IMDb scores are unavailable; Rotten Tomatoes still works.');
  return { omdbKey, notes };
}

async function handle(query, env) {
  const { omdbKey, notes } = readKeys(env);

  if (query.selftest) {
    const [t, rt] = await Promise.all([
      get('https://www.themoviedb.org/movie/now-playing'),
      get('https://www.rottentomatoes.com/m/spider_man_brand_new_day', 1),
    ]);
    const o = omdbKey ? await getJSON(`https://www.omdbapi.com/?i=tt0111161&apikey=${encodeURIComponent(omdbKey)}`) : null;
    const rtOk = rt.status === 200 && /audienceScore/.test(rt.text);
    return { status: 200, body: {
      ok: t.status === 200,
      nowPlaying: t.status === 200 ? 'working — no API key needed' : `FAILED: TMDB unreachable (HTTP ${t.status})`,
      rottenTomatoes: rtOk ? 'working — real audience + critic scores' : `FAILED (HTTP ${rt.status})`,
      imdbRatings: !omdbKey ? 'not configured' : (o && o.Response !== 'False') ? 'working' : `key rejected: ${(o && o.Error) || 'unknown'}`,
      theatre: THEATRE, notes,
    } };
  }

  try {
    const mode = query.mode === 'soon' ? 'soon' : 'now';
    const todayISO = /^\d{4}-\d{2}-\d{2}$/.test(query.today || '')
      ? query.today : new Date().toISOString().slice(0, 10);
    const days = Math.min(90, Math.max(7, Number(query.days) || 21));
    const minImdb = query.minImdb !== undefined ? Number(query.minImdb) : undefined;
    const minRt = query.minRt !== undefined ? Number(query.minRt) : undefined;
    const body = await runMovies({ mode, todayISO, omdbKey, days, minImdb, minRt });
    if (notes.length) body.notes = notes;
    return { status: 200, body };
  } catch (e) {
    return { status: 200, body: { ok: false, code: 'FAILED', message: String(e.message || e) } };
  }
}

module.exports = {
  handle, runMovies, rtScoresFor, rtForSeries, wikidataIds, tmdbDetail,
  THEATRE, MIN_IMDB, MIN_RT_AUDIENCE,
};
