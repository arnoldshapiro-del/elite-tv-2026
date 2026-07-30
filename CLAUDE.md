# 2026 Elite TV — Ultimate Discovery

## What This App Is
A discovery + watchlist app for the 60 best 2026 series across Hulu, Prime Video,
Apple TV and Netflix (RT Audience ≥ 80, IMDb ≥ 7.5, new series or new season).
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
- State (ratings, watchlist status, notes, theme) in localStorage key `eliteTV2026`

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
- **5 shows get the series trailer, not that season's** (a season-specific
  official trailer isn't on YouTube yet / season hasn't premiered):
  Adults (S2), Only Murders in the Building (S6), Mr. & Mrs. Smith (S2),
  The Morning Show (S5), Pachinko (S3).
- RT / IMDb scores are a static July 2026 snapshot, not live-fetched.

## Design notes
- Poster art is portrait (2:3) but card headers are landscape. Rather than
  cropping into faces, a blurred zoomed copy of the poster fills the box and the
  true poster sits fully visible on top (`.art-wrap` / `.art-blur` / `.art-poster`).
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

**Requires two free API keys as environment variables on the host:**
- `TMDB_API_KEY` — https://www.themoviedb.org/settings/api (finds shows + posters + trailers)
- `OMDB_API_KEY` — https://www.omdbapi.com/apikey.aspx (supplies REAL IMDb ratings)

Without them the button shows a setup panel with these steps — it never fails silently.
Diagnostic: hit `/api/discover?selftest=1` — it reports each key as "key works" or
the exact upstream error.

Architecture:
- `lib/discover-core.js` — all the logic, ONE copy shared by both hosts
- `api/discover.js` — Vercel serverless function (`GET /api/discover`)
- `netlify/functions/discover.js` — same core, reached via the netlify.toml redirect
- Keys live only in host env vars. The browser never sees them; nothing is committed.

Rules it enforces:
- IMDb >= 7.5 using the real IMDb rating. No rating available -> the show is dropped.
- **RT Audience is returned as null and displayed as "—".** Rotten Tomatoes has no
  public API. Do NOT "fill this in" with TMDB's score relabelled as RT.
- Trailers come from TMDB's own videos endpoint, preferring `official: true`, then
  verified through YouTube oEmbed exactly like the original 60.
- News and talk genres excluded; reality kept (his 60 include one).
- Capped at 40 candidates per run to stay inside OMDb's free 1,000/day.

Discovered shows live in `state.finds` (localStorage), keyed by TMDB id, and are
given app ids of `100000 + tmdbId` so they can never collide with the curated
1-60. `getShow(id)` resolves either kind; watchlist, ratings, notes, modal and
trailers all work on them with no special cases.

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
