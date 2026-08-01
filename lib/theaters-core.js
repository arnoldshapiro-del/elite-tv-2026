/* ---------------------------------------------------------------------------
   THEATRES + SHOWTIMES, anywhere in the United States.

   Shared by api/theaters.js (Vercel) and netlify/functions/theaters.js.

   HOW THIS WORKS, AND WHY IT REPLACED A SCRAPER.
   The first version of this feature scraped one theatre — AMC West Chester 18 —
   with a scheduled headless browser, because amctheatres.com sits behind a
   Queue-it gate no plain request can pass. That worked, but it only ever knew
   about one cinema.

   Fandango turns out to expose the whole country as plain JSON:

     GET /napi/theaterswithshowtimes?zipCode=…&date=…&limit=…

   It answers for any US ZIP (or city + state), returns the nearest theatres of
   EVERY chain — AMC, Regal, Cinemark, Alamo, Landmark, B&B, Showcase and the
   independents — each with distance, coordinates, amenities and the full day's
   showtimes with their formats and live ticket links.

   THE ONE GOTCHA: it 403s ("Session expired or invalid token") unless the
   request carries a browser Accept header AND a Referer pointing at the
   matching Fandango page. A bare fetch, even with a real User-Agent, is
   refused. That is the whole trick — see fandangoHeaders() below.

   Nothing here is invented. Every time, format and amenity is what Fandango
   published for that showing, and each links to that showing's own ticket page.
--------------------------------------------------------------------------- */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const NAPI = 'https://www.fandango.com/napi/theaterswithshowtimes';

/* The Accept + Referer pair is required. Without them the API returns 403. */
function fandangoHeaders(refPath) {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.fandango.com/' + (refPath || '') + '_movietimes',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

const decode = s => String(s || '')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function getJSON(url, headers, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, 900 * (i + 1))); continue; }
      const t = await r.text();
      try { return { status: r.status, json: JSON.parse(t) }; }
      catch { return { status: r.status, json: null, raw: t.slice(0, 200) }; }
    } catch (e) {
      if (i === tries - 1) return { status: 0, json: null, raw: String(e.message || e) };
    }
  }
  return { status: 0, json: null };
}

/* ---- the format label -------------------------------------------------------
   Fandango's own `filmFormatHeader` is coarse — "Standard", "Premium Format",
   "3D" — and puts the thing people actually care about in the amenity list
   instead ("IMAX", "Dolby Cinema @ AMC", "RPX", "Cinemark XD"). So the amenities
   decide, and the header is only the fallback. Order matters: a Dolby Cinema
   screening is also "Reserved seating", and IMAX beats a plain 3D tag.
--------------------------------------------------------------------------- */
const FORMAT_RULES = [
  [/\bIMAX\b/i,                  'IMAX'],
  [/dolby\s*cinema/i,            'Dolby Cinema'],
  [/\bRPX\b/i,                   'RPX'],
  [/\bXD\b/i,                    'XD'],
  [/screen\s*x/i,                'ScreenX'],
  [/\b4DX\b/i,                   '4DX'],
  [/D-?BOX/i,                    'D-BOX'],
  [/big\s*d/i,                   'BigD'],
  [/\bPLF\b|prime at amc|superscreen|ultrascreen|cinesuites|grand screen/i, 'Premium Large Format'],
  [/dolby\s*atmos/i,             'Dolby Atmos'],
  [/\b(reald|digital)\s*3d\b|^3d$/i, '3D'],
];

function resolveFormat(variant, group) {
  const names = ((group && group.amenities) || []).map(a => String(a && a.name || ''));
  const hay = names.join(' | ');
  for (const [re, label] of FORMAT_RULES) if (re.test(hay)) return label;
  if (group && group.isDolby) return 'Dolby';
  const h = decode(variant && variant.filmFormatHeader);
  if (h && !/^standard$/i.test(h)) return h;
  return 'Standard';
}

