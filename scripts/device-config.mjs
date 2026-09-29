export function deviceConfig(env = process.env) {
  function origin(name) {
    const value = env[name];
    let url;
    try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute HTTPS origin`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error(`${name} must be an HTTPS origin without credentials, path, query or fragment`);
    if (url.port === '0' || ['0.0.0.0', '[::]'].includes(url.hostname)) throw new Error(`${name} must use a reachable hostname and a nonzero port`);
    return { origin: url.origin, hostname: url.hostname, port: Number(url.port || 443) };
  }
  const web = origin('DEVICE_ORIGIN'), relay = origin('DEVICE_RELAY_ORIGIN');
  if (web.hostname !== relay.hostname || web.port === relay.port)
    throw new Error('Device web and relay origins must use the same hostname and different ports');
  return { web, relay, host: env.DEVICE_HOST || '127.0.0.1' };
}
