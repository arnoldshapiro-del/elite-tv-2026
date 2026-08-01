/* ---------------------------------------------------------------------------
   "Find New Shows" — server-side discovery core.

   Shared by the Vercel function (api/discover.js) and the Netlify function
   (netlify/functions/discover.js) so there is exactly one implementation.

   DESIGN RULE: this must work with NO API KEY AT ALL.
   An earlier version called TMDB's private API and therefore died whenever the
   key was missing or unverified. Discovery now reads TMDB's PUBLIC pages — the
   same source used to build the app's posters, episodes and cast — so the button
   always works. Real IMDb ratings are key-free too: IMDb's own ratings feed
   (see imdbFromWidget in movies-core.js) answers by exact tt-id. An OMDb key,
   when present, is used first and adds plot/cast extras — but nothing depends
   on it. When neither source has a rating, the app says which score it is
   showing rather than pretending.

   Pipeline:
     1. TMDB public browse, per service, for new series and new seasons since a date
     2. Drop anything already in the app (TMDB id, then title)
     3. Confirm the show really has episodes dated in the window
     4. Real IMDb rating (OMDb if a key exists, else IMDb's own feed), else TMDB's score
     5. Official trailer from YouTube, verified through oEmbed

   Rotten Tomatoes still has no public API. It is still never invented. But the
   score IS published in RT's own page markup, and Wikidata stores the exact
   Rotten Tomatoes id against the TMDB TV id — so the right page can be looked
   up rather than guessed at, and the real number read from it. That is what
   step 6 does, and it is why New Finds cards now carry an RT score instead of
   the dash they showed from the day this file was written. Anything that cannot
   be resolved and verified is still returned as null.
--------------------------------------------------------------------------- */
const { rtForSeries, wikidataIds, imdbFromWidget } = require('./movies-core.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROVIDERS = { 8: 'Netflix', 15: 'Hulu', 9: 'Prime Video', 350: 'Apple TV' };
const MIN_IMDB = 7.5;          // his standing bar, applied when a real rating exists
const MIN_TMDB_SCORE = 7.5;    // fallback bar when no IMDb rating is available
const MIN_VOTES = 25;
const MAX_CANDIDATES = 28;     // keeps a run quick and inside OMDb's free tier

/* How wide a net to cast, by how far back the search reaches. A one-week search
   is fully covered by page 1 of each list; a one-year search is not, and reading
   only page 1 for it quietly returned a fraction of what was actually out there.
   Pages are fetched in parallel, so more pages cost latency, not linear time. */
function planFor(sinceISO, todayISO) {
  const days = Math.max(1, Math.round(
    (new Date(todayISO + 'T12:00:00Z') - new Date(sinceISO + 'T12:00:00Z')) / 86400000));
  /* `want` is per RUN, not per window. Verifying a show costs two more page
     reads, so asking for 30 in one go pushed a one-year search to 55s against a
     60s ceiling. A wide window instead returns a solid batch quickly and sets
     `truncated`; pressing again excludes everything already added (the client
     sends its known ids) and brings back the next batch. Fast every time, and
     the full year is still reachable. */
  if (days <= 10)  return { days, pages: 1, candidates: 24, want: 12 };
  if (days <= 40)  return { days, pages: 2, candidates: 32, want: 14 };
  if (days <= 100) return { days, pages: 3, candidates: 44, want: 16 };
  if (days <= 200) return { days, pages: 4, candidates: 56, want: 18 };
  return             { days, pages: 5, candidates: 70, want: 20 };
}

const GENRES = {
  10759: 'Action', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
  18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News',
  10764: 'Reality', 10765: 'Sci-Fi', 10766: 'Soap', 10767: 'Talk',
  10768: 'War', 37: 'Western',
};
// long-running daytime/news/wrestling noise that rating filters alone let through
const DENY = /\b(raw|smackdown|nxt|wwe|sesame street|news|tonight show|late show|daily show|jeopardy|wheel of fortune|price is right|good morning)\b/i;

const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/&/g, 'and')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const baseTitle = t => {
  const m = String(t || '').match(/^(.*?)\s*\((?:S\d+|Final[^)]*|Limited[^)]*)\)\s*$/i);
  return m ? m[1].trim() : String(t || '').trim();
};
const decode = s => String(s || '')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#8217;/g, '’').replace(/&#8212;/g, '—');

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        redirect: 'follow', signal: AbortSignal.timeout(25000),
      });
      if (r.status === 429 || r.status >= 500) { await sleep(1800 * (i + 1)); continue; }
      return { status: r.status, text: await r.text() };
    } catch { if (i === tries - 1) return { status: 0, text: '' }; await sleep(1200 * (i + 1)); }
  }
  return { status: 0, text: '' };
}
async function getJSON(url) {
  const r = await get(url, 2);
  try { return JSON.parse(r.text); } catch { return null; }
}

