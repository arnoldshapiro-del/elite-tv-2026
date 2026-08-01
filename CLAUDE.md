# 2026 Elite TV — Ultimate Discovery

## What This App Is
A discovery + tracking app for 60 series across Hulu, Prime Video, Apple TV and
Netflix, PLUS what is playing and opening at Arnie's cinema. Every series clears
IMDb 7.5 and has episodes that actually aired (or are dated) in 2026. Dark
navy/violet design, light-mode toggle. Full episode-by-episode tracking, an Up
Next queue, taste-based recommendations, cast browsing, a key-free live search
for new releases with a time-window dropdown, and a Movies section.

Scores are never invented. Every RT and IMDb number is a published score read
from its own source; anything unverified is null and renders as "—".

## GitHub Repo
arnoldshapiro-del/elite-tv-2026 (branch `main`)

## Live URL
Vercel: https://elite-tv-2026.vercel.app
Netlify: NOT connected yet (free build minutes exhausted until Aug 1, 2026).
`netlify.toml` + a matching function already in the repo — the Aug 1 hookup is
connect-only. Site name to use: `elite-tv-2026`.

## Tech Stack
- Single-file static HTML (index.html), no framework, no build step
- One serverless function (`lib/discover-core.js`, shared by Vercel + Netlify)
- Fonts: Inter + Playfair Display. PWA: manifest.json + icon.svg + icon-maskable.svg
- State in localStorage key `eliteTV2026`: ratings, status, notes, theme, watched
  (episode progress), finds, lists, epRatings, epNotes, lastSearch

## Origin
Started as a Grok 4.5 file on Arnie's Desktop with fabricated trailer IDs and no
posters. Rebuilt from scratch 2026-07-29/30 — full history in SESSION_NOTES.md.
GitHub is the source of truth; the Desktop copy (`tv-shows-2026.html`) is a
personal mirror kept byte-identical.

## Do-not-redo list (each cost real debugging time — read before touching these)
- **Never hand-write a YouTube trailer ID.** Verify via
  `https://www.youtube.com/oembed?url=…&format=json` (200 = exists + embeddable)
  and confirm the returned title actually names the show.
- **`file://` cannot host a YouTube iframe** — always Error 153, no workaround.
  `playTrailer()` is protocol-aware: new tab on `file:`, inline player on `http(s)`.
- **Posters fill the card** (`object-fit: cover`, position centre 20%). A centred-
  poster-with-blurred-bars version once left real art at 115px in a 339px card —
  do not bring back `.art-blur`.
- **Card size is set by the grid's minimum column (430px), not page width.**
  Widening the page alone just fits more, smaller columns.
- **"Find New Shows" needs NO API key.** Discovery reads TMDB's public pages, the
  same source as the posters/episodes/cast. `OMDB_API_KEY` is optional — it only
  upgrades the rating from TMDB's score to real IMDb; never make it required again.
- **Discovery episodes must satisfy `air >= since && air <= today`** — an earlier
  version accepted future dates and reported shows that hadn't aired yet.
- **Interleave discovery candidates round-robin across services** — without it,
  one service (usually Netflix) fills the whole result set.
