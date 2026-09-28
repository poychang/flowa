import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, sep } from 'node:path';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };
export async function staticHandler(directory) {
  const root = await realpath(directory);
  const inside = path => { const part = relative(root, path); return part !== '' && !part.startsWith('..' + sep) && part !== '..' && !isAbsolute(part); };
  const hidden = path => relative(root, path).split(sep).some(part => part.startsWith('.'));
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    try {
      const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.')))
        throw new Error('invalid-path');
      const candidate = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!inside(candidate)) throw new Error('invalid-path');
      const path = await realpath(candidate);
      if (!inside(path) || hidden(path) || !mime[extname(path)] || !(await stat(path)).isFile()) throw new Error('invalid-path');
      const body = await readFile(path);
      res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
      res.setHeader('Content-Length', body.length);
      if (pathname === '/sw.js') res.setHeader('Cache-Control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end(); }
  };
}
