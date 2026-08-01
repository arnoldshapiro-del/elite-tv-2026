# Session Notes — 2026 Elite TV — Ultimate Discovery

## Session — 2026-08-01 (the movies section becomes national)

Arnie: find where the person is, let them pick from the cinemas near them, keep
the showtimes and the IMAX / Dolby / standard labelling — make it work for
anybody in the United States.

**I had to overturn my own conclusion from a few hours earlier.** The previous
note says no free source publishes theatre-level showtimes to a server, and that
is why there was a scheduled headless-browser scraper for one AMC. The claim was
based on Fandango's API returning `403 Session expired or invalid token`. It
does — to a bare fetch, and to a fetch with a real User-Agent. What it actually
wants is a browser `Accept` header **and** a `Referer` pointing at the matching
Fandango page. Send both and it hands over plain JSON for any ZIP or city in the
country: every chain, with distance, coordinates, amenities, premium formats and
each showing's own ticket link. Checked against West Chester, New York, Beverly
Hills, Chicago, Austin and Anchorage.

The lesson worth keeping: a 403 that says "session" is a headers problem until
proven otherwise. I had read it as "needs a browser session" and built a browser
around it, when two headers were the whole story.

**So the scraper is retired** to `scripts/_retired/` (archived with a README and
its final snapshot — not deleted), and showtimes are now live per request rather
than a four-times-a-day snapshot of a single cinema.

**What the Movies tab does now**
- Works out where you are three ways: the host's IP headers on arrival with no
  permission prompt, the browser's own geolocation behind a button, or a typed
  ZIP or city. Whichever you use is remembered.
- Lists every cinema near you with distance, chain and premium formats. Tap to
  switch; the choice sticks between visits.
- Puts that cinema's real showtimes on the film cards, format resolved from the
  amenity list rather than Fandango's coarse header — IMAX, Dolby Cinema, RPX,
  XD, ScreenX, 4DX, D-BOX, PLF, 3D, Standard.
- Seven days to choose from, and it rolls to tomorrow on its own once fewer than
  three films still have a screening left today.
- Names the films on at that cinema that missed the quality bar, rather than
  dropping them silently.

**Two concurrency bugs, both only visible against the live site** (localhost has
no IP-geolocation headers, so the automatic lookup fails fast and hides them):
- The auto-rollover called `loadTheaters()`, whose queue wrapper waits on the
  in-flight lookup — itself. It calls `loadTheatersInner()` now.
- A slow automatic lookup could land after a typed ZIP and overwrite it, so you
  ended up looking at the city the IP guessed. Every lookup takes a ticket now
  and a stale reply drops its own result.

**Verified live: 16 assertions, 16 passed.** 11 cinemas across 8 chains for
45069, 12 for 10001, switching cinemas, switching cities, real ticket links,
IMAX and Dolby Cinema labelled, no console errors.

**Not done:** the "Coming in 3 Weeks" list is still national rather than
per-cinema — cinemas do not publish schedules that far out, so there is nothing
local to attach to it.


## Session — 2026-07-31 (movies, time-window search, real RT scores)

Arnie asked for three things: a time-window search for newly released TV, a
search for what is playing at his AMC, and one for what opens in the next three
weeks — all with the same rating bar, beautiful cards, trailers and summaries.

**The showtimes problem, settled up front.** Probed every plausible source
before writing any code: AMC's own theatre page (200 but a 2.6KB bot-challenge
shell), `api.amctheatres.com/v2` (400, wants a vendor key), Fandango's
`napi/theaterMovieShowtimes` (403 "Session expired or invalid token", still 403
with a warmed cookie jar), Fandango's server-rendered theatre page (the movie
list in it is the site-wide "New & Coming soon" footer, not the theatre's
lineup), Atom Tickets (404), showtimes.com (served a Hawaii theatre), Google and
Bing (zero clock times in the HTML). Nothing free publishes theatre-level
showtimes to a server. So the app does not print showtimes. It lists what is in
US theatres and links straight to the real listings. Fandango's own search DID
give the correct theatre id — `AAWWU`, 9415 Civic Center Blvd — which the
guessable `aaowu` slug does not (404).

