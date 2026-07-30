// Vercel serverless function — GET /api/discover
// All logic lives in lib/discover-core.js so Vercel and Netlify share one copy.
const { handle } = require('../lib/discover-core.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const { status, body } = await handle(req.query || {}, process.env);
    res.status(status).send(JSON.stringify(body));
  } catch (e) {
    res.status(200).send(JSON.stringify({ ok: false, code: 'HANDLER_ERROR', message: String(e && e.message || e) }));
  }
};