/* ---- step 1: candidates from TMDB's public browse pages (no key) ---- */
const CARD_RE = /href="\/tv\/(\d+)[^"]*"><div class="image[^"]*"><img alt="([^"]*)"[^>]*?src="https:\/\/media\.themoviedb\.org\/t\/p\/[a-z0-9_]+\/([A-Za-z0-9]+\.jpg)"/g;

async function browse(providerId, kind, since, page) {
  const common = `with_watch_providers=${providerId}&watch_region=US&page=${page}`;
  const q = kind === 'new'
    ? `first_air_date.gte=${since}&vote_average.gte=7&vote_count.gte=${MIN_VOTES}&sort_by=vote_average.desc&${common}`
    : `air_date.gte=${since}&first_air_date.lte=${since}&vote_average.gte=7.5&vote_count.gte=120&sort_by=vote_average.desc&${common}`;
  const r = await get(`https://www.themoviedb.org/tv?${q}`);
  if (r.status !== 200) return [];
  const out = []; CARD_RE.lastIndex = 0; let m;
  while ((m = CARD_RE.exec(r.text))) {
    const title = decode(m[2]).trim();
    if (DENY.test(title)) continue;
    out.push({ tmdb: +m[1], title, poster: m[3], platform: PROVIDERS[providerId], type: kind });
  }
  return out;
}

/* ---- step 3: does it really have episodes in the window? (no key) ---- */
function parseSeasons(html) {
  const re = /<h2><a href="\/tv\/[^"]*\/season\/(\d+)">([^<]*)<\/a><\/h2>[\s\S]{0,700}?(\d{4})?\s*•\s*(\d+)\s+Episodes?/g;
  const out = []; let m;
  while ((m = re.exec(html))) out.push({ n: +m[1], year: m[3] || null, eps: +m[4] });
  return out;
}
function parseEpisodes(html) {
  const out = [];
  const parts = html.split(/data-url="\/tv\/[^"]*\/season\/\d+\/episode\/\d+"/).slice(1);
  for (const p of parts) {
    const num = (p.match(/<span class="episode_number">(\d+)<\/span>/) || [])[1];
    if (!num) continue;
    const title = (p.match(/<div class="episode_title">\s*<h3><a[^>]*>([^<]*)<\/a>/) || [])[1];
    const date = (p.match(/<span class="date">([^<]*)<\/span>/) || [])[1];
    const rt = (p.match(/<span class="runtime">\s*(\d+)m/) || [])[1];
    let iso = null;
    if (date) { const d = new Date(date + ' 12:00:00'); if (!isNaN(d)) iso = d.toISOString().slice(0, 10); }
    out.push({ n: +num, title: decode(title || ('Episode ' + num)).trim(), air: iso, runtime: rt ? +rt : null });
  }
  return out.sort((a, b) => a.n - b.n);
}
function parseGenres(html) {
  const m = html.match(/<span class="genres">([\s\S]*?)<\/span>/);
  if (!m) return null;
  const names = [...m[1].matchAll(/>([^<>]{3,30})<\/a>/g)].map(x => decode(x[1]).trim());
  const map = { 'Sci-Fi & Fantasy': 'Sci-Fi', 'Action & Adventure': 'Action' };
  return names.map(n => map[n] || n).filter(Boolean).slice(0, 2).join(', ') || null;
}

