// Vercel serverless function — GET /api/movies
// All logic lives in lib/movies-core.js so Vercel and Netlify share one copy.
//
// Unlike /api/discover this response IS cached at the edge. A run reads Rotten
// Tomatoes once per film, and RT starts returning 403 when hit repeatedly — so
// caching is not just a speed win, it is what keeps the real scores flowing.
// Six hours still satisfies "current as of the day of each search", and
// stale-while-revalidate means the refresh never makes anyone wait.
const { handle } = require('../lib/movies-core.js');

module.exports = async (req, res) => {
  const q = req.query || {};
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', q.selftest || q.nocache
    ? 'no-store'
    : 'public, s-maxage=21600, stale-while-revalidate=86400');
  try {
    const { status, body } = await handle(q, process.env);
    res.status(status).send(JSON.stringify(body));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(JSON.stringify({ ok: false, code: 'HANDLER_ERROR', message: String(e && e.message || e) }));
  }
};
