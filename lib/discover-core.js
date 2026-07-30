/* ---------------------------------------------------------------------------
   "Find New Shows" — server-side discovery core.

   Shared by the Vercel function (api/discover.js) and the Netlify function
   (netlify/functions/discover.js) so there is exactly one implementation.

   Runs on the SERVER so the API keys stay private: they live in the host's
   environment variables and never reach the browser or the public repo.

   What it does, in order:
     1. TMDB Discover — TV on Hulu / Prime Video / Apple TV+ / Netflix in the US,
        split into brand-new series and returning series with a fresh season.
     2. Drops anything already in the app (matched on TMDB id, then on title).
     3. Looks up the REAL IMDb rating for each survivor via OMDb and enforces
        the IMDb >= 7.5 rule. No rating, no entry — nothing is invented.
     4. Pulls an official YouTube trailer from TMDB's own videos endpoint and
        verifies it with YouTube oEmbed, the same check used for the first 60.

   Rotten Tomatoes has no public API, so RT Audience is returned as null and the
   UI shows "—". It is never guessed.
--------------------------------------------------------------------------- */

const TMDB = 'https://api.themoviedb.org/3';

// TMDB watch-provider ids (US)
const PROVIDERS = {
  8: 'Netflix',
  15: 'Hulu',
  9: 'Prime Video',
  350: 'Apple TV',
};

// His standing bar. RT can't be automated; IMDb can.
const MIN_IMDB = 7.5;
const MIN_TMDB_VOTES = 40;      // filters out near-unrated noise
const MAX_CANDIDATES = 40;      // keeps OMDb well inside its 1,000/day free tier

// TMDB TV genre ids -> names, so new finds carry real genres like the first 60
const GENRES = {
  10759: 'Action', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
  18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News',
  10764: 'Reality', 10765: 'Sci-Fi', 10766: 'Soap', 10767: 'Talk',
  10768: 'War', 37: 'Western',
};
// news and talk shows are noise here; reality stays (his 60 include one)
const EXCLUDE_GENRES = new Set([10763, 10767]);

const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/&/g, 'and')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// strip "(S4)" / "(Final)" / "(Limited)" so titles compare cleanly
const baseTitle = t => {
  const m = String(t || '').match(/^(.*?)\s*\((?:S\d+|Final[^)]*|Limited[^)]*)\)\s*$/i);
  return m ? m[1].trim() : String(t || '').trim();
};

async function getJSON(url, timeoutMs = 15000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON upstream error */ }
  return { ok: r.ok, status: r.status, json, text };
}