**The score-matching problem, and the bug it would have caused.** Rotten
Tomatoes publishes its scores inside its own page markup, so reading them is not
guessing. Landing on the right page is the hard part. Slugs look predictable —
"Spider-Man: Brand New Day" → `spider_man_brand_new_day` is exact — so the first
draft guessed. It returned **the 2016 Moana's 57% for the 2026 release**, and
the 1984 Supergirl's scores for the 2026 one. That is precisely the invented-
score failure this repo's rules exist to prevent, and it would have shipped
looking completely plausible. Fixed by resolving the slug through Wikidata
(P1258 against P4947 for films, P4983 for series) — one SPARQL query per batch,
and it returns `m/moana_2026` and `m/the_odyssey_2026` correctly. The same query
yields IMDb ids, so OMDb is now asked by id rather than by title.

**That bridge works for TV too**, which closed the app's oldest gap: New Finds
cards had shown "RT —" since the day the feature was built. They now carry real
Popcornmeter and Tomatometer scores wherever Wikidata has the id (7/12 on a
month of discoveries; the rest are too new or too international and correctly
stay dashed).

**Also fixed along the way**
- RT's `<h1>` wraps the title in a nested `<sr-text>`, so a "no angle brackets
  inside" regex never matched and every score came back null. Uses `og:title`.
- A one-year TV search took 55s against a 60s function ceiling and ran out of
  time before fetching trailers. Verification now stops as soon as enough shows
  have passed, and `want` is per-run rather than per-window: **55s → 24s**, with
  trailers intact. Week 7.7s, 3 months 22s.
- `today` is now sent from the browser. The functions run in UTC, so after 8pm
  Eastern the server thought tomorrow had started.
- TMDB's now-playing list carries restored classics on limited re-run (a 1997
  anime dated 2024 turned up); "now" is bounded to the last 110 days.
- Non-US certificates (India's A/U/UA, the UK's 12A/15/18) are dropped.
- Movie posters are 2:3, so the column minimum sets card height — 300px gave
  530px-tall cards that pushed every score below the fold. 260px.
- RT rate-limits (403 after repeated hits), so `/api/movies` is CDN-cached for
  six hours. That is load-bearing, not an optimisation.

**Verified on the live site: 38 assertions, 38 passed.** 14 films playing with
14/14 real RT audience and critic scores, 11/14 real IMDb, 14/14 verified
trailers, plots, cast and posters; 14 films opening inside the 3-week window,
sorted soonest first, with no invented scores; the TV dropdown returning 12
shows all clearing IMDb 7.5; every pre-existing tab still rendering; zero
console errors; no horizontal scroll at 390px.

**Not done:** actual showtimes (no source exists), and the "soon" list can still
include the occasional international release that will not play at this AMC —
unreleased films have no certificate to filter on yet.

## Session — 2026-07-29 (repair + first deploy)

**Starting point:** a single `tv-shows-2026.html` on Arnie's Desktop, built by
Grok 4.5. Two complaints: "Play Trailer" threw error messages instead of playing,
and there were no images for the shows.

**Bug 1 — fabricated trailer IDs.** Tested all 19 cached YouTube IDs against
YouTube's oEmbed endpoint:
- 16 of 19 returned HTTP 404 — the videos do not exist
- 2 of the 3 that resolved pointed at the wrong video entirely:
  "The Bear" → *Microservices | KRAZAM*; "Slow Horses" → *Long Way Down:
  Mariana Trench | National Geographic*
- the remaining 41 shows had no ID at all → "No cached trailer ID for this title"

**Bug 2 — `file://` cannot host a YouTube player.** Built a controlled test page
with a verified-good video ID and opened it over `file://`: still **Error 153**.
Proven that the origin, not the data, causes that error. No client-side fix
exists, so `playTrailer()` was made protocol-aware (new tab on `file:`, inline
player on `http(s)`).

