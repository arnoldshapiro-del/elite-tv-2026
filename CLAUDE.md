# 2026 Elite TV — Ultimate Discovery

## What This App Is
A discovery + watchlist app for 60 series across Hulu, Prime Video, Apple TV and
Netflix. Every one clears IMDb 7.5 and has episodes that actually aired (or are
dated) in 2026. RT is shown ONLY where a verified score exists — the old
"RT Audience ≥ 80" claim was dropped on 2026-07-30 because 13 entries have no
verifiable RT score and RT has no public API.
Dark navy/violet design with a light-mode toggle. Every show carries its real
poster and a one-click official trailer.

## GitHub Repo
arnoldshapiro-del/elite-tv-2026

## Live URL
Vercel: https://elite-tv-2026.vercel.app  (see SESSION_NOTES.md for the exact
deploy URL confirmed at launch)

Netlify: NOT connected yet — Netlify free build minutes are exhausted until
Aug 1, 2026. `netlify.toml` is already in the repo so the Aug 1 hookup is
connect-only. Site name to use: `elite-tv-2026`.

## Tech Stack
- Single-file static HTML (index.html) — no framework, no build step
- Fonts: Inter + Playfair Display (Google Fonts)
- PWA: manifest.json + icon.svg + icon-maskable.svg
- State in localStorage key `eliteTV2026`: ratings, status, notes, theme, watched
  (episode progress), finds, lists, epRatings, epNotes, lastSearch

## Origin
Built by Grok 4.5 as a single `tv-shows-2026.html` on Arnie's Desktop.
Repaired and completed 2026-07-29 (see "The two bugs that were fixed" below).
The Desktop copy still exists as a personal local copy; GitHub is the source of
truth for the deployed app.

