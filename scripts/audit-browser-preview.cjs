'use strict';
// Disposable, separate-origin visual preview: never connects to Firebase.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname === '/flow-cloud.js') {
    res.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-store' });
    return res.end('window.FlowCloud={getCurrentUser:()=>null,getIdToken:async()=>null};');
  }
  if (pathname === '/sw.js' || pathname === '/firebase-config.js') { res.writeHead(404); return res.end(); }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || pathname.split('/').some(part => part.startsWith('.')) || /\/(tests|scripts|node_modules|push-server)\//.test(pathname)) { res.writeHead(403); return res.end(); }
  if (!mime[path.extname(file)]) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}).listen(4181, '127.0.0.1', () => console.log('Audit-only preview: http://127.0.0.1:4181 — Firebase and service worker disabled.'));
