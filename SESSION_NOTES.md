# Session Notes — 2026 Elite TV — Ultimate Discovery

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
