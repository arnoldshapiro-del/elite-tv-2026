// Netlify function — reached as /api/discover via the redirect in netlify.toml.
// Same core as the Vercel function; ready for the Aug 1, 2026 Netlify connect.
const { handle } = require('../../lib/discover-core.js');

exports.handler = async (event) => {
  try {
    const { status, body } = await handle(event.queryStringParameters || {}, process.env);
    return {
      statusCode: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, code: 'HANDLER_ERROR', message: String(e && e.message || e) }),
    };
  }
};
