# 2026 Elite TV — Ultimate Discovery

## What This App Is
A discovery + tracking app for 60 series across Hulu, Prime Video, Apple TV and
Netflix. Every one clears IMDb 7.5 and has episodes that actually aired (or are
dated) in 2026. RT is shown ONLY where a verified score exists — RT has no
public API, so it is never invented. Dark navy/violet design, light-mode toggle.
Full episode-by-episode tracking, an Up Next queue, taste-based recommendations,
cast browsing, and a key-free live search for new releases.

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

## Architecture: the live search / discovery function
- `lib/discover-core.js` — all logic, one copy shared by both hosts
- `api/discover.js` (Vercel) / `netlify/functions/discover.js` (Netlify, via the
  netlify.toml redirect)
- `/api/discover?since=YYYY-MM-DD` → new/returning shows since that date
- `/api/discover?q=title` → whole-catalogue search
- `/api/discover?selftest=1` → reports discovery + IMDb-rating status separately
- Capped-concurrency passes, ~38s internal budget (was a 134s sequential draft).
  `vercel.json` sets `maxDuration: 60`. If it ever times out, lower
  `MAX_CANDIDATES`/`WANT` in discover-core.js first.
- Client remembers `state.lastSearch`; the New Finds button relabels itself
  "What's new since <date>" and picks up from exactly there.
- Discovered shows arrive with a full episode list, folded into `EPISODES` at
  runtime, so they get tracking/progress/Up Next immediately.
- Found shows get app ids of `100000 + tmdbId` (never collides with 1-60).
  `getShow(id)` resolves either kind everywhere in the app.

## Baked-in data (no API key needed at runtime)
Scraped from TMDB's public pages, committed under `data/`:
- `EPISODES` — 536 episodes, all 60 shows (number, title, air date, runtime)
- `CAST` — 465 top-billed credits (person id, name, photo, character)
- `MEDIA` — poster file, verified trailer id, TMDB id per show
Deliberate: the app keeps fully working if every key lapses.

## Full feature list
Discover: search/filter (platform, genre, type, status, length), 6 sort orders,
grid/list/compact views, poster wall, Surprise Me, Compare.
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
- data/episodes.json, data/cast.json — source data (also baked into index.html)
- manifest.json, icon.svg, icon-maskable.svg, netlify.toml, vercel.json, package.json

## Known Issues
- RT Audience is unverifiable for 13 shows (no public API) — shown as "—"
- Poster/trailer data is hotlinked; a pulled asset falls back gracefully
  (gradient tile / YouTube search) rather than breaking
