export function webReleaseConfig(env = process.env) {
  function origin(key) {
    const value = env[key];
    if (typeof value !== 'string' || /[\s\\]/.test(value)) throw new Error(`${key} must be an absolute HTTPS origin`);
    let url;
    try { url = new URL(value); } catch { throw new Error(`${key} must be an absolute HTTPS origin`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '0' || url.hostname.includes('*') || ['0.0.0.0', '[::]'].includes(url.hostname))
      throw new Error(`${key} must be an HTTPS origin without credentials, path, query or fragment`);
    return url.origin;
  }
  return { webOrigin: origin('RELEASE_WEB_ORIGIN'), relayOrigin: origin('RELEASE_RELAY_ORIGIN') };
}
