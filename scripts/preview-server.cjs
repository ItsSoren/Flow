'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.FLOW_PORT || 4173);
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let relative;
  try { relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) { res.writeHead(400); res.end(); return; }
  const target = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
  if (!target.startsWith(root + path.sep) || relative.split('/').some(p => p.startsWith('.')) || /\/(node_modules|push-server|tests|scripts)\//.test(relative)) { res.writeHead(403); res.end(); return; }
  const type = types[path.extname(target)];
  if (!type) { res.writeHead(404); res.end(); return; }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end('Introuvable'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(target).pipe(res);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Aperçu Flōw : http://127.0.0.1:${port}`));
