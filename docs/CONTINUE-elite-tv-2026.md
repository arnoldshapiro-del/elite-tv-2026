# CONTINUE — elite-tv-2026

**Date:** 2026-09-16 · **State:** FINISHED — nothing open. Live at https://elite-tv-2026.netlify.app (main @ a2425c5, package 1.3.1).

## What this session did (Arnie's three asks, all live)
1. **English-language titles only, by default.** Discovery and the Best of Streaming search filter at
   browse time (`with_original_language=en` on TMDB's public pages); every show/film carries `lang`;
   a remembered **Language** box (Discover / New Finds / Best of Streaming) flips to All languages.
   9 of the 75 shows and 26 of the 92 films are not English — set aside, never deleted, tagged when shown.
2. **Services are a mix-and-match set.** Tap a name to light it, tap again to drop it, **All** clears;
   dropping the last lit name relights All. One remembered set (`state.services`) drives the hero pills,
   the Services row in the filter box, the Best of Streaming buttons, and which services the searches query.
3. **✕ Clear filters** chip beside the show count whenever search/genre/type/length/status narrows the page
   (services and language are standing choices and are left alone).

## What remains
Nothing. Optional ideas not started (no request): a "my services" onboarding hint; wall/For You filtered
by lit services (today only the Discover grid, finds search and Best of Streaming follow the set).

## Decisions
- Foreign titles are set aside behind the Language box, never deleted (archive-never-destroy).
- Unknown language stays visible until the `?lang_of=` back-fill answers — never hidden on a guess.
- Future Best of Streaming rebuilds are English-only by default (`browseStream` default).
- Clear filters never touches the service set or the Language box.

## Gotchas learned (also in CLAUDE.md's do-not-redo list)
- Working copies are CRLF (git autocrlf=true): anchor-based patch scripts must normalise to LF.
- `.claude/launch.json` is git-ignored and the preview tool reads Desktop\.claude\launch.json — run
  `node scripts/devserver.js` by hand for local tests (the pane refuses SW registration on localhost).
- Language refresh path: `node scripts/annotate-languages.js && node scripts/bake-languages.js`.

## Resume prompt
"Back to elite-tv-2026" — read CLAUDE.md + the 2026-09-16 entries in SESSION_NOTES.md; everything is live.
