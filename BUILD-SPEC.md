# BUILD-SPEC — Elite TV 2026 "best on planet Earth" upgrade (2026-08-01)

Goal: after Netlify parity (done, deployed 06f779c), add the features that make this
the best personal TV+movies app anywhere — informed by what TV Time / Trakt /
JustWatch / SeriesGuide / Letterboxd users love, minus accounts/ads/cloud (local-first
stays the philosophy). Phased; commit+push+verify per phase.

## Phase A — standing orders + platform (no research needed)
- A1 Narrator: copy `trend-check-pro/narrator.js` (+ its CSS + markup blocks) per
  memory narrator-read-aloud-every-app. Adapt: LS prefix `eliteTV`, CTRL_SEL +=
  `[onclick],.modal-overlay,.trailer-player-overlay,.card,.movie-card,.tcard,.upnext-row,.cal-item,.similar-item,.ep-row,.cast-card,.chip,.wall`,
  auto-stop on nav-tab switch, keep bar small.
- A2 PWA completion: new `sw.js` (network-first `/` + `index.html`; cache-first
  runtime cache for Google Fonts + TMDB/media images, capped ~120 entries; NEVER
  intercept `/api/`), registration snippet, custom Install button in nav via
  `beforeinstallprompt` (hidden when standalone). netlify.toml: `/sw.js` no-cache header.
- A3 Copy truth: footer "Revised Aug 1, 2026"; footer + New Finds/Movies wording
  "IMDb scores read from IMDb's own ratings feed (OMDb optional)"; meta description
  loses "AMC West Chester 18", gains nationwide showtimes wording.

## Phase B — tracking power (the tracker-app table stakes we lack)
- B1 Watch history as an APPEND-ONLY log: `state.watchLog` = [{id, ep, at:ISO}]
  appended by toggleEpisode/markUpTo (untick removes the current-cycle tick from
  state.watched but log keeps the record; no log entry on untick-then-retick same
  day duplicates — dedupe by id:ep:cycle). `state.rewatches[id]` = completed
  cycles. NEW "↻ Watch again" button on finished shows: archives (increments
  rewatches, clears state.watched[id] ticks), log + hours preserved. Export v4
  includes watchLog + rewatches; import merges by uniqueness.
  (Research: rewatch tracking + all-time stats are Trakt VIP paid exclusives.)
- B2 History + streaks + Year in Review: Stats gains current/longest daily streak,
  a 30-day history timeline (from watchLog), and a "2026 So Far" wrapped card
  (hours by month/platform/genre, top 5 shows by hours, busiest day, rewatches).
  Old un-logged ticks count in lifetime totals but not dated views.
  (Research: Year in Review is a Trakt VIP paid exclusive; we ship it free.)
- B3 Next-episode awareness: card + modal line "Next: S..E.. · airs <date> · in N days"
  (first future-dated episode); "Airing this week" strip atop Up Next; Calendar tab
  shows a count badge of this week's episodes for engaged shows.
- B4 ICS calendar export: button in Calendar + movie modal — downloads .ics with
  upcoming dated episodes of engaged shows (status set OR progress>0) + wanted
  movies' releases, VALARM 1 day + same-day. Pure client.
- B5 Not interested: 🚫 on cards → state.hidden; hidden shows leave Discover grid,
  recs, Surprise, wall; "Show hidden (n)" toggle restores.
- B6 Discover unification: finds join the main Discover grid/search; null-safe sorts;
  new sorts "Newest first" (premiere desc) and "Airing next".
- B7 Up Next rows get "Watch on <service> ↗" deep-link button (watchLinksFor()[0]).
- B8 Match % (Plex's differentiator, local): when tasteProfile has signals, show a
  "Match NN%" chip on Discover cards/modal for un-engaged shows — the rec score
  normalized 50-99%, with the "because you like X" reasons in the title tooltip.
  Purely local math over the user's own ratings; never shown with <1 signal.

## Phase C — discovery/movies power
- C1 Auto-continue: runFind loops while `data.truncated` (cap 5 rounds), merging
  progressively, status "found N so far — still searching…". Makes the Netlify 25s
  budget invisible and speeds Vercel too.
- C2 My movie list: filter chip in Movies showing starred films from both modes with
  countdowns; included in ICS.

## Phase D — polish
- D1 Backup nudge: ≥25 tracked items and no export in 30d → one dismissible line.
- D2 Compare includes finds; null-safe score display.

## Acceptance checklist (each phase)
1. `node -e` parse check on all JS; zero console errors in browser.
2. Narrator: reads whole page, click-anywhere works, cards/controls DON'T trigger it.
3. SW: site loads offline after first visit (except /api features); install button appears.
4. Old localStorage state loads unchanged; export→import round-trips new fields.
5. All scores stay verified-or-dash — nothing invented anywhere new.
6. Dark + light themes both styled; phone width (375px) usable on every new UI.
7. Footer dates current; no stale OMDb-required claims anywhere.