**What was rebuilt:**
- Scraped + verified fresh data for all 60 shows. Pipeline went through several
  iterations: first run was throttled by YouTube after 8 searches and had a TMDB
  regex bug (`no_image_holder` appears in the class list even when a poster
  exists), so it was rewritten with pacing, backoff and incremental saves.
- Posters: 60/60 from TMDB, matched on exact title, all verified HTTP 200.
  Recovering the last 11 needed two fixes — TMDB drops the URL slug for shows
  with non-Latin original titles, and unaired shows have no release date.
- Trailers: 60/60 real, embeddable, all official channels. A scoring pass weighs
  official-channel + is-a-trailer + correct-season, with a penalty for
  announcement/renewal/"everything we know" clips.
- Rejected by hand: the 2005 Brad Pitt/Angelina Jolie *film* trailer that an
  automated pass proposed for `Mr. & Mrs. Smith (S2)`, and a social-post renewal
  clip for `The Morning Show (S5)`.
- Real posters on cards (all 3 views), modal headers, and the "10 more series"
  thumbnails. Blurred-backdrop + contained-poster treatment so nothing crops
  into faces.
- Fixed a readability bug the posters exposed: in light mode the card titles were
  dark text over dark artwork. Titles are now white on a dark scrim in both themes.
- Added Created/Revised dates to the footer (standing order).

**Verified before deploy:**
- script block parses; MEDIA has 60 entries, 60 posters, 60 trailers, 0 duplicates,
  0 malformed IDs
- all 60 poster URLs → HTTP 200
- all 60 trailer IDs → oEmbed HTTP 200
- live playback test: one click → `paused: false`, unmuted, a full 2:55 official
  Apple TV trailer
- grid / list / compact views and both themes screenshotted

**Deploy (this session):**
- New repo created: arnoldshapiro-del/elite-tv-2026 (born on `main`)
- Added PWA (manifest + 2 SVG icons) and `netlify.toml` from the start
- Pushed to GitHub, deployed to Vercel
- Desktop `.url` shortcut placed; gallery card added to arnies-app-showcase
- Backup of the original Grok file kept at
  `Desktop\tv-shows-2026.BACKUP-2026-07-29.html`

**Note:** the Desktop `tv-shows-2026.html` remains as Arnie's local copy, kept in
sync with the repo. GitHub is the source of truth for the deployed app — if the two
ever diverge, GitHub wins.

## Session — 2026-07-29 (part 2: the "Find New Shows" button)

Arnie asked whether a button could go out, find new shows / new seasons on those
four services that meet the criteria, and bring them back into the app in
addition to what's there. Answer: yes, with one honest limit.

**The limit, stated up front:** Rotten Tomatoes has no public API, so RT Audience
cannot be automated for new shows. Arnie chose the option that enforces the other
half of the bar for real: TMDB for discovery + OMDb for genuine IMDb ratings,
with RT shown as "—" rather than a guessed number. He also chose to keep new
finds in their own labelled section rather than blended into the main grid.

**Built:**
- `lib/discover-core.js` + a Vercel function and a Netlify function sharing it.
  Keys stay in host environment variables; the browser never holds one.
- New Finds tab: date picker, one button, live status panel, cards in the same
  style with a NEW FIND badge and a per-card remove button.
- Finds are stored in localStorage keyed by TMDB id, with app ids offset by
  100000 so they can never collide with the curated 1-60. Added `getShow(id)` so
  modals, ratings, watchlist and trailers work on both kinds.
- Added the verified TMDB id to all 60 MEDIA entries so de-duplication is exact
  rather than a fuzzy title match.

**Tested with a local dev server that runs the real handler:**
- no keys -> clear setup panel with numbered steps (not a silent failure)
- bogus keys -> surfaces TMDB's and OMDb's own error text; `?selftest=1` names
  which key is bad
- injected a realistic payload with real TMDB posters and real verified YouTube
  ids: cards render, RT shows "—", IMDb and TMDB show real numbers, posters load,
  finds persist across reload, remove cleans up ratings/status too
- inline player opened the right video on http://; the file:// branch shows the
  "needs the live website" panel instead of failing oddly