## The two bugs that were fixed — READ BEFORE TOUCHING TRAILERS
1. **Grok fabricated the YouTube IDs.** 16 of the original 19 cached trailer IDs
   pointed to videos that do not exist. Of the 3 that resolved, 2 were the wrong
   video entirely ("The Bear" → a video about software microservices; "Slow
   Horses" → a National Geographic documentary). The other 41 shows had no ID.
   ⇒ NEVER hand-write a YouTube ID into MEDIA. Every ID must be verified against
   `https://www.youtube.com/oembed?url=…&format=json` (HTTP 200 means the video
   exists AND allows embedding) and the returned video title must actually name
   the show. All 60 current IDs were verified this way.

2. **`file://` cannot host a YouTube player.** Opening the app as a local file
   and embedding a trailer in an iframe returns **Error 153 (video player
   configuration error)** even with a 100% valid, embeddable video ID. This was
   confirmed with a controlled test. It is a YouTube-side rule about page origin
   and there is NO client-side workaround.
   ⇒ `playTrailer()` is therefore protocol-aware:
     - `file:`    → opens the real YouTube page in a new tab (autoplays there)
     - `http(s):` → plays inline in the app's own modal
   Because the app is now served over https, the in-page player is what visitors
   get. The file:// branch only matters for Arnie's local Desktop copy.

## Data provenance (nothing here is guessed)
- **Posters**: TMDB. Matched on exact title, so no show wears another show's art.
  Hotlinked from `https://image.tmdb.org/t/p/w500/<file>`. All 60 verified to
  return HTTP 200. Two shows (The East Palace, Teach You a Lesson) are unaired
  and have no TMDB release date — matched via the poster `alt` attribute.
- **Trailers**: YouTube, all 60 from official channels (Netflix, Prime Video,
  Apple TV, Hulu, ABC, Disney, Paramount+, Rotten Tomatoes TV).
- **Deliberately rejected**: an automated pass once proposed the 2005 Brad Pitt /
  Angelina Jolie *film* trailer for `Mr. & Mrs. Smith (S2)` and a social-post
  renewal clip for `The Morning Show (S5)`. Both were rejected by hand. Fan
  "concept trailer" channels are avoided on purpose — they are frequently
  AI-faked footage.
- A few shows carry the series trailer rather than that season's, where no
  season-specific official trailer exists yet. Adults (S2) is the main one; the
  others originally on this list (Only Murders S6, Mr. & Mrs. Smith S2, The
  Morning Show S5, Pachinko S3) were RETIRED on 2026-07-30 because TMDB showed
  those seasons as unreleased.
- IMDb scores were spot-checked against OMDb and are broadly real (10 of 12
  within 0.3). It was the episode counts and premiere dates Grok invented, not
  the scores. RT numbers on the original entries are unverified.

## Design notes
- Poster art FILLS the card (`.art-wrap` / `.art-poster`, object-fit: cover,
  object-position centre 20% so faces survive the crop). An earlier version
  centred the whole portrait poster with blurred bars either side; measured at a
  1600px viewport that left the real image 115px wide in a 339px card and Arnie
  rightly called it squashed. `.art-blur` no longer exists — do not bring it back.
- Grid minimum column is 430px. Raising the page width alone made cards SMALLER
  (more columns fit); the minimum column is the lever that controls card size.
- Card titles are forced white on a dark scrim in BOTH themes. Do not revert this
  to `var(--text)` — in light mode that puts dark text over dark artwork and the
  titles disappear.

## Features
- 60 shows: search, platform / genre / type / status filters, 6 sort orders
- Grid / List / Compact views
- Watchlist (Want · Watching · Finished), 5-star ratings, per-show notes
- Stats tab (platform + genre breakdown, your top rated)
- 2026 release calendar, Surprise Me (mood-based), head-to-head Compare
- JSON export of your ratings/watchlist/notes
- One-click official trailer per show; "10 more series rated as high" per show

## "Find New Shows" button (New Finds tab)
Goes out and looks for series / new seasons that appeared on the four services
since a date Arnie picks, and adds them alongside the 60 (never replacing them).

**Needs NO API key** (changed 2026-07-30 — see the live-search section below).
Discovery reads TMDB's public pages. `OMDB_API_KEY` is OPTIONAL and only upgrades
the rating from TMDB's score to the real IMDb score; `TMDB_API_KEY` is no longer
used by anything. Diagnostic: `/api/discover?selftest=1`.

Architecture:
- `lib/discover-core.js` — all the logic, ONE copy shared by both hosts
- `api/discover.js` — Vercel serverless function (`GET /api/discover`)
- `netlify/functions/discover.js` — same core, reached via the netlify.toml redirect
- Keys live only in host env vars. The browser never sees them; nothing is committed.

Rules it enforces:
- IMDb >= 7.5 using the real IMDb rating. No rating available -> the show is dropped.
- **RT Audience is returned as null and displayed as "—".** Rotten Tomatoes has no
  public API. Do NOT "fill this in" with TMDB's score relabelled as RT.
- Trailers for finds come from a YouTube search, preferring official channels and
  verified through oEmbed exactly like the original 60. (The TMDB videos endpoint
  was dropped along with the API key dependency.)
- News and talk genres excluded; reality kept (his 60 include one).
- Capped at 28 candidates / 12 results per run, for speed inside the function's
  time limit and to stay well inside OMDb's free 1,000/day.

Discovered shows live in `state.finds` (localStorage), keyed by TMDB id, and are
given app ids of `100000 + tmdbId` so they can never collide with the curated
1-60. `getShow(id)` resolves either kind; watchlist, ratings, notes, modal and
trailers all work on them with no special cases.

## Feature set (complete as of 2026-07-30)
Built from what reviewers praise in the top-rated trackers, after TV Time shut
down on 2026-07-15 and deleted everyone's history.

Tracking
- Episode-by-episode ticking, with a one-tap "↧ to here" catch-up.
- Up Next tab: the exact next unwatched episode of everything in progress.
- Progress bars on cards and in the modal. Watchlist status FOLLOWS progress
  (`autoStatusFromProgress`) so it can never disagree with itself.
- Watch-time stats: watched, ticked, left to finish, per-show remaining.
- Binge planner: episodes left, hours left, finish-by date at 2 a night.
- Per-episode 5-star ratings and private notes. Rating implies watched.

Discovery
- Poster wall across Discover, highest-rated first.
- Length filter (short ≤6h / medium / long haul) from REAL episode runtimes.
- For You tab: recommendations scored from the user's own ratings, finished
  shows and progress, weighting genre + mood + service, and it states WHY.
  Entirely local, no key.
- Custom lists, unlimited, named anything.
- Where to watch: deep links into Netflix / Hulu / Prime / Apple TV search plus
  a JustWatch lookup. Derived from each show's platform, so nothing expires.
- Cast browsing: 465 real credits with photos and character names. Tapping a
  name lists every OTHER show on the list they're in (local lookup). 10 actors
  span 2+ shows. Links out to their TMDB filmography.
- Calendar rebuilt from 536 real episode air dates with countdowns, split into
  Coming up / Already aired.
- Find New Shows (needs the two keys) and whole-catalogue TMDB search (`?q=`).

Portability
- Export carries ratings, statuses, notes, EPISODE PROGRESS, custom lists,
  per-episode ratings/notes and discovered shows. Import MERGES rather than
  overwrites, so restoring never costs current data.

## "What’s new since last time" — the live search (2026-07-30)
One button on the New Finds tab. It remembers the date of the last successful
search and picks up from exactly there; the first run looks back 90 days. A
secondary date box searches from any date, and Reset forgets.

**It needs NO API KEY.** Discovery reads TMDB's PUBLIC pages (the same source as
the posters, episodes and cast). This was a deliberate rewrite: the first version
called TMDB's private API and therefore did nothing whenever the key was
unverified. An OMDb key only upgrades the rating from TMDB's score to the real
IMDb score, and the UI states which one it is showing.
NEVER reintroduce a hard key dependency here.

