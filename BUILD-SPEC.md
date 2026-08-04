# BUILD-SPEC — Best of Streaming (2026-08-03)

Goal (Arnie): inside the Movies tab, the top-rated films on FIVE services —
Hulu, Netflix, Apple TV, Prime Video and **HBO Max (new)** — 20 per service,
bar = **Tomatometer ≥ 85% OR IMDb ≥ 7.5**, baked into the app with every score
verified from its own source. Plus a **date-tracked "what's been added since I
last searched" button for movies** (the TV side already has this — verified:
runFind sends known ids+titles, state.lastSearch advances to searchedUpTo).

## Parts
1. lib/movies-core.js — STREAM_PROVIDERS {15 Hulu, 8 Netflix, 350 Apple TV,
   9 Prime Video, 1899 HBO Max — 384 is dead, probed 2026-08-03}; browseStream()
   (TMDB public provider-filtered browse, keyless); runStream() (mode=stream:
   known-id exclusion → detail → Wikidata ids → verified RT/IMDb → fixed bar
   85/7.5 → trailers; host-aware budget 45s/22s); selftest gains streamingBrowse.
2. scripts/build-streaming-top.js — offline pipeline, paced (RT ~1.3s,
   YouTube ~3s), incremental saves → data/streaming-top.json.
3. scripts/bake-streaming-top.js — splices the JSON into index.html between
   /*STREAMTOP:BEGIN*/ … /*STREAMTOP:END*/ markers (lean fields only).
   Refresh path: build → bake → commit.
4. index.html — 🏆 Best of Streaming mode button; #streamRow service pills +
   last-searched label; STREAMTOP baked const; streamList()/renderMovies branch;
   runStreamSearch() (auto-continue ≤3 rounds, banks each pass, sends
   known=baked+finds, sets state.streamLastSearch, nocache=1);
   state.streamFinds/{streamLastSearch} in export/import; NEW badge 14 days;
   stream cards/modal (service badge, year foot, Streaming-on row, no
   showtimes); My list + findMovie + calendar-safe; Guide block; footer date.

## Acceptance checklist
1. node --check on core + scripts + extracted inline script — clean.
2. Local devserver: /api/movies?selftest=1 all working incl. streamingBrowse;
   mode=stream returns only unknown films, all clearing the bar.
3. Browser: Best of Streaming shows 100 slots / 85 unique films, pills filter
   per service (20 each), zero console errors, 390px usable.
4. Every baked score real (spot-check vs RT/IMDb); dash where unverified;
   nothing invented.
5. Search press: adds only new films, advances "since" date, second press
   returns nothing-new honestly.
6. Old localStorage loads unchanged; export→import round-trips streamFinds.
7. Deployed: Netlify build green, live selftest + one live stream search OK.