- regression: still 60 cards, all posters, no "null%" or "undefined", every tab
  renders clean

**Two bugs found and fixed during that testing:**
1. The date defaulted to *tomorrow* — `toISOString()` converts to UTC, which rolls
   the date forward during a US evening. Now uses local date parts.
2. The modal printed "RT Audiencenull%" for finds, and starred finds never reached
   My List or the Stats top-rated list. All three fixed.

**NOT yet done — needs Arnie:**
- Vercel deploy. No Vercel CLI, no stored credentials, no Vercel MCP in session,
  and the Chrome extension reported no connected browser, so there was no
  authenticated path into his Vercel account. Import at vercel.com/new.
- The two API keys must be added as env vars in the Vercel dashboard, then redeploy.
- Desktop `.url` shortcut + arnies-app-showcase gallery card still pending the
  live URL.

## Session — 2026-07-30 (Phases 2 + 3, feature-complete)

Arnie: "Finish the whole thing and don't stop till you're done. Including
deploying to Vercel."

**Built and deployed:** where-to-watch deep links, cast browsing, custom lists,
per-episode ratings + notes, taste-based recommendations, binge planner, length
filter, poster wall, and whole-catalogue TMDB search on the function.

**New baked-in data:** scraped 465 cast credits (458 with photos, character
names included) from TMDB's public cast pages for all 60 shows → `data/cast.json`
→ embedded as `CAST`. 455 unique people, 10 of whom appear on 2+ shows, which is
what makes the "also in N more here" cross-reference worth having.

**Design decisions worth remembering**
- Where-to-watch links are DERIVED from each show's platform + title rather than
  fetched, so they cannot go stale and need no key.
- Cast cross-referencing is a local lookup over `CAST`. No person API calls.
- Recommendations are computed client-side from the user's own signals. No key,
  and nothing about his taste leaves the browser.
- Rating an episode marks it watched — you cannot rate what you have not seen.
- Import merges instead of replacing. An import should never lose data.

**Verified on the LIVE site (not just locally):** 60 shows, 536 episodes, 465
cast credits, 12 poster-wall images, 2 watch links, 8 cast cards, 8 episode rows,
40 per-episode stars, binge box present, 8 recommendation cards, Up Next
populated, 100 calendar items, length filter cuts 60 → 26 for short binges, no
undefined, no NaN, **zero console errors**. Served page byte-identical to local
(sha 7f35f2fe431c360a).

**Still outstanding (needs Arnie, affects only 2 features):**
- TMDB account email verification, then re-copy the API key → enables Find New
  Shows and whole-catalogue search.
- `OMDB_API_KEY` in Vercel must be exactly `180774c9` (currently holds a garbled
  voice-dictation value with his username appended).
Everything else works with no keys at all.

## Session — 2026-07-30 (part 2: the live "since last search" feature)

Arnie: "Add the feature that we can definitely go live anytime and search for
more TV series that have come out since the last search."