Rules it enforces:
- Episodes must have ACTUALLY AIRED in the window (>= since AND <= today). An
  earlier version accepted future dates and so reported shows that had not aired.
- Candidates interleave round-robin across the four services. Without that the
  first service filled the whole result set (one run returned 12 Netflix shows
  and nothing else).
- Discovered shows arrive with their full episode list, folded into EPISODES, so
  a new find immediately supports ticking, progress bars and Up Next.
- RT stays null. No public API, never invented.

Performance: capped-concurrency passes with a 38s internal budget. The first
sequential draft took 134s; it now runs ~12s on Vercel, 27s locally.
`vercel.json` raises the function ceiling to 60s. If it ever starts timing out,
lower MAX_CANDIDATES or WANT first.

Self-check any time: `/api/discover?selftest=1` reports discovery and IMDb
ratings separately.

Proof it works: the 2026-07-30 live run surfaced Trying (S5) — a show retired the
day before because TMDB showed Season 5 with no episodes. TMDB now lists S5 with
8 episodes from 2026-07-08. The search repairs the list on its own.

## Baked-in data (no API key needed at runtime)
- `EPISODES` — 536 episodes for all 60 shows (number, title, air date, runtime)
- `CAST` — 465 top-billed credits (person id, name, photo, character)
- `MEDIA` — poster, verified trailer id, TMDB id per show
All scraped from TMDB's public pages and committed under `data/`. Refresh with
the scripts referenced in SESSION_NOTES.md. Deliberate choice: the app keeps
working if a key lapses.

## File Structure
- index.html — the entire app (CSS + HTML + JS + all 60 shows + MEDIA map)
- lib/discover-core.js — shared server logic for the Find New Shows button
- api/discover.js — Vercel function
- netlify/functions/discover.js — Netlify function (Aug 1 onward)
- manifest.json, icon.svg, icon-maskable.svg — PWA
- netlify.toml — publish config, /api redirect, ready for the Aug 1 connect
- package.json — pins Node >= 18 for the functions

## Known Issues / Notes
- Scores are a static snapshot (July 2026)
- Poster and trailer data are hotlinked; if TMDB or a YouTube video is ever
  pulled, the poster falls back to the original gradient + letter tile and the
  trailer button falls back to a YouTube search for that title
- Gallery card added to arnies-app-showcase