/* ---- step 4: real IMDb rating, key-free ---- */
// Asks by IMDb id when Wikidata supplied one — an exact lookup that cannot land
// on a same-named different series — and falls back to title matching when not.
// OMDb runs first when a key exists (it also carries plot/cast); with no key,
// or when OMDb has no rating, IMDb's own ratings feed answers by exact id.
async function omdbFor(title, omdbKey, imdbId) {
  let out = null;
  if (omdbKey) {
    const q = imdbId ? `i=${encodeURIComponent(imdbId)}`
                     : `t=${encodeURIComponent(title)}&type=series`;
    const j = await getJSON(`https://www.omdbapi.com/?${q}&apikey=${encodeURIComponent(omdbKey)}`);
    if (j && j.Response !== 'False') {
      const v = j.imdbRating && j.imdbRating !== 'N/A' ? Number(j.imdbRating) : null;
      out = {
        imdb: Number.isFinite(v) ? v : null,
        imdbId: j.imdbID && j.imdbID !== 'N/A' ? j.imdbID : null,
        votes: j.imdbVotes && j.imdbVotes !== 'N/A' ? Number(String(j.imdbVotes).replace(/,/g, '')) : 0,
        genre: j.Genre && j.Genre !== 'N/A' ? j.Genre : null,
        plot: j.Plot && j.Plot !== 'N/A' ? j.Plot : null,
        actors: j.Actors && j.Actors !== 'N/A' ? j.Actors : null,
        runtime: j.Runtime && j.Runtime !== 'N/A' ? j.Runtime : null,
      };
    }
  }
  if (out && out.imdb !== null) return out;
  const w = await imdbFromWidget(imdbId).catch(() => null);
  if (w && out) return { ...out, imdb: w.imdb, votes: w.votes || out.votes };
  return w || out;
}

/* ---- step 5: official trailer, verified ---- */
const OFFICIAL = ['netflix','prime video','apple tv','hulu','max','hbo','fx networks','disney',
  'paramount','peacock','amazon','rotten tomatoes','ign','crunchyroll','abc','nbc','cbs','bbc',
  'itv','sky','a24','kinocheck','adult swim','tv promos'];
const isOfficial = c => OFFICIAL.some(o => String(c || '').toLowerCase().includes(o));

async function trailerFor(title, season) {
  const q = season > 1 ? `${title} season ${season} official trailer` : `${title} official trailer`;
  const r = await get('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), 2);
  const ids = []; const re = /"videoId":"([A-Za-z0-9_-]{11})"/g; let m;
  while ((m = re.exec(r.text))) if (!ids.includes(m[1])) ids.push(m[1]);
  const words = norm(title).split(' ').filter(w => w.length > 2);
  let fallback = null;
  for (const id of ids.slice(0, 5)) {
    const o = await getJSON('https://www.youtube.com/oembed?url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&format=json');
    if (!o || !o.title) continue;
    const hit = words.filter(w => norm(o.title).includes(w)).length / Math.max(1, words.length);
    if (hit < 0.6) continue;
    if (isOfficial(o.author_name) && /trailer|teaser/i.test(o.title)) return id;
    if (!fallback) fallback = id;
  }
  return fallback;
}

/* ---- the whole run ---- */
// Small parallel map with a concurrency cap — a serverless function has a hard
// wall-clock limit, so this cannot be a plain sequential loop.
async function pmap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const at = i++; out[at] = await fn(items[at], at); }
  }));
  return out;
}

