import { pathToFileURL } from 'node:url';
import { VERSION } from '../dist-relay/packages/protocol/index.js';

export async function checkRelay(origin, { timeout = 15000, protocol = VERSION } = {}) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('RELAY_HEALTH_ORIGIN must be an absolute origin'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '0')
    throw new Error('RELAY_HEALTH_ORIGIN requires HTTPS (HTTP only on loopback) without credentials, path, query or fragment');
  const started = performance.now();
  const response = await fetch(new URL('/healthz', url), { redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Relay health endpoint did not return HTTP 200 JSON');
  const body = await response.json();
  if (body.ok !== true || body.protocol !== protocol) throw new Error('Relay is unhealthy or uses a different protocol');
  return { ok: true, protocol: body.protocol, milliseconds: Math.round(performance.now() - started) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkRelay(process.env.RELAY_HEALTH_ORIGIN).then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('Relay health check failed: verify origin, TLS, HTTP response, protocol and reachability.'); process.exitCode = 1; });
}