// Amenities worth showing; the format itself and boilerplate are dropped.
const SKIP_AMENITY = /^(no passes|accessibility devices available)$/i;
function usefulAmenities(group, format) {
  return ((group && group.amenities) || [])
    .map(a => decode(a && a.name))
    .filter(Boolean)
    .filter(n => !SKIP_AMENITY.test(n))
    .filter(n => n.toLowerCase() !== format.toLowerCase())
    .filter(n => !(format !== 'Standard' && new RegExp(format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(n)))
    .slice(0, 6);
}

/* ---- normalise one theatre ---- */
function normaliseTheatre(t) {
  const movies = (t.movies || []).map(m => {
    const formats = [];
    for (const v of (m.variants || [])) {
      for (const g of (v.amenityGroups || [])) {
        const format = resolveFormat(v, g);
        const times = (g.showtimes || []).map(s => ({
          time: decode(s.date),                       // "5:25p"
          label: decode(s.screenReaderTime) || decode(s.date),  // "5:25 PM"
          expired: !!s.expired,
          soldOut: String(s.type || '').toLowerCase() === 'soldout',
          status: String(s.type || '').toLowerCase() === 'soldout' ? 'Sold out' : null,
          when: s.ticketingDate || null,
          url: s.ticketingJumpPageURL || null,
        })).filter(s => s.time);
        if (!times.length) continue;
        const existing = formats.find(f => f.format === format);
        if (existing) existing.times = existing.times.concat(times);
        else formats.push({ format, amenities: usefulAmenities(g, format), reserved: !!g.hasReservedSeating, times });
      }
    }
    // premium screens first, standard last — that is the order people scan in
    const rank = f => (f === 'Standard' ? 99 : FORMAT_RULES.findIndex(r => r[1] === f) + 1 || 50);
    formats.sort((a, b) => rank(a.format) - rank(b.format));
    return {
      id: m.id,
      title: decode(m.title).replace(/\s*\((?:19|20)\d\d\)\s*$/, ''),
      titleFull: decode(m.title),
      runtime: m.runtime || null,
      rating: decode(m.rating) || null,
      genres: m.genres || [],
      formats,
    };
  }).filter(m => m.formats.length);

  const geo = t.geo || {};
  return {
    id: t.id,
    name: decode(t.name),
    chain: decode(t.chainName) || decode(t.chainCode) || null,
    chainCode: t.chainCode || null,
    distance: typeof t.distance === 'number' ? Math.round(t.distance * 10) / 10 : null,
    address: decode(t.address1),
    city: decode(t.city),
    state: decode(t.state),
    zip: decode(t.zip || t.postalCode),
    fullAddress: decode(t.fullAddress) || [decode(t.address1), decode(t.cityStateZip)].filter(Boolean).join(', '),
    lat: typeof geo.latitude === 'number' ? geo.latitude : null,
    lon: typeof geo.longitude === 'number' ? geo.longitude : null,
    phone: decode(t.phone) || null,
    url: t.theaterPageUrl ? 'https://www.fandango.com' + t.theaterPageUrl : null,
    mapUrl: t.mapURI || (geo.latitude
      ? `https://www.google.com/maps/search/?api=1&query=${geo.latitude},${geo.longitude}`
      : null),
    premiumFormats: Array.isArray(t.formats) ? t.formats.map(decode).filter(Boolean) : [],
    movieCount: movies.length,
    movies,
  };
}

/* ---- the call ---- */
async function findTheatres({ zip, city, state, date, limit }) {
  const params = new URLSearchParams({
    zipCode: zip || '',
    city: zip ? '' : (city || ''),
    state: zip ? '' : (state || ''),
    date: date || '',
    page: '1',
    favTheaterOnly: 'false',
    limit: String(Math.min(20, Math.max(1, Number(limit) || 12))),
    isdesktop: 'true',
  });
  const refPath = zip || (city && state ? `${String(city).toLowerCase().replace(/\s+/g, '-')}-${String(state).toLowerCase()}` : '');
  const r = await getJSON(`${NAPI}?${params}`, fandangoHeaders(refPath));
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.theaters)) {
    return { ok: false, status: r.status, message: r.status === 403
      ? 'Fandango refused the request.'
      : `Could not reach the showtimes service (HTTP ${r.status}).`, raw: r.raw || null };
  }
  return { ok: true, theaters: r.json.theaters.map(normaliseTheatre) };
}