/* Vercel allows 60s (vercel.json maxDuration); Netlify tops out near 30.
   Stay well under whichever host is running this — the truncated/press-again
   path already absorbs anything a shorter run cannot finish. */
const TIME_BUDGET_MS = process.env.VERCEL ? 45000 : 25000;
const WANT = 12;

async function runDiscover({ omdbKey, since, knownIds, knownTitles, today }) {
  const t0 = Date.now();
  const outOfTime = () => Date.now() - t0 > TIME_BUDGET_MS;
  const known = new Set((knownIds || []).map(Number).filter(Boolean));
  const knownT = new Set((knownTitles || []).map(t => norm(baseTitle(t))).filter(Boolean));
  const todayISO = today || new Date().toISOString().slice(0, 10);

  // 1 — browse every service and both kinds AT ONCE, as deep as the window needs
  const plan = planFor(since, todayISO);
  const jobs = [];
  for (const pid of Object.keys(PROVIDERS))
    for (const kind of ['new', 'season'])
      for (let page = 1; page <= plan.pages; page++) jobs.push({ pid, kind, page });
  const results = await pmap(jobs, 10, j => browse(j.pid, j.kind, since, j.page)
    .then(r => ({ ...j, rows: r }))
    .catch(() => ({ ...j, rows: [] })));

  // Only page 1 coming back empty means a service really returned nothing;
  // a deeper page being empty just means the list ended.
  const upstreamErrors = results.filter(r => r.page === 1 && !r.rows.length)
    .map(r => `${PROVIDERS[r.pid]} (${r.kind === 'new' ? 'new series' : 'new seasons'}) returned nothing`);

  // Interleave services round-robin so one service can't fill the whole result set.
  const byService = {};
  results.forEach(r => {
    (byService[r.pid] = byService[r.pid] || []);
    r.rows.forEach(c => {
      if (known.has(c.tmdb)) return;
      if (knownT.has(norm(baseTitle(c.title)))) return;
      const dupe = byService[r.pid].find(x => x.tmdb === c.tmdb);
      if (dupe) { if (!dupe.platform.includes(c.platform)) dupe.platform += ' · ' + c.platform; return; }
      byService[r.pid].push(c);
    });
  });
  const queues = Object.values(byService);
  const cap = Math.max(MAX_CANDIDATES, plan.candidates);
  const pool = new Map();
  for (let round = 0; pool.size < cap; round++) {
    let added = false;
    for (const q of queues) {
      if (round < q.length && pool.size < cap) {
        const c = q[round];
        if (!pool.has(c.tmdb)) { pool.set(c.tmdb, c); added = true; }
      }
    }
    if (!added) break;
  }

  if (!pool.size) {
    return { ok: true, since, found: 0, scanned: 0, shows: [], rejected: [], upstreamErrors,
             ratingSource: 'IMDb where available, else TMDB',
             message: 'Nothing new on those four services since ' + since + '.' };
  }

  /* 2 — verify each candidate in parallel: does it really have episodes that
        ALREADY AIRED inside the window?

     This stops as soon as enough have passed. Verifying all 60 candidates for a
     one-year search cost ~51s of the function's 60s ceiling and left no time for
     trailers, so long searches came back with "no trailer" on most rows. Only
     the first `need` that verify are ever checked. */
  const candidates = [...pool.values()];
  const rejected = [];
  const need = Math.max(WANT, plan.want);
  let passed = 0;
  const verified = (await pmap(candidates, 10, async c => {
    if (outOfTime() || passed >= need) return null;
    const sr = await get(`https://www.themoviedb.org/tv/${c.tmdb}/seasons`, 2);
    const withEps = (sr.status === 200 ? parseSeasons(sr.text) : []).filter(s => s.n > 0 && s.eps > 0);
    if (!withEps.length) { rejected.push({ title: c.title, why: 'no released episodes' }); return null; }
    const target = Math.max(...withEps.map(s => s.n));

    const er = await get(`https://www.themoviedb.org/tv/${c.tmdb}/season/${target}`, 2);
    const eps = er.status === 200 ? parseEpisodes(er.text) : [];
    // "come out since the last search" means AIRED, not merely dated in future
    const aired = eps.filter(e => e.air && e.air >= since && e.air <= todayISO);
    if (!aired.length) { rejected.push({ title: c.title, why: 'nothing aired since ' + since }); return null; }
    passed++;
    return { c, target, eps, first: aired[0].air,
             genreFromPage: er.status === 200 ? parseGenres(er.text) : null };
  })).filter(Boolean);

  // 3 — enrich only what survived, in parallel, and only up to what we need.
  //     One Wikidata query first turns every surviving TMDB id into the exact
  //     Rotten Tomatoes page and IMDb id for that series.
  const shortlist = verified.slice(0, need);
  const idMap = await wikidataIds(shortlist.map(v => v.c.tmdb), 'tv').catch(() => ({}));

  const kept = (await pmap(shortlist, 8, async v => {
    const base = baseTitle(v.c.title);
    const ids = idMap[String(v.c.tmdb)] || {};
    const [om, trailer, rtData] = await Promise.all([
      omdbFor(base, omdbKey, ids.imdbId).catch(() => null),
      outOfTime() ? Promise.resolve(null) : trailerFor(base, v.target).catch(() => null),
      // RT is best-effort: it rate-limits, and a missing score must stay a dash
      (outOfTime() || !ids.rtPath) ? Promise.resolve(null)
        : rtForSeries(ids.rtPath, base).catch(() => null),
    ]);
    let score = null, source = 'TMDB';
    if (om && om.imdb !== null) { score = om.imdb; source = 'IMDb'; }
    if (score !== null && score < MIN_IMDB) {
      rejected.push({ title: v.c.title, why: `IMDb ${score} below ${MIN_IMDB}` });
      return null;
    }
    const rts = v.eps.filter(e => e.runtime);
    return {
      tmdb: v.c.tmdb,
      title: v.target > 1 ? `${base} (S${v.target})` : v.c.title,
      platform: v.c.platform,
      type: v.target > 1 ? 'season' : 'new',
      genre: (om && om.genre) || v.genreFromPage || 'Drama',
      poster: v.c.poster,
      trailer,
      imdb: score,
      imdbId: (om && om.imdbId) || ids.imdbId || null,
      ratingSource: source,
      // Real Rotten Tomatoes numbers, read from the exact page Wikidata named.
      // Still null — and still shown as "—" — whenever that lookup did not land.
      rt: (rtData && rtData.audience) ? rtData.audience.score : null,
      rtCritics: (rtData && rtData.critics) ? rtData.critics.score : null,
      rtCertified: !!(rtData && rtData.critics && rtData.critics.certified),
      rtUrl: rtData ? rtData.url : null,
      season: v.target,
      epCount: v.eps.length,
      firstAir: v.first,
      runtime: (om && om.runtime && Number((om.runtime.match(/(\d+)/) || [])[1])) ||
               (rts.length ? Math.round(rts.reduce((n, e) => n + e.runtime, 0) / rts.length) : 45),
      cast: (om && om.actors) || null,
      overview: (om && om.plot) || null,
      episodes: v.eps.map(e => [e.n, e.title, e.air, e.runtime]),
    };
  })).filter(Boolean);

  kept.sort((a, b) => (b.imdb || 0) - (a.imdb || 0) || b.firstAir.localeCompare(a.firstAir));
  const truncated = verified.length > shortlist.length;
  return {
    ok: true, since, searchedUpTo: todayISO,
    ratingSource: 'IMDb where available, else TMDB',
    found: kept.length, scanned: candidates.length,
    elapsedMs: Date.now() - t0,
    windowDays: plan.days, pagesPerList: plan.pages,
    shows: kept, rejected: rejected.slice(0, 20), upstreamErrors,
    truncated,
  };
}

