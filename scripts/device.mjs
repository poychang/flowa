import { spawn } from 'node:child_process';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { relative, isAbsolute, sep } from 'node:path';
import { createServer } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { deviceConfig } from './device-config.mjs';
import { staticHandler } from './device-static.mjs';

async function run(args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true, env });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Build command failed (${code})`)));
  });
}
async function main() {
  const config = deviceConfig();
  if (process.argv[2] === 'build') {
    const env = { ...process.env, VITE_RELAY_URL: config.relay.origin };
    for (const args of [
      ['node_modules/typescript/bin/tsc', '--noEmit'],
      ['node_modules/vite/bin/vite.js', 'build'],
      ['scripts/build-pwa.mjs'],
      ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.relay.json'],
    ]) await run(args, env);
    // Written after the PWA allowlist, and not served by the static handler.
    await writeFile('dist/.device-build.json', JSON.stringify({ web: config.web.origin, relay: config.relay.origin }));
    console.log(`Device build ready for ${config.web.origin}`);
    return;
  }
  if (process.argv[2] !== 'serve') throw new Error('Expected build or serve');
  if (!process.env.DEVICE_TLS_CERT || !process.env.DEVICE_TLS_KEY) throw new Error('Set DEVICE_TLS_CERT and DEVICE_TLS_KEY to your PEM certificate and private key paths');
  const built = JSON.parse(await readFile('dist/.device-build.json', 'utf8'));
  if (built.web !== config.web.origin || built.relay !== config.relay.origin) throw new Error('Origins changed: run pnpm build:devices again');
  await readFile('dist/sw.js');
  const keyLocation = relative(await realpath('dist'), await realpath(process.env.DEVICE_TLS_KEY));
  if (!isAbsolute(keyLocation) && keyLocation !== '..' && !keyLocation.startsWith('..' + sep)) throw new Error('Private key must be outside the public dist directory');
  const tls = { minVersion: 'TLSv1.2', cert: await readFile(process.env.DEVICE_TLS_CERT), key: await readFile(process.env.DEVICE_TLS_KEY) };
  const certificate = new X509Certificate(tls.cert);
  const hostname = config.web.hostname.replace(/^\[|\]$/g, '');
  if (!(isIP(hostname) ? certificate.checkIP(hostname) : certificate.checkHost(hostname))) throw new Error('Certificate does not cover the configured hostname');
  if (Date.now() < Date.parse(certificate.validFrom) || Date.now() > Date.parse(certificate.validTo)) throw new Error('Certificate is not currently valid');
  const web = createServer(tls, await staticHandler('dist'));
  const { createRelay } = await import('../dist-relay/apps/relay/server.js');
  const relay = createRelay({ origins: [config.web.origin], tls });
  const close = async () => { web.closeAllConnections(); await Promise.all([new Promise(resolve => web.close(resolve)), relay.close()]); };
  try {
    await relay.listen(config.relay.port, config.host);
    await new Promise((resolve, reject) => { web.once('error', reject); web.listen(config.web.port, config.host, () => { web.off('error', reject); resolve(); }); });
  } catch (error) { await close(); throw error; }
  console.log(`Flowa device web: ${config.web.origin}\nFlowa device relay: ${config.relay.origin}\nListening on ${config.host}; use a certificate trusted by every test device.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close(); });
}
main().catch(error => { console.error(`Device environment: ${error.message}`); process.exitCode = 1; });
