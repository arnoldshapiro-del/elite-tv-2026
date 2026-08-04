/* ---------------------------------------------------------------------------
   build-streaming-top.js — bakes data/streaming-top.json:
   the 20 highest-rated films streaming on each of the five services
   (Hulu, Netflix, Apple TV, Prime Video, HBO Max), every score VERIFIED.

   Bar (Arnie's, 2026-08-03): Tomatometer >= 85% OR IMDb >= 7.5.
   Nothing is invented: candidates come from TMDB's public provider-filtered
   browse pages (JustWatch availability data, published by TMDB), the IMDb
   number from IMDb's own ratings feed by exact tt-id, the RT number from RT's
   own page found via Wikidata, trailers verified through YouTube oEmbed.
   A score that cannot be verified stays null; a film with NO verifiable score
   is rejected outright.

   This runs OFFLINE (a build step, not a serverless function), so it can be
   slow and polite: RT is paced ~1.3s a hit (403 = score lost), YouTube
   searches ~3s apart (the 2026-07-29 rebuild got throttled at full speed).
   Progress is saved to the output file after every service, so a crash keeps
   everything verified so far. Expect a 10-15 minute run.

   Usage: node scripts/build-streaming-top.js            (all five services)
          node scripts/build-streaming-top.js "Apple TV" (one service, merged
          into the existing JSON — for topping up a service that came up short)
--------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const {
  browseStream, tmdbDetail, wikidataIds, rtScoresFor, imdbUserRating,
  trailerFor, pmap, STREAM_PROVIDERS, STREAM_MIN_IMDB, STREAM_MIN_RT_CRIT,
} = require('../lib/movies-core.js');

const OUT = path.join(__dirname, '..', 'data', 'streaming-top.json');
const PER_SERVICE = 20;
const ACCEPT_BUFFER = 24;          // verify a few past 20, keep the best 20
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = base => base + Math.floor(Math.random() * 400);
// LOCAL date, not toISOString() — that is UTC, and after 8pm Eastern it stamps
// tomorrow's date on today's verification (this repo's oldest lesson).
const d0 = new Date();
const todayISO = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') +
  '-' + String(d0.getDate()).padStart(2, '0');
const omdbKey = (process.env.OMDB_API_KEY || process.env.OMDB_KEY || '').trim();
const ONLY = process.argv[2] || null;   // service name -> top up just that one

/* Ordered as Arnie listed them. */
const SERVICES = [
  [15, 'Hulu'], [8, 'Netflix'], [350, 'Apple TV'], [9, 'Prime Video'], [1899, 'HBO Max'],
];

/* Global caches so a film seen on two services is verified exactly once. */
const verdicts = new Map();   // tmdb -> { pass: bool, movie|why }
const trailers = new Map();   // tmdb -> id|null

async function verifiedTrailer(tmdb, title, year) {
  if (trailers.has(tmdb)) return trailers.get(tmdb);
  await sleep(jitter(2800));                       // pace YouTube searches
  let id = await trailerFor(title, year).catch(() => null);
  if (!id) {                                       // throttle or genuinely none —
    await sleep(20000);                            // wait it out and try once more
    id = await trailerFor(title, year).catch(() => null);
  }
  trailers.set(tmdb, id || null);
  return id || null;
}

/* Verify ONE candidate. Returns {pass, movie} or {pass:false, why}. */
async function verify(c, ids) {
  const d = await tmdbDetail(c.tmdb).catch(() => null);
  if (!d) return { pass: false, why: 'TMDB detail page unreadable' };
  const year = d.releaseISO ? +d.releaseISO.slice(0, 4) : null;

  const om = await imdbUserRating(c.title, year, omdbKey, ids.imdbId).catch(() => null);
  const imdb = om && om.imdb !== null ? om.imdb : null;

  await sleep(jitter(1100));                       // pace RT — a 403 costs the score
  const rt = await rtScoresFor(c.title, year, ids.rtSlug).catch(() => null);
  const rtCrit = rt && rt.critics ? rt.critics.score : null;
  const rtAud = rt && rt.audience ? rt.audience.score : null;

  if (imdb === null && rtCrit === null)
    return { pass: false, why: 'no verifiable IMDb or Tomatometer score' };
  if (!((imdb !== null && imdb >= STREAM_MIN_IMDB) || (rtCrit !== null && rtCrit >= STREAM_MIN_RT_CRIT)))
    return { pass: false, why: `below the bar (IMDb ${imdb === null ? '—' : imdb}, Tomatometer ${rtCrit === null ? '—' : rtCrit + '%'})` };

  return { pass: true, movie: {
    tmdb: c.tmdb, title: c.title, services: [],
    year, release: d.releaseISO,
    poster: d.poster || (c.posterFile ? 'https://media.themoviedb.org/t/p/w500/' + c.posterFile : null),
    backdrop: d.backdrop, tagline: d.tagline,
    overview: d.overview || (om && om.plot) || null,
    genre: d.genre || (om && om.genre) || null,
    runtime: d.runtime || (om && om.runtime) || null,
    cert: d.cert || (om && om.rated) || null,
    imdb, imdbVotes: om ? om.votes : null,
    imdbId: (om && om.imdbId) || ids.imdbId || null,
    rtCritics: rtCrit, rtAudience: rtAud,
    rtCertified: !!(rt && rt.critics && rt.critics.certified),
    rtUrl: rt ? rt.url : null,
    tmdbScore: d.tmdbScore,
    cast: d.cast && d.cast.length ? d.cast.map(x => x.name).join(', ') : (om ? om.actors : null),
    castRoles: d.cast || [],
    director: om ? om.director : null,
    trailer: null,
  } };
}