/* ---- whole-catalogue search, also key-free ---- */
async function runSearch(q, omdbKey) {
  const r = await get('https://www.themoviedb.org/search/tv?query=' + encodeURIComponent(q));
  if (r.status !== 200) return { ok: false, code: 'SEARCH_FAILED', message: `TMDB search unreachable (HTTP ${r.status})` };
  const RE = /<img alt="([^"]*)" class="poster[^>]*?src="https:\/\/media\.themoviedb\.org\/t\/p\/[a-z0-9_]+\/([A-Za-z0-9]+\.jpg)"/g;
  const IDRE = /href="\/tv\/(\d+)[^"]*"><div class="image/g;
  const ids = [...r.text.matchAll(IDRE)].map(m => +m[1]);
  const rows = [];
  let m, i = 0;
  while ((m = RE.exec(r.text)) && rows.length < 15) {
    rows.push({ tmdb: ids[i] || null, title: decode(m[1]).trim(), poster: m[2] });
    i++;
  }
  for (const row of rows.slice(0, 8)) {
    const om = await omdbFor(baseTitle(row.title), omdbKey);
    row.imdb = om ? om.imdb : null;
    row.overview = om ? om.plot : null;
    row.ratingSource = (om && om.imdb !== null) ? 'IMDb' : null;
  }
  return { ok: true, query: q, count: rows.length, shows: rows };
}

