// Vercel serverless function — GET /api/theaters
// All logic lives in lib/theaters-core.js so Vercel and Netlify share one copy.
//
// Cached briefly at the edge: showtimes for a day are stable, but "expired"
// flags move with the clock, so this is 30 minutes rather than the 6 hours
// /api/movies uses. Location lookups are never cached — they are per-visitor.
const { handle } = require('../lib/theaters-core.js');

module.exports = async (req, res) => {
  const q = req.query || {};
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', (q.selftest || q.locate || q.nocache)
    ? 'no-store'
    : 'public, s-maxage=1800, stale-while-revalidate=3600');
  try {
    const { status, body } = await handle(q, process.env, req.headers || {});
    res.status(status).send(JSON.stringify(body));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(JSON.stringify({ ok: false, code: 'HANDLER_ERROR', message: String(e && e.message || e) }));
  }
};