- **RT is always `null` unless verified.** Never fill it from TMDB's score.
- **NEVER guess a Rotten Tomatoes slug from the title.** It silently returns the
  WRONG FILM for every remake: "Moana" → `/m/moana` is the 2016 original (89% vs
  the 2026 release's real numbers). Resolve the slug through Wikidata (below).
- **Send the browser's LOCAL date as `today`.** The functions run in UTC, so
  after 8pm Eastern an unset `today` makes the server think tomorrow has begun
  and accept episodes that have not aired here yet.
- **Rotten Tomatoes rate-limits.** Hit it hard and it returns 403 and the score
  is lost. RT concurrency stays low, and `/api/movies` is CDN-cached for 6 hours
  so a same-day revisit never touches RT at all.
- **`want` in discover-core is per RUN, not per window.** Asking for 30 in one
  go pushed a one-year search to 55s against a 60s ceiling. It returns a batch
  and sets `truncated`; pressing again picks up the next batch.
- **Movie cards are 2:3, so column width sets card height.** A 300px minimum
  column gave 530px-tall posters that pushed every score below the fold. 260px.

## THE SCORE-MATCHING BRIDGE (the important idea in this repo)
Rotten Tomatoes has no public API — but the score IS in its own page markup, as
the JSON the site renders from. The hard part was never reading it, it was
landing on the RIGHT page. Wikidata solves that: it stores the Rotten Tomatoes
id (P1258) and IMDb id (P345) against the TMDB id, so ONE SPARQL query resolves
a whole batch exactly.
- `P4947` = TMDb **movie** id  → RT id comes back as `m/<slug>`
- `P4983` = TMDb **TV series** id → RT id comes back as `tv/<slug>`
Verified 2026-07-31: Moana → `m/moana_2026`, The Odyssey → `m/the_odyssey_2026`,
Supergirl → `m/supergirl_2026`, Shoresy → `tv/shoresy`, The Boys → `tv/the_boys_2019`.
The same query supplies the IMDb id, so OMDb is asked `?i=tt…` instead of by
title — which removes the same class of mismatch from the IMDb number.
Lives in `lib/movies-core.js` (`wikidataIds`, `rtScoresFor`, `rtForSeries`) and
is required by `discover-core.js`. Failure is always non-fatal: no match → null → "—".

## Architecture: the live search / discovery function
- `lib/discover-core.js` — all logic, one copy shared by both hosts
- `api/discover.js` (Vercel) / `netlify/functions/discover.js` (Netlify, via the
  netlify.toml redirect)
- `/api/discover?since=YYYY-MM-DD&today=YYYY-MM-DD` → new/returning shows
- `/api/discover?q=title` → whole-catalogue search
- `/api/discover?selftest=1` → reports discovery + IMDb-rating status separately
- `planFor(since, today)` scales the search to the window: 1 page per list for a
  week, up to 5 for a year, and verification STOPS once `want` shows have
  passed. Measured 2026-07-31: week 7.7s, 3 months 22s, year 24s (was 55s).
- Capped-concurrency passes, 45s internal budget. `vercel.json` sets
  `maxDuration: 60`. If it ever times out, lower `want` in `planFor` first.
- Client remembers `state.lastSearch`; the New Finds button relabels itself
  "What's new since <date>" and picks up from exactly there.
- Discovered shows arrive with a full episode list, folded into `EPISODES` at
  runtime, so they get tracking/progress/Up Next immediately.
- Found shows get app ids of `100000 + tmdbId` (never collides with 1-60).
  `getShow(id)` resolves either kind everywhere in the app.
- Discovered shows now carry real `rt`, `rtCritics`, `rtUrl` and `imdbId`.

## Architecture: the Movies section
- `lib/movies-core.js`, `api/movies.js`, `netlify/functions/movies.js`
- `/api/movies?mode=now&today=…&minImdb=…&minRt=…` → in theatres now
- `/api/movies?mode=soon&today=…&days=21` → opening in the next N days
- `/api/movies?selftest=1` → TMDB, Rotten Tomatoes and OMDb status separately
- **Cached at the edge for 6 hours** (`s-maxage=21600, stale-while-revalidate`).
  This is load-bearing, not an optimisation — see the RT rate-limit note above.
- Bar: `IMDb >= 7.5 OR RT audience >= 75%`. Both are user scores at the same
  height as the TV list; a brand-new release usually has one before the other.
  Selectable in the UI; applied server-side, so changing it re-runs the search.
- Upcoming films are NOT score-gated — nothing has reviewed them yet. Their
  score slots stay empty rather than being filled with a guess.
- Filters: US release window (now = last 110 days, so restored classics on
  limited re-run do not appear), and non-US certificates (India's A/U/UA, the
  UK's 12A/15/18) are dropped — an 18-screen AMC in Ohio runs US releases.

## SHOWTIMES — real times and formats, via a scheduled browser
The app shows actual showtimes at AMC West Chester 18 with the format (IMAX at
AMC, Dolby Cinema at AMC, RealD 3D, Digital, AMC Artisan Films, Thrills &
Chills, subtitled screenings) and AMC's own "Almost Full"/"Sold Out" note. Each
time links to that exact showing's ticket page.

**It cannot be a serverless fetch, and this was tested hard.** amctheatres.com
sits behind a Queue-it "Global Safety Net". A plain request — minimal headers,
full Chrome header set, referer, warmed cookie jar, every combination — returns
the same 2.6KB JavaScript challenge shell. Passing it needs a real browser to
run their JS and receive a signed `queueittoken`, HMAC'd server-side and not
forgeable. `api.amctheatres.com/v2` wants a vendor key (400). Fandango's
`napi/theaterMovieShowtimes` returns 403 even with cookies, and their
server-rendered theatre page only contains the site-wide "New & Coming soon"
footer. Atom 404s, showtimes.com served a Hawaii theatre, Google and Bing have
zero clock times in their HTML. All probed 2026-07-31.

**So it is a scheduled scrape.** `scripts/scrape-showtimes.js` drives a real
browser — which is simply what a visitor does — and writes `data/showtimes.json`.
`.github/workflows/showtimes.yml` runs it four times a day (6:20am, 11:20am,
4:20pm, 9:20pm ET) and commits only when the schedule changed; Vercel redeploys
on that commit. The app then reads a static file: instant, key-free, unlimited.
- Run it by hand: `node scripts/scrape-showtimes.js 3`
- Puppeteer is installed by the workflow with `--no-save`. **Keep the app itself
  dependency-free** — it must stay a static site with no build step.
- A run that parses zero showtimes exits 1 WITHOUT writing, so a bad scrape can
  never wipe a good schedule off the live site.
- **Do NOT wait for `networkidle2`** — AMC's ad and analytics beacons never go
  quiet and the navigation times out on a page that rendered seconds earlier.
  Wait for `domcontentloaded`, then for the showtime markup to appear.
- AMC ships `aria-label="undefined Showtimes"` on standard screens (a bug on
  their side). The real name is in the block's `<h3>` ("Digital"), so the h3
  wins and the aria-label is only a fallback.
- The UI opens on today, but rolls to the next day once fewer than three films
  still have a screening left — at 11pm "today" is a wall of dead times.

Theatre identifiers (both verified): AMC West Chester 18, 9415 Civic Center
Blvd., West Chester, OH 45069; Fandango theatre id `AAWWU` (from Fandango's own
search — the guessable `aaowu` slug 404s).

## Baked-in data (no API key needed at runtime)
Scraped from TMDB's public pages, committed under `data/`:
- `EPISODES` — 536 episodes, all 60 shows (number, title, air date, runtime)
- `CAST` — 465 top-billed credits (person id, name, photo, character)
- `MEDIA` — poster file, verified trailer id, TMDB id per show
Deliberate: the app keeps fully working if every key lapses.

## Full feature list
Discover: search/filter (platform, genre, type, status, length), 6 sort orders,
grid/list/compact views, poster wall, Surprise Me, Compare.
New Finds: a time-window dropdown — past week / month / 3 months / 6 months /
year — searching all four services for new series and new seasons in that
stretch, plus "since last time" and an exact-date option.
Movies: "Playing Now" at AMC West Chester 18 and "Coming in 3 Weeks", with
poster-forward cards, backdrops, plots, cast with roles, verified trailers,
countdown badges, a want-to-see list, a selectable quality bar, and deep links
to AMC, Fandango, Rotten Tomatoes and IMDb.
Tracking: episode-by-episode ticking with "mark up to here" catch-up, Up Next
queue, progress bars everywhere, watch-time stats, binge planner, per-episode
5-star ratings + notes.
Discovery: For You recommendations (local, taste-based, explains why), custom
lists, where-to-watch deep links (Netflix/Hulu/Prime/Apple + JustWatch), cast
browsing with cross-show lookup, real air-date calendar with countdowns, the
key-free live search above.
Portability: export/import carries everything (ratings, episode progress, lists,
per-episode data, finds) — import merges, never overwrites.

## File Structure
- index.html — the whole app (CSS + HTML + JS + SHOWS/MEDIA/EPISODES/CAST data)
- lib/discover-core.js, api/discover.js, netlify/functions/discover.js
- lib/movies-core.js, api/movies.js, netlify/functions/movies.js
- data/episodes.json, data/cast.json — source data (also baked into index.html)
- manifest.json, icon.svg, icon-maskable.svg, netlify.toml, vercel.json, package.json

## Local testing
There is no build step, but `/api/*` needs a server. `.claude/launch.json` (and
the `elite-tv-2026` entry in `Desktop\.claude\launch.json`, port 8199) points at
a scratchpad dev server that serves the static files AND runs the real cores, so
the whole app can be exercised before deploying. Note: a preview-spawned process
is network-sandboxed and every upstream fetch returns HTTP 0 — run that server
outside the sandbox or the selftest lies to you.

## Known Issues
- RT is resolved through Wikidata, which lags for very new or international
  titles. Those still show "—" (correctly) rather than a guess. Measured
  2026-07-31: 14/14 on films in theatres, 7/12 on a month of TV discoveries.
- Poster/trailer data is hotlinked; a pulled asset falls back gracefully
  (gradient tile / YouTube search) rather than breaking
- Showtimes are linked, not listed — see the SHOWTIMES section above
- The deployment-specific Vercel URL (`elite-tv-2026-<hash>-…vercel.app`)
  requires a login. The public address is **https://elite-tv-2026.vercel.app**
