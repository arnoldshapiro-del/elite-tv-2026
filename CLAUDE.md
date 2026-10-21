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
installable PWA with offline shell. **English-language titles only by default**
(2026-09-16): a remembered Language box (Discover / New Finds / Best of
Streaming) flips to All languages; nothing is deleted, only set aside. **⭐ Added by Me** (2026-10-01): a fourth Discover category
for shows Arnie picks himself — any year, any language, no 7.5 bar (first six:
the Harlan Coben series from a MovieWeb list). Scores are never invented: every RT/IMDb
number is a published score read from its own source; unverified → null → "—".

## Session handoff (do this every session)
- Start: read `SESSION_NOTES.md` (the dated journal) and `CONTINUATION.md` if present, before touching anything. The newest entry says what was decided, what was verified and what is next.
- Wrap-up: add a dated entry to `SESSION_NOTES.md` with what was asked, what changed, what was verified (and how) and what is next. Commit and push it together with the work.
- Every settled decision goes in the ledger below as ONE line: what we decided, why, and what was ruled out and why. Every correction Arnie gives gets logged with his reason. Reasons matter more than facts: facts can be re-derived from the code, reasons cannot.
- Unsure what was agreed? Re-read this file and the journal before asking Arnie again.

## Decisions and why (one line each, newest last)
- Scores are never invented: every RT/IMDb number is read from its own source, unverified → null → "—" (2026-07-29, the founding rule after the Grok file's fabricated data). Ruled out: plausible-looking guesses, because they ship looking right.
- Never hand-write a YouTube trailer id; verify via oembed AND check the returned title names the show (2026-07-29). Why: 16 of the Grok file's 19 ids did not exist and 2 pointed at the wrong video. Ruled out: trusting cached ids.
- playTrailer() is protocol-aware: new tab on file:, inline player on http(s) (2026-07-29). Why: file:// cannot host a YouTube iframe (Error 153), proven with a controlled test page; no client-side fix exists.
- GitHub (branch main) is the source of truth; the Desktop copy is a mirror and GitHub wins if they diverge (2026-07-29). Why: the deployed app builds from the repo.
- Find New Shows uses TMDB for discovery and OMDb for genuine IMDb ratings; RT shows "—" when unverified (2026-07-29, Arnie's choice). Why: RT has no public API; he chose enforcing the other half of the bar for real. Ruled out: a guessed RT number.
- Found-show ids = 100000 + tmdbId (2026-07-29). Why: can never collide with the curated 1-60; getShow() resolves both.
- Dates come from LOCAL date parts, never toISOString() (2026-07-29, the repo's oldest lesson, re-applied to build scripts 2026-08-03). Why: UTC rolls the date to tomorrow during a US evening.
- Where-to-watch links are derived from platform + title, not fetched (2026-07-30). Why: they cannot go stale and need no key.
- Cast cross-reference and taste recommendations are computed locally in the browser (2026-07-30). Why: no key, and nothing about his taste leaves the browser.
- Rating an episode marks it watched (2026-07-30). Why: you cannot rate what you have not seen.
- Import merges, never replaces (2026-07-30). Why: an import should never lose data.
- Discovery runs on TMDB's public pages with NO API key; OMDb is optional enrichment only (2026-07-30). Why: Arnie said "definitely" and the private-API button did nothing while his key sat unverified. Ruled out: making any key required again.
- Discovery episodes must satisfy air >= since AND air <= today (2026-07-30). Why: an early version reported shows that had not aired.
- Discovery candidates interleave round-robin across services (2026-07-30). Why: one run returned 12 Netflix shows and nothing else.
- Discover header averages only shows that actually have each score (2026-07-30). Why: counting unverified RT as zero understated the average.
- Discovery runs as capped-concurrency passes inside a time budget; the client auto-continues truncated runs, banking each pass (2026-07-30, budget host-aware 2026-08-01). Why: the first draft took 134s, fatal in a serverless function. Ruled out: raising `want`.
- RT pages are found through Wikidata (P1258 + P345 against the TMDB id), never by guessing a slug from the title; OMDb is asked by tt-id (2026-07-31). Why: a guessed slug returned the 2016 Moana's 57% for the 2026 film. Ruled out: title-derived slugs.
- RT's title is read from og:title, not the h1 (2026-07-31). Why: the h1 wraps the title in a nested sr-text and the regex never matched.
- `want` is per run and verification stops once enough shows pass (2026-07-31). Why: a one-year search took 55s against a 60s ceiling; now 24s.
- The browser sends its local date as `today` (2026-07-31). Why: the functions run in UTC; after 8pm Eastern the server thought tomorrow had started.
- "Now playing" is bounded to the last 110 days and non-US certificates are dropped (2026-07-31). Why: restored classics on re-run (a 1997 anime) and Indian/UK certificates leaked in.
- Movie cards: 2:3 posters, 260px minimum column (2026-07-31). Why: 300px gave 530px-tall cards that pushed every score below the fold.
- /api/movies is edge-cached 6h, load-bearing (2026-07-31). Why: RT rate-limits (403 = score lost). Ruled out: treating the cache as an optimisation to remove.
- Showtimes come live from Fandango's own napi with a browser Accept AND a Referer header (2026-08-01). Why: its 403 "session expired" was a headers problem, not a session problem. Ruled out: the scheduled headless AMC scraper (retired to scripts/_retired/, archived not deleted).
- Premium format comes from the amenity list, not filmFormatHeader (2026-08-01). Why: the header is coarse; FORMAT_RULES is ordered on purpose.
- The 11pm auto-rollover calls loadTheatersInner(), and every lookup takes a ticket (2026-08-01). Why: the queue wrapper waited on itself, and a slow IP lookup overwrote a typed ZIP.
- "Coming in 3 Weeks" stays national, not per-cinema (2026-08-01). Why: cinemas do not publish schedules that far out.
- IMDb ratings are key-free via IMDb's widget ratings feed by exact tt-id; OMDb first when a key exists (2026-08-01). Why: no OMDb key on Netlify and setting env vars was blocked; imdb.com title pages are bot-gated (HTTP 202). Ruled out: scraping imdb.com pages.
- /api/theaters on Netlify is Functions 2.0 (.mjs) (2026-08-01). Why: v1 functions never see visitor location; context.geo feeds the headers the core reads.
- Netlify is the primary host, Vercel the hot spare (2026-08-01). (reason not recorded)
- Narrator walks from document.body and backdrop clicks only close (2026-08-01). Why: the modals live outside .app, so an open modal is the visible page.
- Skipped on purpose (2026-08-01): "leaving soon" (no honest key-free source), social/accounts (local-first philosophy), push notifications (the .ics route needs no server and rings his phone).
- Finds are unified into the main grid and search (2026-08-01, supersedes the 2026-07-29 separate section). (reason not recorded)
- Grow the collection: bars are caller-set, TMDB browse floors follow the caller's bar, and Grow never moves state.lastSearch (2026-08-01). Why: fixed floors return nothing for a 6.0 request; Grow is an extra sweep, not the "what's new" bookkeeping.
- scripts/devserver.js lives in the repo (2026-08-01). Why: scratchpad copies kept getting deleted.
- CLAUDE.md is kept lean under a size budget (8KB per commits cedc030/9ef8e4e/e60d1ad; trimmed again 05362f9). (reason not recorded) Note: the file already exceeds it; the sections added 2026-10-21 were requested by Arnie.
- Install name is "Elite TV Ultimate" in manifest short_name and apple-mobile-web-app-title, matching the page title (2026-08-02). Why: two names for one app made Arnie think a second "Ultimate" app existed.
- Best of Streaming: 20 films per service on five services, fixed bar RT ≥ 85% OR IMDb ≥ 7.5, every score verified and baked (2026-08-03). A film on two services counts for both, same rule as the TV side. HBO Max is TMDB provider 1899, because 384 answers an empty page (probed).
- Apple TV uses low vote tiers (50/25) in the build script (2026-08-03). Why: it stalled at 13 of 20; the floors widen candidates only, the verified bar still gates.
- The movie "what's new" search is exclusion-driven (client sends every known tmdb id) with nocache=1 (2026-08-03). Why: `known` varies per user under the shared 6h cache; the date is only the label.
- English-language titles only by default, as a browse-time filter (`with_original_language=en`), with a remembered Language box; foreign titles are set aside, never deleted (2026-09-16). Why: Arnie asked for English only, and his "archive, never destroy" rule. Unknown language stays visible, because hiding on a guess would be invented data; now/soon are never gated server-side because the edge cache is shared.
- Language data is baked by scripts (annotate + bake), never hand-typed (2026-09-16). (reason not recorded)
- Services are a mix-and-match set: tap adds, tap again drops, All clears, dropping the last relights All; Clear filters leaves the set alone (2026-09-16). Why: Arnie's correction, "click one and highlight it, click the next and it shows two… how do I clear?" and the page may never show nothing. Ruled out: the single-choice dropdown.
- ⭐ Added by Me: his own picks as SHOWS 76+ with type "mine", no 7.5 bar, any year or language, never hidden by the Language box, hero blurb counts only the curated set (2026-10-01). Why: only one of the six Harlan Coben series clears 7.5, which is why "mine" has no bar.
- Service comes from TMDB's US watch page, not the article (2026-10-01). Why: MovieWeb said Netflix for No Second Chance; in the US it is Prime Video's France Channel add-on.
- Added by Me has its own gold top-nav tab (#mine), the filter-row button kept as a second route (2026-10-01). Why: Arnie's correction, "Where does it say Added by Me? I don't see it anywhere." The button sat ~1,000px down on a phone and his shows sorted to slots 56-61 of 72.
- Session memory lives in this file and `SESSION_NOTES.md`, never only in chat: cloud sessions start on a fresh computer, chat history gets compacted, and only files in the repo survive (2026-10-21, after Dylan Davis's "decisions.md" video). Ruled out: a separate decisions.md, because this file is the one Claude Code re-reads after compaction.

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
  the page `<title>`'s branding** ("Elite TV Ultimate") — a mismatch made Arnie
  think a separate "Ultimate" app existed (fixed 2026-08-02, d773208).
- **Never hand-write a YouTube trailer id.** Verify via oembed (200 = exists +
  embeddable) AND check the returned title names the show.
- **file:// can't host a YouTube iframe** (Error 153). playTrailer() is
  protocol-aware: new tab on file:, inline player on http(s).
- **Posters fill the card** (object-fit cover, centre 20%). Never bring back
  `.art-blur`. **Card size = the grid's min column (430px), not page width.**
- **"Find New Shows" needs NO API key** — TMDB public pages. `OMDB_API_KEY` is
  optional (plot/cast extras only); never make it required again.
- **IMDb ratings are key-free.** imdb.com title pages are bot-gated (HTTP 202)
  — do NOT scrape them. `imdbFromWidget()` (movies-core) reads IMDb's widget
  ratings feed by exact tt-id: real rating + votes, movies AND TV. OMDb first
  when a key exists; the feed is the fallback and the whole source on Netlify.
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
- **Streaming provider ids: 15 Hulu, 8 Netflix, 350 Apple TV, 9 Prime Video,
  1899 HBO Max** (old 384 returns an empty page — probed 2026-08-03).
- **Best of Streaming refresh:** `node scripts/build-streaming-top.js` (10-15
  min, paced; a service-name arg tops up just that one) then
  `node scripts/bake-streaming-top.js` (splices the JSON between the STREAMTOP
  markers). Never edit the baked const by hand. Apple TV needs the low vote
  tiers (50/25) or it stalls at 13 — floors filter candidates only, the
  verified bar still gates. Stamp `checked` with the LOCAL date, never
  toISOString() (UTC rolled it to tomorrow once).
- **The movie "what's new" search is exclusion-driven, not date-driven:** the
  client sends every known tmdb id (baked + finds); the date is bookkeeping
  for the label. Don't "optimise" the known list away.
- **Narrator walk root is document.body** — the modals live OUTSIDE `.app`; an
  open modal is the visible page. Backdrop clicks close, never start reading;
  every app control/card is guarded via CTRL_SEL + [onclick].
- **English-only is a BROWSE-time filter** (`with_original_language=en` on TMDB's
  public pages, verified 2026-09-16; `?lang=any` lifts it). Results carry `lang`;
  the client hides by `state.langMode`. Never gate now/soon server-side (shared
  edge cache). Unknown language = visible; older finds back-fill via `?lang_of=`.
- **Language data is baked, never hand-typed:** `node scripts/annotate-languages.js
  && node scripts/bake-languages.js` (SHOW_LANG + `lang` on STREAMTOP films).
- **His own lists never filter by language or service** (watchlist, Up Next,
  Calendar, Stats, lists) — only discovery surfaces do.
- **Services are a mix-and-match SET** (`state.services`, empty = all five): one
  set drives hero pills, #svcFilter, #streamSvc and the searches' `?providers=`.
  Tap = toggle, All = clear, last one dropped relights All. Clear filters must
  NOT touch it. A "Hulu · Netflix" find matches if EITHER is lit.
- **⭐ Added by Me = SHOWS ids 76+ with `type:"mine"`** (2026-10-01). His own picks:
  no 7.5 bar, any year/language, carry `added`/`addedFrom`/`addedUrl` + `imdbId`/`rtUrl`.
  **They have their own gold top-nav tab (`#mine`, renderMine(), refreshed by every
  render())** — the Discover type-row button alone was invisible to him (three
  screens down on a phone; his shows sorted to slots 56-61 of 72). Keep the tab.
  `langOk()` always lets them through (his own list — the Language box never hides
  them); the hero blurb counts only the curated set. `typeLabel(s)` is the one place
  the category name lives. To add more: append to SHOWS, MEDIA, EPISODES, CAST_RAW
  (data from each show's own TMDB pages, scores via wikidataIds → imdbFromWidget /
  rtForSeries, trailer oembed-verified), then annotate+bake languages, and record the
  provenance in data/added-by-me.json. Check the US service on TMDB's /watch?locale=US
  page — an article's "on Netflix" can be wrong (No Second Chance is Prime Video's
  France Channel add-on in the US).
- **Working copies are CRLF (autocrlf=true):** anchor patches match on LF, write
  back CRLF. `.claude/launch.json` is git-ignored — run `node scripts/devserver.js`
  by hand (the pane refuses SW registration on localhost; production is fine).

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
Discover: filters (+mix-and-match hero pills — tap to add, tap again to drop,
**All** clears; the same set in the filter row and Best of Streaming), a
remembered **Language** box (English only / All languages — tags on foreign
cards, Language row in every modal), **✕ Clear filters** whenever anything is
narrowing the page, 8 sorts, 3 views, wall,
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
Streaming; languages.json = original language of every baked title;
added-by-me.json = provenance + verified scores of the ⭐ Added by Me shows) ·
scripts/{build,bake}-streaming-top.js (refresh path) ·
scripts/{annotate,bake}-languages.js (language refresh path) ·
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

## Compact Instructions
When this conversation is compacted, the summary must keep, in this order:
1. Every decision made this session, with its reason and what was ruled out.
2. Every correction Arnie gave, in his words where possible, and his reason.
3. What has been verified and how (test run, build, live check with URL and time) versus what is only claimed or planned.
4. What is next and what is still open, including anything waiting on Arnie's yes.
5. The exact files changed, the branch, and whether the work is committed and pushed.
Drop tool output, file contents and search results; they can be re-read from disk.