/* ---- request handling shared by both hosts ---- */
function readKeys(env) {
  const raw = n => (env[n] === undefined || env[n] === null) ? undefined : String(env[n]);
  const omdbKey = (raw('OMDB_API_KEY') || raw('OMDB_KEY') || '').trim();
  const notes = [];
  if (!omdbKey) notes.push('No OMDB_API_KEY set — IMDb ratings come key-free from IMDb\'s own ratings feed; OMDb would only add plot text.');
  return { omdbKey, notes };
}
function defaultSince() {
  return new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function parseParams(query) {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(query.since || '') ? query.since : defaultSince();
  const knownIds = String(query.known || '').split(',').map(s => s.trim()).filter(Boolean);
  const knownTitles = String(query.titles || '').split('|').map(s => s.trim()).filter(Boolean);
  return { since, knownIds, knownTitles };
}

async function handle(query, env) {
  const { omdbKey, notes } = readKeys(env);

  if (query.selftest) {
    const t = await get('https://www.themoviedb.org/tv?page=1');
    const o = omdbKey ? await getJSON(`https://www.omdbapi.com/?i=tt0903747&apikey=${encodeURIComponent(omdbKey)}`) : null;
    const omdbOk = !!(o && o.Response !== 'False');
    const w = !omdbKey ? await imdbFromWidget('tt0903747').catch(() => null) : null;
    return { status: 200, body: {
      ok: t.status === 200,
      discovery: t.status === 200 ? 'working — no API key needed' : `FAILED: TMDB pages unreachable (HTTP ${t.status})`,
      imdbRatings: omdbKey
        ? (omdbOk ? 'working — via OMDb' : `key rejected: ${(o && o.Error) || 'unknown'}`)
        : ((w && w.imdb) ? 'working — IMDb\'s own ratings feed, no key needed'
                         : 'FAILED: IMDb ratings feed unreachable (and no OMDB_API_KEY set)'),
      notes,
    } };
  }

  try {
    if (query.q) return { status: 200, body: await runSearch(String(query.q).slice(0, 120), omdbKey) };
    const { since, knownIds, knownTitles } = parseParams(query);
    const body = await runDiscover({ omdbKey, since, knownIds, knownTitles, today: query.today });
    if (notes.length) body.notes = notes;
    return { status: 200, body };
  } catch (e) {
    return { status: 200, body: { ok: false, code: 'FAILED', message: String(e.message || e) } };
  }
}

module.exports = { handle, runDiscover, runSearch, defaultSince, PROVIDERS, MIN_IMDB };