function saveOut(byId, done) {
  const movies = [...byId.values()]
    .sort((a, b) => ((b.imdb || 0) - (a.imdb || 0)) || ((b.rtCritics || 0) - (a.rtCritics || 0)));
  fs.writeFileSync(OUT, JSON.stringify({
    checked: todayISO,
    bar: { imdb: STREAM_MIN_IMDB, rtCritics: STREAM_MIN_RT_CRIT },
    services: SERVICES.map(s => s[1]),
    perService: PER_SERVICE,
    servicesDone: done,
    movies,
  }, null, 1));
}

(async () => {
  const byId = new Map();          // tmdb -> movie (services merged)
  const perSvcCount = {};
  let done = [];

  /* A single-service top-up starts from the existing JSON instead of zero:
     everything already verified stays, that service's slots get another hunt. */
  if (ONLY && fs.existsSync(OUT)) {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    for (const m of prev.movies || []) {
      m.services = m.services.filter(s => s !== ONLY);   // re-earn this service's slot
      if (m.services.length) byId.set(m.tmdb, m);
      if (m.trailer) trailers.set(m.tmdb, m.trailer);    // keep verified trailers
    }
    done = (prev.servicesDone || []).filter(s => s !== ONLY);
    console.log(`Topping up ${ONLY} — keeping ${byId.size} films already verified for the other services.`);
  }

  for (const [pid, name] of SERVICES) {
    if (ONLY && name !== ONLY) continue;
    console.log(`\n=== ${name} (provider ${pid}) ===`);
    const accepted = [];
    const seenHere = new Set();

    /* Candidate pages, best-rated first; progressively relaxed vote floors,
       each used only if the stricter one runs dry before 20 films pass
       verification. The floor is only a candidate-pool filter — every film
       still has to pass the same verified-score bar to get in. (Apple TV's
       small catalogue needs the low tiers: its best shelf is documentaries
       with high RT scores but few TMDB votes.) */
    const tiers = [{ votes: 500, pages: 8 }, { votes: 200, pages: 8 },
                   { votes: 50, pages: 6 }, { votes: 25, pages: 4 }];
    outer:
    for (const tier of tiers) {
      for (let page = 1; page <= tier.pages; page++) {
        const cards = await browseStream(pid, { sort: 'vote_average.desc', page, votes: tier.votes });
        if (!cards.length) break;                 // this list is exhausted
        const fresh = cards.filter(c => !seenHere.has(c.tmdb) && (seenHere.add(c.tmdb), true));

        // one Wikidata query per page of candidates — exact RT + IMDb ids
        const need = fresh.filter(c => !verdicts.has(c.tmdb));
        const idMap = need.length
          ? await wikidataIds(need.map(c => c.tmdb)).catch(() => ({})) : {};

        for (const c of fresh) {
          if (accepted.length >= ACCEPT_BUFFER) break outer;
          let v = verdicts.get(c.tmdb);
          if (!v) {
            v = await verify(c, idMap[String(c.tmdb)] || {});
            verdicts.set(c.tmdb, v);
            if (!v.pass) console.log(`   ✗ ${c.title} — ${v.why}`);
          }
          if (v.pass) {
            accepted.push(v.movie);
            console.log(`   ✓ ${c.title} (IMDb ${v.movie.imdb === null ? '—' : v.movie.imdb}, ` +
              `RT ${v.movie.rtCritics === null ? '—' : v.movie.rtCritics + '%'}) [${accepted.length}]`);
          }
        }
      }
      if (accepted.length >= ACCEPT_BUFFER) break;
      console.log(`   …vote floor ${tier.votes} exhausted at ${accepted.length} accepted`);
    }

    // keep the BEST 20 of what verified, by the verified numbers themselves
    accepted.sort((a, b) => ((b.imdb || 0) - (a.imdb || 0)) || ((b.rtCritics || 0) - (a.rtCritics || 0)));
    const top = accepted.slice(0, PER_SERVICE);
    perSvcCount[name] = top.length;

    for (const m of top) {
      const prev = byId.get(m.tmdb);
      if (prev) { if (!prev.services.includes(name)) prev.services.push(name); }
      else { m.services.push(name); byId.set(m.tmdb, m); }
    }
    done.push(name);
    saveOut(byId, done);           // bank this service before starting the next
    console.log(`   ${name}: ${top.length}/${PER_SERVICE} verified and kept — saved.`);
  }

  // trailers last, once per unique film, verified through oEmbed
  const list = [...byId.values()];
  console.log(`\n=== Trailers for ${list.length} unique films (paced) ===`);
  let t = 0;
  for (const m of list) {
    m.trailer = await verifiedTrailer(m.tmdb, m.title, m.year);
    t++;
    if (t % 10 === 0) { console.log(`   ${t}/${list.length}…`); saveOut(byId, done); }
  }
  saveOut(byId, done);

  console.log('\n=== DONE ===');
  console.log('Per service:', JSON.stringify(perSvcCount));
  console.log('Unique films:', list.length,
    '| with trailer:', list.filter(m => m.trailer).length,
    '| with RT critics:', list.filter(m => m.rtCritics !== null).length,
    '| with IMDb:', list.filter(m => m.imdb !== null).length);
  console.log('Wrote', OUT);
})();
