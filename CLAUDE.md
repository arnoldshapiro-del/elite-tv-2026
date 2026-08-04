# 2026 Elite TV — Ultimate Discovery

## What This App Is
Discovery + tracking for 60 curated 2026 series (Hulu, Prime Video, Apple TV,
Netflix — every one IMDb ≥ 7.5 with episodes really aired/dated in 2026), plus
movies + live showtimes at any US cinema of any chain, plus a key-free live
search for new releases, plus **Best of Streaming**: the 20 highest-rated films
on each of FIVE services (the four above + HBO Max), bar Tomatometer ≥ 85% OR
IMDb ≥ 7.5, baked in verified, with a date-tracked "what's been added since I
last searched" button. Dark navy/violet, light toggle. Episode tracking, Up
Next, dated watch history (streaks, Year-in-Review, rewatches), taste recs +
Match %, custom lists, calendar with .ics export, Narrator read-aloud,
installable PWA with offline shell. Scores are never invented: every RT/IMDb
number is a published score read from its own source; unverified → null → "—".

## Repo / Live
arnoldshapiro-del/elite-tv-2026 (branch `main`).
**Netlify (primary since 2026-08-01): https://elite-tv-2026.netlify.app** —
auto-builds main; full function parity verified (all three `?selftest=1`s, incl.
visitor IP location). Vercel: https://elite-tv-2026.vercel.app — hot spare.

## Tech Stack
- Single-file static index.html (no framework/build) + narrator.js + sw.js
- Serverless cores shared by both hosts: lib/discover-core.js, movies-core.js,
  theaters-core.js. Fonts Inter + Playfair Display. PWA manifest + SVG icons.
- localStorage `eliteTV2026`: ratings, status, notes, theme, watched, finds,
  lists, epRatings, epNotes, lastSearch, watchLog, rewatches, hidden, movieWant,
  movies (cached payloads), place, theatreId, lastExport, nudgeDismissed.
- Origin: rebuilt 2026-07-29/30 from a broken Grok file (fabricated trailer IDs);
  history in SESSION_NOTES.md. GitHub is the source of truth.

## Do-not-redo list (each cost real debugging — read before touching)
- **`short_name` in manifest.json and `apple-mobile-web-app-title` must match
  the page `<title>`'s branding** ("Elite TV Ultimate", not "Elite TV 2026")
  — a mismatch here is exactly what made Arnie think a separate, better
  "Ultimate" app existed (2026-08-02 fix, d773208).
- **Never hand-write a YouTube trailer id.** Verify via oembed (200 = exists +
  embeddable) AND check the returned title names the show.
- **file:// can't host a YouTube iframe** (Error 153). playTrailer() is
  protocol-aware: new tab on file:, inline player on http(s).
- **Posters fill the card** (object-fit cover, centre 20%). Never bring back
  `.art-blur`. **Card size = the grid's min column (430px), not page width.**
- **"Find New Shows" needs NO API key** — TMDB public pages. `OMDB_API_KEY` is
  optional (plot/cast extras only); never make it required again.
- **IMDb ratings are key-free too (2026-08-01).** imdb.com title pages are
  bot-gated (HTTP 202 even with full browser headers) — do NOT scrape them.
  `imdbFromWidget()` (movies-core) reads IMDb's widget ratings feed
  p.media-imdb.com/static-content/…/title/tt…/ratings…data.json by exact tt-id:
  real rating + votes, movies AND TV. OMDb first when a key exists; the feed is
  the fallback and the whole source on Netlify.
- **Discovery episodes must satisfy `air >= since && air <= today`** — an early
  version reported shows that hadn't aired.
- **Interleave discovery candidates round-robin across services** or Netflix
  fills the whole result set.
- **RT is null unless verified — NEVER guess an RT slug from the title** (Moana
  → /m/moana is the 2016 film). Resolve through Wikidata (below).
- **Send the browser's LOCAL date as `today`** — the functions run in UTC; after
  8pm Eastern an unset today accepts episodes that haven't aired here yet.
- **RT rate-limits (403 = score lost).** RT concurrency stays low; /api/movies
  is edge-cached 6h — that cache is load-bearing, not an optimisation.
