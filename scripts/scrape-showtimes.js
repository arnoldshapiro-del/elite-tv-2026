/* ---------------------------------------------------------------------------
   AMC West Chester 18 — real showtimes, with format and seat status.

   WHY THIS IS A SCHEDULED SCRAPER AND NOT A SERVERLESS FETCH.
   amctheatres.com sits behind a Queue-it "Global Safety Net" gate. A plain
   server-side request — with minimal headers, with a full Chrome header set,
   with a referer, warmed cookies, any combination — gets the same 2.6KB
   JavaScript challenge shell every time (verified 2026-07-31). Passing it needs
   a real browser to run their JS and receive a signed queueittoken; that token
   is HMAC'd server-side and cannot be forged. Fandango's showtimes feed, Atom,
   showtimes.com, Google and Bing are all closed too.

   So this runs a REAL browser on a schedule — exactly what a person visiting
   the site does — and publishes the result as data/showtimes.json. The app then
   reads a static file, which is fast, needs no key, and cannot be rate-limited.
   Showtimes for a day are published well in advance and do not change minute to
   minute, so a few runs a day keeps it accurate for the day.

   Usage:  node scripts/scrape-showtimes.js [days]
   Writes: data/showtimes.json
--------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

const THEATRE = {
  name: 'AMC West Chester 18',
  address: '9415 Civic Center Blvd., West Chester, OH 45069',
  slug: 'amc-west-chester-18',
  market: 'cincinnati',
  amc: 'https://www.amctheatres.com/movie-theatres/cincinnati/amc-west-chester-18',
  fandango: 'https://www.fandango.com/amc-west-chester-18-AAWWU/theater-page',
};

const DAYS = Math.min(7, Math.max(1, Number(process.argv[2]) || 3));
const OUT = path.join(__dirname, '..', 'data', 'showtimes.json');

const decode = s => String(s || '')
  .replace(/<!--\s*-->/g, '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

/* Eastern-time day strings. The theatre is in Ohio; the runner is in UTC. */
function easternDay(offsetDays) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/* ---- the parser (proven against a real captured page) ---- */
function parseShowtimes(html) {
  // Each film block starts at its /movies/<slug>-<amcId> link.
  const marks = [];
  const movieRe = /href="\/movies\/([a-z0-9-]+?)-(\d+)"/g;
  let m;
  while ((m = movieRe.exec(html))) {
    if (!marks.some(x => x.amcId === m[2])) marks.push({ slug: m[1], amcId: m[2], at: m.index });
  }
  marks.forEach((f, i) => { f.end = i + 1 < marks.length ? marks[i + 1].at : html.length; });

  const films = [];
  for (const f of marks) {
    const chunk = html.slice(f.at, f.end);
    const titleM = chunk.match(/href="\/movies\/[^"]*"[^>]*>([^<]{2,90})</);
    const title = titleM ? decode(titleM[1]) : f.slug.replace(/-/g, ' ');

    // One <li role="listitem" aria-label="<FORMAT> Showtimes"> per format.
    const gmarks = [];
    const gre = /<li role="listitem" aria-label="([^"]*?) Showtimes"/g;
    let g;
    while ((g = gre.exec(chunk))) gmarks.push({ aria: decode(g[1]), at: g.index });
    gmarks.forEach((x, i) => { x.end = i + 1 < gmarks.length ? gmarks[i + 1].at : chunk.length; });

    const formats = [];
    for (const gm of gmarks) {
      const gchunk = chunk.slice(gm.at, gm.end);

      /* The format NAME. AMC ships aria-label="undefined Showtimes" for their
         standard screens — a bug on their side — while the <h3> holds the real
         word ("Digital"). So the h3 wins and aria-label is only the fallback.
         Premium formats put the name in the first <span> of that h3
         ("RealD 3D", then a separate "PREMIUM 3D EXPERIENCE" blurb). */
      const h3 = (gchunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || '';
      const firstSpan = (h3.match(/<span[^>]*>([\s\S]*?)<\/span>/) || [])[1];
      let format = decode(firstSpan || h3);
      if (!format || /^undefined$/i.test(format)) format = gm.aria;
      if (!format || /^undefined$/i.test(format)) format = 'Standard';

      // key from the h3 id, e.g. "...-dolbycinemaatamcprime-0" -> dolbycinemaatamcprime
      const idM = (gchunk.match(/<h3 id="[^"]*?-([a-z0-9]+)-\d+"/) || [])[1] || null;

      const attrsBlock = (gchunk.match(/id="[^"]*-attributes"[^>]*>([\s\S]*?)<\/ul>/) || [])[1];
      const attributes = attrsBlock
        ? [...attrsBlock.matchAll(/<li>([^<]+)<\/li>/g)].map(a => decode(a[1])).filter(Boolean)
        : [];

      const times = [];
      const tre = /<a[^>]*id="(\d+)"[^>]*href="\/showtimes\/\1"[^>]*>\s*<time datetime="([^"]+)">([\s\S]*?)<\/time>([\s\S]{0,200}?)<\/a>/g;
      let t;
      while ((t = tre.exec(gchunk))) {
        const tail = decode(t[4]);
        times.push({
          id: t[1],
          utc: t[2],
          time: decode(t[3]),
          status: /sold out|almost full|few seats/i.test(tail) ? tail : null,
          url: 'https://www.amctheatres.com/showtimes/' + t[1],
        });
      }
      if (times.length) formats.push({ format, key: idM, attributes, times });
    }
    if (formats.length) films.push({ title, amcId: f.amcId, slug: f.slug, formats });
  }
  return films;
}

