// Test-only release switcher; never shipped in dist/ or used by the application.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
let revision = 1, broken = false;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:5181');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && url.pathname === '/__test__/release') {
    revision++; broken = url.searchParams.has('broken'); res.end(String(revision)); return;
  }
  if (url.pathname === '/rooms') { res.setHeader('Content-Type', 'application/json'); res.end('{"private":"never-cache"}'); return; }
  try {
    if (broken && url.pathname === '/icons/icon-512.png') { res.writeHead(503); res.end(); return; }
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    let data = await readFile(path);
    if (url.pathname === '/sw.js') data = Buffer.from(data.toString().replace(/const VERSION = '[^']+';/, `const VERSION = 'test-${revision}';`));
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream'); res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(5181, '127.0.0.1', () => console.log('PWA test server: 5181'));
