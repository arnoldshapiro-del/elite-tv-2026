// Netlify function — reached as /api/theaters via the redirect in netlify.toml.
// Same core as the Vercel function; ready for the Aug 1, 2026 Netlify connect.
const { handle } = require('../../lib/theaters-core.js');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const cache = (q.selftest || q.locate || q.nocache)
    ? 'no-store'
    : 'public, s-maxage=1800, stale-while-revalidate=3600';
  try {
    const { status, body } = await handle(q, process.env, event.headers || {});
    return {
      statusCode: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
      body: JSON.stringify(body),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: false, code: 'HANDLER_ERROR', message: String(e && e.message || e) }),
    };
  }
};