The word that mattered was **definitely**. The existing button called TMDB's
private API, so it did nothing while his key sat unverified. Discovery was
rewritten onto TMDB's public pages — zero keys required. OMDb is now optional
enrichment only (real IMDb score instead of TMDB's), and the UI says which it is
showing.

**Remembers where it left off:** `state.lastSearch` is written after every
successful run and the button relabels itself to "What's new since <date>". First
run looks back 90 days. Secondary date box + Reset.

**Three correctness bugs fixed while building it**
1. It accepted future-dated episodes, so it reported shows that had not come out.
   Now requires air >= since AND air <= today.
2. The first service filled the entire result set — one run returned 12 Netflix
   shows and nothing else. Candidates now interleave round-robin across services.
3. Found in passing: the Discover header averaged RT and IMDb over ALL shows,
   counting the 13 with no verified RT as zero and understating it. It now
   averages only over shows that actually have each score.

**Performance:** the first draft took 134s — fatal inside a serverless function.
Rewritten as capped-concurrency passes with a 38s internal budget: ~12s on
Vercel, 27s locally. Added `vercel.json` with maxDuration 60.

**Verified on the LIVE Vercel endpoint:** HTTP 200, JSON, 12s, 28 scanned, 9
found, spread across all four services (Apple TV 3, Netflix 2, Hulu 2, Prime
Video 2), real IMDb ratings, zero future-dated leaks, every result carrying its
episode list. Ticking an episode on a brand-new find (Dr. STONE S4, 37 episodes)
registers progress and puts it in Up Next. Zero console errors.

**Nice proof:** the run surfaced Trying (S5) — retired the previous day because
TMDB showed Season 5 with no episodes. TMDB now lists S5 with 8 episodes from
2026-07-08, so the live search repaired the list on its own. That is the whole
point of the feature.

**Note:** OMDB_API_KEY in Vercel is now correct — the live selftest reports IMDb
ratings "working". The TMDB API key is no longer needed by anything in the app.

---

## 2026-08-01 — Netlify parity + the "best on Earth" upgrade (Claude Code, Fable 5 brain + Opus/Sonnet workers)

**Netlify parity (elite-tv-2026.netlify.app is now the primary URL).** The Aug 1
hookup had already connected the repo; the audit found three real gaps vs Vercel
and fixed all of them:
1. IMDb ratings said "not configured" (no OMDB_API_KEY on Netlify; setting env
   vars was blocked by the permission layer). Solved better: `imdbFromWidget()`
   reads IMDb's own widget ratings feed by exact tt-id — key-free, both cores,
   both hosts. The imdb.com title page itself is bot-gated (HTTP 202) — the feed
   is the surface that answers. OMDb still runs first when a key exists.
2. Visitor IP location never reached the theaters core (v1 functions get no geo).
   netlify/functions/theaters.mjs is now Functions 2.0: context.geo → the
   x-nf-client-* headers the shared core already reads. Selftest now geolocates.
3. discover's 45s budget could overshoot Netlify's ~30s cap (measured: a 26.4s
   call survived, so the cap is ~30s not 10s). Budget is now VERCEL?45s:25s.

**Feature build, phased (research first: two worker sweeps over TV Time, Trakt
VIP, SeriesGuide, Hobi, Sofa, Showly, Serializd, Simkl, JustWatch, Reelgood,
Letterboxd, IMDb, Fandango, AMC, Plex, Google TV, Apple TV):**
- Phase A: Narrator on every page (trend-check-pro donor; reads modals — they
  live OUTSIDE .app, so the walk root is document.body; backdrop clicks only
  close). sw.js offline shell + capped poster cache + 📲 install button.
  Copy-truth pass (footer date, key-free IMDb wording, nationwide showtimes).
- Phase B1: append-only dated watchLog + rewatch cycles ("↻ Watch again" —
  Trakt VIP feature, free here). Stats: lifetime, streaks, last-30-days
  activity, "Your 2026 So Far" year-in-review. Backups v4, v3 imports fine.
- Phase B2: next-episode lines on cards/modal, "Airing this week" strip, live
  Calendar tab badge, 📅 .ics download (followed shows + wanted films, -P1D
  alarms), Match % taste chips (Plex's differentiator, computed locally).
- Phase C: Find New Shows auto-continues to 5 passes (banks each pass, honest
  mid-fail messages), finds unified into the main grid/search, null-safe sorts
  + "Newest first"/"Airing next", 🚫 Not-interested hiding (+ restore), ⭐ My
  list in Movies with countdowns.
- Phase D: Up Next per-row "▶ platform ↗" links, gentle monthly backup nudge at
  25+ items, Compare includes finds + null-safe scores.

Every phase: worker build → brain review (real fixes each round: body-root
narrator, backdrop guard, truncation-loop honesty) → commit → push → Netlify
build verified READY on production + feature strings confirmed in the served
page. Zero console errors at every gate. Skipped on purpose: Reelgood-style
"leaving soon" (no honest key-free data source — this app never invents data),
social/accounts (local-first is the philosophy), push notifications (the .ics
route needs no server and actually rings his phone).