/* ---- step 1: candidates from TMDB Discover ---- */
async function discoverForProvider(key, providerId, since, kind) {
  const common =
    `api_key=${encodeURIComponent(key)}` +
    `&watch_region=US` +
    `&with_watch_providers=${providerId}` +
    `&include_adult=false` +
    `&language=en-US` +
    `&vote_count.gte=${MIN_TMDB_VOTES}` +
    `&page=1`;

  // new series: first aired on/after `since`
  // new season: first aired BEFORE `since` but has had episodes since then
  const q = kind === 'new'
    ? `${common}&first_air_date.gte=${since}&sort_by=first_air_date.desc`
    : `${common}&first_air_date.lte=${since}&air_date.gte=${since}&sort_by=popularity.desc`;

  const { ok, status, json } = await getJSON(`${TMDB}/discover/tv?${q}`);
  if (!ok) {
    const msg = (json && (json.status_message || json.errors)) || `HTTP ${status}`;
    throw new Error(`TMDB discover failed (${PROVIDERS[providerId]}, ${kind}): ${msg}`);
  }
  return (json.results || [])
    .filter(r => !(r.genre_ids || []).some(g => EXCLUDE_GENRES.has(g)))
    .map(r => ({
      tmdb: r.id,
      title: r.name,
      overview: r.overview || '',
      poster: r.poster_path ? r.poster_path.replace(/^\//, '') : null,
      genre: (r.genre_ids || []).map(g => GENRES[g]).filter(Boolean).slice(0, 2).join(', ') || 'Drama',
      tmdbScore: typeof r.vote_average === 'number' ? Math.round(r.vote_average * 10) / 10 : null,
      tmdbVotes: r.vote_count || 0,
      firstAir: r.first_air_date || '',
      platform: PROVIDERS[providerId],
      type: kind,
    }));
}

/* ---- step 3: the real IMDb rating, via TMDB external_ids -> OMDb ---- */
async function imdbRatingFor(tmdbKey, omdbKey, tmdbId) {
  const ext = await getJSON(`${TMDB}/tv/${tmdbId}/external_ids?api_key=${encodeURIComponent(tmdbKey)}`);
  const imdbId = ext.ok && ext.json && ext.json.imdb_id;
  if (!imdbId) return { imdb: null, imdbId: null };

  const om = await getJSON(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(omdbKey)}`);
  if (!om.ok || !om.json) return { imdb: null, imdbId };
  if (om.json.Response === 'False') return { imdb: null, imdbId, omdbError: om.json.Error };
  const raw = om.json.imdbRating;
  const val = raw && raw !== 'N/A' ? Number(raw) : null;
  return { imdb: Number.isFinite(val) ? val : null, imdbId };
}

/* ---- step 4: official trailer, verified the same way as the original 60 ---- */
async function trailerFor(tmdbKey, tmdbId) {
  const v = await getJSON(`${TMDB}/tv/${tmdbId}/videos?api_key=${encodeURIComponent(tmdbKey)}&language=en-US`);
  if (!v.ok || !v.json) return null;
  const vids = (v.json.results || []).filter(x => x.site === 'YouTube' && x.key);

  const rank = x => {
    let s = 0;
    if (x.official) s += 4;
    if (/trailer/i.test(x.type || '')) s += 3;
    else if (/teaser/i.test(x.type || '')) s += 2;
    if (/trailer/i.test(x.name || '')) s += 1;
    return s;
  };
  vids.sort((a, b) => rank(b) - rank(a));

  for (const cand of vids.slice(0, 4)) {
    const chk = await getJSON('https://www.youtube.com/oembed?url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + cand.key) + '&format=json', 10000);
    if (chk.ok) return cand.key;   // exists AND embeddable
  }
  return null;
}

/* ---- the whole run ---- */
async function runDiscover({ tmdbKey, omdbKey, since, knownIds, knownTitles }) {
  const known = new Set((knownIds || []).map(Number).filter(Boolean));
  const knownT = new Set((knownTitles || []).map(t => norm(baseTitle(t))).filter(Boolean));

  // 1 — gather
  const jobs = [];
  for (const pid of Object.keys(PROVIDERS)) {
    for (const kind of ['new', 'season']) jobs.push(discoverForProvider(tmdbKey, pid, since, kind));
  }
  const settled = await Promise.allSettled(jobs);
  const upstreamErrors = settled.filter(s => s.status === 'rejected').map(s => String(s.reason.message || s.reason));
  if (settled.every(s => s.status === 'rejected')) {
    const e = new Error(upstreamErrors[0] || 'TMDB unreachable');
    e.code = 'TMDB_FAILED';
    throw e;
  }

  // 2 — merge + de-duplicate
  const byId = new Map();
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const c of s.value) {
      if (known.has(Number(c.tmdb))) continue;          // already in the app
      if (knownT.has(norm(baseTitle(c.title)))) continue;
      if (!c.poster) continue;                          // no artwork, skip
      const prev = byId.get(c.tmdb);
      if (!prev) byId.set(c.tmdb, c);
      else {
        // same show on two services, or found as both new+season
        if (!prev.platform.includes(c.platform)) prev.platform += ' · ' + c.platform;
        if (prev.type === 'season' && c.type === 'new') prev.type = 'new';
      }
    }
  }

  const candidates = [...byId.values()]
    .sort((a, b) => (b.tmdbVotes || 0) - (a.tmdbVotes || 0))
    .slice(0, MAX_CANDIDATES);

  // 3 + 4 — enforce IMDb >= 7.5, then attach a verified trailer
  const kept = [];
  const rejected = [];
  for (const c of candidates) {
    let info;
    try { info = await imdbRatingFor(tmdbKey, omdbKey, c.tmdb); }
    catch { info = { imdb: null, imdbId: null }; }

    if (info.imdb === null) { rejected.push({ title: c.title, why: 'no IMDb rating available' }); continue; }
    if (info.imdb < MIN_IMDB) { rejected.push({ title: c.title, why: `IMDb ${info.imdb} below ${MIN_IMDB}` }); continue; }

    let trailer = null;
    try { trailer = await trailerFor(tmdbKey, c.tmdb); } catch { /* leave null */ }

    kept.push({
      tmdb: c.tmdb,
      title: c.title,
      platform: c.platform,
      type: c.type,
      genre: c.genre,
      poster: c.poster,
      trailer,                      // may be null -> UI falls back to a YouTube search
      imdb: info.imdb,              // REAL IMDb rating
      imdbId: info.imdbId,
      tmdbScore: c.tmdbScore,
      rt: null,                     // Rotten Tomatoes has no public API — never guessed
      firstAir: c.firstAir,
      overview: c.overview,
    });
  }

  kept.sort((a, b) => b.imdb - a.imdb);
  return {
    ok: true,
    since,
    criteria: { imdbMin: MIN_IMDB, note: 'RT Audience is not automatable (no public API) and is reported as null.' },
    found: kept.length,
    scanned: candidates.length,
    shows: kept,
    rejected: rejected.slice(0, 25),
    upstreamErrors,
  };
}

/* ---- request handling shared by both hosts ---- */
function readKeys(env) {
  const tmdbKey = env.TMDB_API_KEY || env.TMDB_KEY || '';
  const omdbKey = env.OMDB_API_KEY || env.OMDB_KEY || '';
  const missing = [];
  if (!tmdbKey) missing.push('TMDB_API_KEY');
  if (!omdbKey) missing.push('OMDB_API_KEY');
  return { tmdbKey, omdbKey, missing };
}

function parseParams(query) {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(query.since || '') ? query.since : defaultSince();
  const knownIds = String(query.known || '').split(',').map(s => s.trim()).filter(Boolean);
  const knownTitles = String(query.titles || '').split('|').map(s => s.trim()).filter(Boolean);
  return { since, knownIds, knownTitles };
}

// default window: the last 120 days
function defaultSince() {
  const d = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function handle(query, env) {
  const { tmdbKey, omdbKey, missing } = readKeys(env);
  if (missing.length) {
    return {
      status: 200,
      body: {
        ok: false,
        code: 'MISSING_KEYS',
        missing,
        message: `Setup needed: add ${missing.join(' and ')} to this project's Environment Variables, then redeploy.`,
      },
    };
  }

  // ?selftest=1 — checks the keys and upstreams without doing a full run
  if (query.selftest) {
    const t = await getJSON(`${TMDB}/configuration?api_key=${encodeURIComponent(tmdbKey)}`);
    const o = await getJSON(`https://www.omdbapi.com/?i=tt0903747&apikey=${encodeURIComponent(omdbKey)}`);
    const omdbOk = o.ok && o.json && o.json.Response !== 'False';
    return {
      status: 200,
      body: {
        ok: t.ok && omdbOk,
        tmdb: t.ok ? 'key works' : `FAILED: ${(t.json && t.json.status_message) || t.status}`,
        omdb: omdbOk ? 'key works' : `FAILED: ${(o.json && o.json.Error) || o.status}`,
      },
    };
  }

  const { since, knownIds, knownTitles } = parseParams(query);
  try {
    const result = await runDiscover({ tmdbKey, omdbKey, since, knownIds, knownTitles });
    return { status: 200, body: result };
  } catch (e) {
    return {
      status: 200,
      body: { ok: false, code: e.code || 'FAILED', message: String(e.message || e) },
    };
  }
}

module.exports = { handle, runDiscover, defaultSince, PROVIDERS, MIN_IMDB };
