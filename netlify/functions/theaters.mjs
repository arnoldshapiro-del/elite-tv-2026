// Netlify function (Functions 2.0) — reached as /api/theaters via the redirect
// in netlify.toml. v2 exists for ONE reason: context.geo, Netlify's own IP
// location for the visitor, which v1 handlers never see (the selftest proved
// no geo headers arrive there). The geo is translated into the x-nf-client-*
// headers lib/theaters-core.js already reads, so the core stays host-agnostic.
import corePkg from '../../lib/theaters-core.js';
const { handle } = corePkg;

export default async (req, context) => {
  const url = new URL(req.url);
  const q = {};
  for (const [k, v] of url.searchParams) q[k] = v;

  const headers = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const geo = (context && context.geo) || {};
  if (geo.city) headers['x-nf-client-city'] = geo.city;
  if (geo.subdivision && geo.subdivision.code) headers['x-nf-client-subdivision'] = geo.subdivision.code;
  if (geo.country && geo.country.code) headers['x-nf-client-country'] = geo.country.code;
  if (typeof geo.latitude === 'number') headers['x-nf-client-latitude'] = String(geo.latitude);
  if (typeof geo.longitude === 'number') headers['x-nf-client-longitude'] = String(geo.longitude);

  const cache = (q.selftest || q.locate || q.nocache)
    ? 'no-store'
    : 'public, s-maxage=1800, stale-while-revalidate=3600';
  try {
    const { status, body } = await handle(q, process.env, headers);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, code: 'HANDLER_ERROR', message: String(e && e.message || e) }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }
};