/* ---- where is the user? -----------------------------------------------------
   Three ways in, best first:
     1. an explicit ZIP or city the person typed (always wins, always remembered)
     2. browser geolocation -> reverse geocoded to a ZIP
     3. the host's own IP geolocation headers, which need no permission at all
--------------------------------------------------------------------------- */
function ipLocationFrom(headers) {
  const h = n => headers[n] || headers[n.toLowerCase()] || null;
  const city = h('x-vercel-ip-city') || h('x-nf-client-city') || null;
  const region = h('x-vercel-ip-country-region') || h('x-nf-client-subdivision') || null;
  const country = h('x-vercel-ip-country') || h('x-nf-client-country') || null;
  const lat = h('x-vercel-ip-latitude'), lon = h('x-vercel-ip-longitude');
  if (!city && !lat) return null;
  return {
    city: city ? decodeURIComponent(city) : null,
    state: region || null,
    country: country || null,
    lat: lat ? Number(lat) : null,
    lon: lon ? Number(lon) : null,
    source: 'ip',
  };
}

/* lat/lon -> ZIP, via the US Census geocoder (public, no key, US-only) with
   OpenStreetMap's Nominatim as the backup. */
async function reverseGeocode(lat, lon) {
  const census = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates` +
    `?x=${encodeURIComponent(lon)}&y=${encodeURIComponent(lat)}&benchmark=Public_AR_Current` +
    `&vintage=Current_Current&layers=Census%20Tracts&format=json`;
  const c = await getJSON(census, { 'User-Agent': UA, 'Accept': 'application/json' }, 1);
  const addr = c.json && c.json.result && c.json.result.geographies;
  if (addr) {
    // the census response does not carry a ZIP directly; fall through to OSM
  }
  const osm = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=1`;
  const o = await getJSON(osm, {
    'User-Agent': 'elite-tv-2026/1.3 (personal movie app)',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  }, 1);
  const a = o.json && o.json.address;
  if (!a) return null;
  return {
    zip: a.postcode ? String(a.postcode).slice(0, 5) : null,
    city: a.city || a.town || a.village || a.hamlet || a.county || null,
    state: a['ISO3166-2-lvl4'] ? String(a['ISO3166-2-lvl4']).split('-')[1] : (a.state || null),
    country: a.country_code ? a.country_code.toUpperCase() : null,
    source: 'geolocation',
  };
}

/* ---- request handling shared by both hosts ---- */
async function handle(query, env, headers) {
  headers = headers || {};

  if (query.selftest) {
    const t = await findTheatres({ zip: '10001', date: todayET(), limit: 3 });
    return { status: 200, body: {
      ok: t.ok,
      showtimes: t.ok ? `working — ${t.theaters.length} theatres returned for 10001` : `FAILED: ${t.message}`,
      ipLocation: ipLocationFrom(headers) || 'no geo headers on this request',
      sample: t.ok ? t.theaters.slice(0, 3).map(x => `${x.name} (${x.chain}) ${x.distance} mi`) : [],
    } };
  }

  try {
    // "where am I?" — used by the app before it knows a ZIP
    if (query.locate) {
      let loc = null;
      if (query.lat && query.lon) loc = await reverseGeocode(query.lat, query.lon);
      if (!loc) loc = ipLocationFrom(headers);
      if (!loc) return { status: 200, body: { ok: false, code: 'NO_LOCATION',
        message: 'Could not work out where you are — type a ZIP code instead.' } };
      return { status: 200, body: { ok: true, location: loc } };
    }

    let { zip, city, state } = query;
    let located = null;

    // no explicit place given: try coordinates, then the host's IP headers
    if (!zip && !(city && state)) {
      if (query.lat && query.lon) located = await reverseGeocode(query.lat, query.lon);
      if (!located) located = ipLocationFrom(headers);
      if (located) { zip = located.zip || ''; city = located.city || ''; state = located.state || ''; }
    }
    if (!zip && !(city && state)) {
      return { status: 200, body: { ok: false, code: 'NO_LOCATION',
        message: 'Tell me a ZIP code and I will find every cinema near you.' } };
    }

    const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : todayET();
    const res = await findTheatres({ zip, city, state, date, limit: query.limit });
    if (!res.ok) return { status: 200, body: { ok: false, code: 'UPSTREAM', message: res.message } };

    return { status: 200, body: {
      ok: true,
      query: { zip: zip || null, city: city || null, state: state || null, date },
      locatedBy: located ? located.source : 'explicit',
      count: res.theaters.length,
      theaters: res.theaters,
    } };
  } catch (e) {
    return { status: 200, body: { ok: false, code: 'FAILED', message: String(e.message || e) } };
  }
}

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

module.exports = { handle, findTheatres, reverseGeocode, ipLocationFrom, resolveFormat };
