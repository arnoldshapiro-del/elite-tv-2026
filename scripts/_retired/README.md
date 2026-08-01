# Retired — the AMC-only showtimes scraper (2026-07-31 → 2026-08-01)

Kept for the record, not wired to anything. Nothing here runs.

## What it was
`scrape-showtimes.js` drove a real headless browser over
amctheatres.com's showtimes pages for **one cinema** — AMC West Chester 18 —
and published `data/showtimes.json`. `showtimes.yml.retired` was the GitHub
Action that ran it four times a day and committed the result.

It worked, and worked well: 158 showtimes across three days, with formats and
seat status. A browser was genuinely required, because amctheatres.com sits
behind a Queue-it "Global Safety Net" gate whose token is signed server-side —
no plain request of any shape gets past it.

## Why it was replaced
It could only ever know about one cinema.

Fandango exposes the same information as plain JSON for the **whole United
States**:

    GET https://www.fandango.com/napi/theaterswithshowtimes
        ?zipCode=…&city=…&state=…&date=…&limit=…

Any ZIP or city, every chain — AMC, Regal, Cinemark, Alamo, Landmark, B&B,
Showcase, independents — with distance, coordinates, amenities, premium formats
and each showing's own ticket link. No browser, no schedule, no snapshot: the
times are live on every request.

The gotcha that hid it for a while: the endpoint answers **403 "Session expired
or invalid token"** unless the request carries a browser `Accept` header *and* a
`Referer` pointing at the matching Fandango page. A bare fetch with only a real
User-Agent is refused, which is why an earlier probe wrote the whole path off.

That work now lives in `lib/theaters-core.js`.

## If you ever need this back
The parser in `scrape-showtimes.js` is still correct for AMC's own markup, and
the two hard-won details in it are worth keeping:

- **Never wait for `networkidle2` on amctheatres.com.** Their ad and analytics
  beacons never go quiet, so the navigation times out on a page that finished
  rendering seconds earlier. Wait for `domcontentloaded`, then for the showtime
  markup itself.
- **AMC ships `aria-label="undefined Showtimes"` on standard screens.** That is
  a bug on their side; the real word ("Digital") is in the block's `<h3>`.

`showtimes-last-snapshot.json` is the final scrape, kept as a sample of the
shape that code produced.
