import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const built = JSON.parse(await readFile('dist/.device-build.json', 'utf8'));
const web = new URL(built.web), relay = new URL(built.relay);
// This smoke test must never contact a LAN or public device environment.
assert.equal(web.hostname, 'localhost'); assert.equal(relay.hostname, 'localhost');
const certPath = fileURLToPath(new URL('../device-server/fixtures/localhost-cert.pem', import.meta.url));
const cert = await readFile(certPath);
function launch(extra = {}) {
  const child = spawn(process.execPath, ['scripts/device.mjs', 'serve'], { windowsHide: true, env: {
    ...process.env, DEVICE_ORIGIN: built.web, DEVICE_RELAY_ORIGIN: built.relay, DEVICE_HOST: '127.0.0.1',
    DEVICE_TLS_CERT: certPath, DEVICE_TLS_KEY: fileURLToPath(new URL('../device-server/fixtures/localhost-key.pem', import.meta.url)), ...extra,
  } });
  let output = '';
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Device launcher readiness timeout')); }, 10000);
    const collect = data => { output += data; if (output.includes('Listening on')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    exited.then(() => { clearTimeout(timer); reject(new Error(output || 'Launcher exited before readiness')); }, reject);
  });
  ready.catch(() => {});
  return { child, ready, exited, output: () => output };
}
function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, ca: cert }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }); req.on('error', reject); req.end();
  });
}

test('production device launcher serves the PWA and TLS relay with certificate validation', async () => {
  const running = launch();
  try {
    await running.ready;
    assert.match((await get(web.port, '/')).body, /Flowa/);
    const manifest = await get(web.port, '/manifest.webmanifest'); assert.equal(manifest.status, 200);
    assert.equal(JSON.parse(manifest.body).short_name, 'Flowa');
    assert.match((await get(web.port, '/sw.js')).body, /install/);
    assert.equal((await get(web.port, '/.device-build.json')).status, 404);
    assert.deepEqual(JSON.parse((await get(relay.port, '/healthz')).body), { ok: true, protocol: 2 });
  } finally { running.child.kill(); await running.exited; }
});

test('launcher rejects changed origins instead of serving a build with the wrong relay', async () => {
  const running = launch({ DEVICE_RELAY_ORIGIN: 'https://localhost:1' });
  assert.equal(await running.exited, 1); assert.match(running.output(), /Origins changed/);
});

test('a busy frontend port fails startup and releases the already-bound relay', async () => {
  const occupied = createServer(); await new Promise(resolve => occupied.listen(Number(web.port), '127.0.0.1', resolve));
  try {
    const running = launch(); assert.equal(await running.exited, 1); assert.match(running.output(), /EADDRINUSE/);
    await assert.rejects(get(relay.port, '/healthz'), { code: 'ECONNREFUSED' });
  } finally { await new Promise(resolve => occupied.close(resolve)); }
});
