// Netlify function — reached as /api/movies via the redirect in netlify.toml.
// Same core as the Vercel function; ready for the Aug 1, 2026 Netlify connect.
const { handle } = require('../../lib/movies-core.js');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const cache = q.selftest || q.nocache
    ? 'no-store'
    : 'public, s-maxage=21600, stale-while-revalidate=86400';
  try {
    const { status, body } = await handle(q, process.env);
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