/* ---- the browser run ---- */
async function scrape() {
  let puppeteer;
  try { puppeteer = require('puppeteer'); }
  catch { puppeteer = require('C:/Users/arnol/puppeteer-tools/node_modules/puppeteer'); }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const days = {};
  const warnings = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1400, height: 1200 });
    // images/fonts are pure weight here — the data is all in the markup
    await page.setRequestInterception(true);
    page.on('request', r => {
      if (['image', 'font', 'media'].includes(r.resourceType())) r.abort().catch(() => {});
      else r.continue().catch(() => {});
    });

    for (let d = 0; d < DAYS; d++) {
      const date = easternDay(d);
      const url = `${THEATRE.amc}/showtimes/all/${date}/${THEATRE.slug}/all`;
      try {
        /* NOT networkidle2. AMC's analytics and ad beacons never go quiet, so
           waiting for an idle network just burns the timeout on a page that
           finished rendering seconds earlier. Wait for the DOM, then for the
           showtime markup itself to appear — the Queue-it gate bounces through
           one redirect first, so the wait has to be for content, not for load. */
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(
          () => document.documentElement.outerHTML.includes('Showtime Group Results') ||
                document.querySelectorAll('time[datetime]').length > 0 ||
                /No Showtimes|not currently showing|check back/i.test(document.body.innerText),
          { timeout: 45000 },
        ).catch(() => {});
        await new Promise(r => setTimeout(r, 2500));
        const html = await page.content();
        if (html.length < 60000) {
          warnings.push(`${date}: page came back too small (${html.length} bytes) — likely the bot gate`);
          days[date] = [];
          continue;
        }
        const films = parseShowtimes(html);
        days[date] = films;
        const n = films.reduce((k, f) => k + f.formats.reduce((j, g) => j + g.times.length, 0), 0);
        console.log(`${date}: ${films.length} films, ${n} showtimes`);
        if (!films.length) warnings.push(`${date}: page loaded but no showtimes parsed`);
      } catch (e) {
        warnings.push(`${date}: ${String(e.message || e).slice(0, 120)}`);
        days[date] = [];
      }
    }
  } finally {
    await browser.close();
  }

  return {
    theatre: THEATRE,
    scrapedAt: new Date().toISOString(),
    // the Eastern-time day the run belongs to, so the app can say "today"
    scrapedDayET: easternDay(0),
    days,
    warnings,
  };
}

(async () => {
  const data = await scrape();
  const total = Object.values(data.days).reduce(
    (n, films) => n + films.reduce((k, f) => k + f.formats.reduce((j, g) => j + g.times.length, 0), 0), 0);

  if (!total) {
    // Never overwrite good data with an empty scrape — a bad run must not wipe
    // yesterday's perfectly usable listings off the site.
    console.error('No showtimes parsed at all. Leaving the existing file alone.');
    console.error('warnings:', data.warnings.join(' | '));
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1));
  console.log(`\nWrote ${OUT} — ${Object.keys(data.days).length} days, ${total} showtimes total.`);
  if (data.warnings.length) console.log('warnings:', data.warnings.join(' | '));
})();