- **`want` in discover-core is per RUN.** The client auto-continues while
  `truncated` (≤5 passes, banking each) — don't raise `want` instead.
- **Grow-the-collection bars are caller-set** (`?bar=5.0-9.0&want=4-20`,
  defaults 7.5/12 byte-identical). The TMDB browse floors MUST follow the
  caller's bar — TMDB never returns shows under its floor, so a 6.0 request
  with fixed floors comes home empty. Grow never moves state.lastSearch.
- **Discover's time budget is host-aware:** `process.env.VERCEL ? 45s : 25s`
  (Vercel ceiling 60s via vercel.json; Netlify ~30s). Never exceed a host cap.
- **/api/theaters on Netlify must stay Functions 2.0 (.mjs).** v1 never sees
  visitor location; v2 `context.geo` → the x-nf-client-* headers the core
  reads. Don't "simplify" it back to exports.handler.
- **Movie cards are 2:3 — column width sets height.** 260px min, not 300px.
- **HBO Max = TMDB provider id 1899** (the "Max"-era id still answers after the
  2025 rename back; the OLD id 384 returns an empty page — probed 2026-08-03).
  All five: 15 Hulu, 8 Netflix, 350 Apple TV, 9 Prime Video, 1899 HBO Max.
- **Best of Streaming refresh path:** `node scripts/build-streaming-top.js`
  (10-15 min, paced for RT/YouTube; add a service name arg to top up just one)
  then `node scripts/bake-streaming-top.js` (splices data/streaming-top.json
  into index.html between /*STREAMTOP:BEGIN*/…/*STREAMTOP:END*/). Never edit
  the baked const by hand.
- **Apple TV's catalogue is small** — its top-20 needs the low TMDB vote tiers
  (50/25) or it stalls at 13; the low floors are candidate filters only, the
  verified-score bar still gates. Build scripts must stamp `checked` with the
  LOCAL date, not toISOString() (UTC rolled it to tomorrow once already).
- **The movie "what's new" search is exclusion-driven, not date-driven:** the
  client sends every known tmdb id (baked + finds); the date is honest
  bookkeeping for the label. Don't "optimise" the known list away.
- **Narrator walk root is document.body** — the modals live OUTSIDE `.app`; an
  open modal is the visible page. Backdrop clicks close, never start reading;
  every app control/card is guarded via CTRL_SEL + [onclick].

## THE SCORE-MATCHING BRIDGE (the important idea in this repo)
RT has no public API but the score IS in its page markup. The hard part is
landing on the RIGHT page: Wikidata stores RT id (P1258) + IMDb id (P345)
against the TMDB id (P4947 movies / P4983 TV), so ONE SPARQL query resolves a
whole batch exactly — RT ids come back as `m/<slug>` or `tv/<slug>`, and OMDb
is asked by `?i=tt…`, never title. Lives in movies-core (`wikidataIds`,
`rtScoresFor`, `rtForSeries`); required by discover-core. Failure is always
non-fatal → null → "—".

## /api/discover (lib/discover-core.js)
- `?since=YYYY-MM-DD&today=…` new/returning shows · `?q=title` catalogue search
  · `?selftest=1` names discovery + IMDb-rating status separately.
- planFor scales pages to window (week=1 → year=5); verification stops at
  `want`; capped concurrency. Client remembers `state.lastSearch` ("What's new
  since <date>"), auto-continues truncated runs, and folds found shows (with
  full episode lists) into EPISODES so tracking works immediately. Found ids =
  100000 + tmdbId (never collides with 1-60); getShow() resolves both.

