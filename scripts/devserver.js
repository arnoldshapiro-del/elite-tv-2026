/* Local dev server for elite-tv-2026: serves the static app AND runs the real
   serverless cores at /api/movies and /api/discover, so the app can be tested
   end to end before it is deployed. Scratchpad only — never part of the repo. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = 'C:/Users/arnol/Desktop/Project Files Do Not Delete/elite-tv-2026';
const movies = require(ROOT + '/lib/movies-core.js');
const theaters = require(ROOT + '/lib/theaters-core.js');
const discover = require(ROOT + '/lib/discover-core.js');
const PORT = 8199;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const send = (code, body, type) => {
    res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  };

  if (['/api/movies','/api/discover','/api/theaters'].includes(u.pathname)) {
    const core = u.pathname === '/api/movies' ? movies : u.pathname === '/api/theaters' ? theaters : discover;
    const t = Date.now();
    try {
      const { status, body } = await core.handle(u.query, process.env, req.headers);
      console.log(`[api] ${u.pathname} ${JSON.stringify(u.query)} -> ${status} in ${Date.now() - t}ms (found ${body.found})`);
      return send(status, JSON.stringify(body));
    } catch (e) {
      console.log('[api] ERROR', e);
      return send(200, JSON.stringify({ ok: false, message: String(e.message || e) }));
    }
  }

  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const file = path.join(ROOT, decodeURIComponent(p));
  if (!file.startsWith(path.normalize(ROOT))) return send(403, 'no');
  fs.readFile(file, (err, data) => {
    if (err) return send(404, 'not found', 'text/plain');
    send(200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}).listen(PORT, () => console.log('dev server on http://localhost:' + PORT));
