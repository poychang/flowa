import { isIP } from 'node:net';

export function relayConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const rawPort = env.PORT ?? (production ? '' : '3001');
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(Number(rawPort)) || Number(rawPort) < 1 || Number(rawPort) > 65535)
    throw new Error('PORT must be an integer from 1 to 65535');
  const host = env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1');
  if (!isIP(host)) throw new Error('HOST must be an IPv4 or IPv6 listen address');
  const rawOrigins = env.ALLOWED_ORIGINS ?? (production ? '' : 'http://127.0.0.1:5173,http://localhost:5173');
  const origins = rawOrigins.split(',').map(value => {
    const trimmed = value.trim();
    let url: URL;
    try { url = new URL(trimmed); } catch { throw new Error('ALLOWED_ORIGINS must contain exact web origins'); }
    if (!['https:', ...(production ? [] : ['http:'])].includes(url.protocol) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        url.hostname.includes('*') || ['0.0.0.0', '[::]'].includes(url.hostname) || url.port === '0')
      throw new Error('ALLOWED_ORIGINS must contain exact HTTPS origins in production, without credentials, paths, wildcards or query strings');
    return url.origin;
  });
  return { host, port: Number(rawPort), origins: [...new Set(origins)] };
}