## /api/movies (lib/movies-core.js)
- `?mode=now|soon&today=…&minImdb=…&minRt=…&days=…` · `?selftest=1` (incl.
  streamingBrowse probe) · `?mode=stream&known=<csv tmdb ids>&want=…` — the
  Best of Streaming search: browses all five providers two ways (vote_average
  + fresh releases), excludes `known`, verifies RT/IMDb, fixed bar 85%/7.5,
  round-robin interleave, truncated/press-again. Client sends nocache=1
  (known varies per user; the 6h edge cache would serve someone else's run).
- Edge-cached 6h (s-maxage=21600 + SWR) — see RT rate-limit above.
- Bar: IMDb ≥ 7.5 OR RT audience ≥ 75% (user-selectable, applied server-side).
  Upcoming films are NOT score-gated (nothing has reviewed them) — slots stay
  empty. Filters: US window (now = last 110 days), non-US certificates dropped.

## /api/theaters (lib/theaters-core.js) — any US cinema, any chain
- Source: **Fandango's own napi** `theaterswithshowtimes?zipCode|city+state…`.
  It answers 403 to bare fetches — needs a browser `Accept` AND a `Referer` to
  the matching Fandango page (`fandangoHeaders()`; do not "tidy" them away).
- `?zip= | ?city=&state= | ?lat=&lon=` · `?locate=1` · `?selftest=1`. Cached
  30 min (expired flags move with the clock); locate never cached.
- **Format comes from AMENITIES, not filmFormatHeader** ("IMAX", "Dolby Cinema
  @ AMC", RPX, XD…); FORMAT_RULES is ordered on purpose.
- Location, best first: typed ZIP/city (remembered in state.place) → browser
  geolocation reverse-geocoded → host IP headers (x-vercel-ip-* / x-nf-client-*).
- **Two concurrency traps, both paid for:** the 11pm auto-rollover to tomorrow
  must call `loadTheatersInner()` (the queue wrapper would wait on itself), and
  every lookup takes a ticket (`theatresSeq`) so a slow IP lookup can't
  overwrite a typed ZIP. UI rolls to tomorrow when <3 films still have a
  showing left. Retired AMC-only scraper: scripts/_retired/ (kept, not wired).

## Feature list (client)
Discover: filters (+tap-to-filter hero pills), 8 sorts, 3 views, wall,
Surprise, Compare, Match % chips, 🚫 hide/restore, finds unified into
grid/search. ❓ Guide tab explains everything in plain English. New Finds has
"Grow the collection" (N more per service at a chosen bar). Theatre picker
cards carry street addresses; nav tabs wrap on phones. Tracking: ticks + mark-up-to,
Up Next (▶ service links, Airing-this-week strip), binge planner, per-episode
5★+notes, watchLog → streaks / 30-day activity / "2026 So Far" / lifetime,
↻ Watch again. Calendar: countdowns, nav badge, 📅 .ics export (-P1D alarms).
Movies: now / 3-weeks / 🏆 Best of Streaming (92 verified films, service pills,
NEW badges 14 days, date-tracked new-additions search, finds in streamFinds) /
⭐ My list (includes starred streaming picks), cinema picker, 7-day tabs, live
showtimes.
Narrator everywhere. PWA: offline shell, capped poster cache, 📲 install.
Export/import v4 merges, never overwrites. Monthly backup nudge at 25+ items.
Footer carries Created/Revised dates — keep Revised current.

## Files
index.html (app + SHOWS/MEDIA/EPISODES/CAST/STREAMTOP data) · narrator.js
(donor: trend-check-pro — canonical) · sw.js · lib/{discover,movies,theaters}-core.js ·
api/*.js (Vercel) · netlify/functions/{discover,movies}.js + theaters.mjs ·
data/*.json (source data, also baked in; streaming-top.json = Best of
Streaming) · scripts/{build,bake}-streaming-top.js (refresh path) ·
manifest.json, icons, netlify.toml (includes /sw.js no-cache header),
vercel.json, package.json.

## Local testing
No build step, but /api/* needs a server: `scripts/devserver.js` (IN the repo
since 2026-08-01 — scratchpad copies kept getting deleted), launch.json entry
`elite-tv-2026`, port 8199. ⚠️ A preview-spawned server is network-sandboxed —
upstream fetches return HTTP 0 and the selftest lies. Run it via plain node
for real API tests, or test against the live Netlify URL.

## Known issues
- Wikidata lags very new/international titles → RT stays "—" (correctly).
  Measured 2026-07-31: 14/14 films in theatres, 7/12 on a month of TV finds.
- Poster/trailer data is hotlinked; pulled assets fall back gracefully.
- The deployment-specific Vercel URL requires login; public addresses are the
  two in "Repo / Live" above.
