import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { readFile, mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { io } from 'socket.io-client';
import { createRelay } from '../../apps/relay/server.ts';
import { deviceConfig } from '../../scripts/device-config.mjs';
import { staticHandler } from '../../scripts/device-static.mjs';
import { initialize, rpc, update } from '../relay/helpers.ts';
import { rectangle } from '../browser/fixtures.ts';

const cert = await readFile(new URL('./fixtures/localhost-cert.pem', import.meta.url));
const key = await readFile(new URL('./fixtures/localhost-key.pem', import.meta.url));
const origin = 'https://localhost:8443';
function get(port, path = '/', options = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, ca: cert, ...options }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }); req.once('error', reject); req.end();
  });
}

test('device configuration requires exact HTTPS origins and explicit LAN opt-in', () => {
  const env = { DEVICE_ORIGIN: origin, DEVICE_RELAY_ORIGIN: 'https://localhost:8444' };
  assert.equal(deviceConfig(env).host, '127.0.0.1');
  assert.equal(deviceConfig({ ...env, DEVICE_HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.equal(deviceConfig(env).relay.port, 8444);
  for (const value of [undefined, 'http://localhost:8443', 'https://user:password@localhost:8443', 'https://localhost:0', 'https://0.0.0.0:8443', origin + '/path', origin + '?key=secret', origin + '#secret'])
    assert.throws(() => deviceConfig({ ...env, DEVICE_ORIGIN: value }));
  assert.throws(() => deviceConfig({ ...env, DEVICE_RELAY_ORIGIN: origin }));
  assert.throws(() => deviceConfig({ ...env, DEVICE_RELAY_ORIGIN: 'https://other.test:8444' }));
});

test('HTTPS static server validates certificates and contains files within the build', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowa-device-'));
  const root = join(directory, 'dist'); await mkdir(root);
  await writeFile(join(root, 'index.html'), '<h1>Flowa</h1>');
  await writeFile(join(root, 'sw.js'), '// service worker');
  await writeFile(join(root, '.device-build.json'), 'private build metadata');
  await writeFile(join(root, 'accidental-key.pem'), key);
  await writeFile(join(directory, 'secret.txt'), 'must not be served');
  await symlink(directory, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  const web = createServer({ cert, key }, await staticHandler(root));
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
  const port = web.address().port;
  try {
    const index = await get(port); assert.equal(index.status, 200); assert.match(index.body, /Flowa/);
    assert.equal(index.headers['x-content-type-options'], 'nosniff');
    assert.equal((await get(port, '/sw.js')).headers['cache-control'], 'no-store');
    assert.equal((await get(port, '/', { method: 'HEAD' })).body, '');
    assert.equal((await get(port, '/', { method: 'POST' })).status, 405);
    for (const path of ['/%2e%2e/secret.txt', '/..%5csecret.txt', '/outside/secret.txt', '/.device-build.json', '/accidental-key.pem', '/%E0%A4%A', '/missing.js', '/rooms', '/__test__/release'])
      assert.equal((await get(port, path)).status, 404, path);
    await assert.rejects(get(port, '/', { ca: undefined }), /self-signed certificate/);
    await assert.rejects(get(port, '/', { servername: 'wrong.test' }), /Hostname\/IP does not match/);
  } finally {
    web.closeAllConnections(); await new Promise(resolve => web.close(resolve));
    // Remove the known junction itself before deleting the temporary test directory.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.match(basename(directory), /^flowa-device-/);
    await rm(join(root, 'outside'), { recursive: true }); await rm(directory, { recursive: true, force: true });
  }
});

test('TLS relay serves authenticated WSS with exact Origin checks and unchanged synchronization', async () => {
  const relay = createRelay({ origins: [origin], tls: { cert, key } });
  const port = await relay.listen();
  const sockets = [];
  async function connect(room, token, allowedOrigin = origin) {
    const socket = io(`https://127.0.0.1:${port}`, { transports: ['websocket'], ca: cert, rejectUnauthorized: true, reconnection: false, timeout: 3000, extraHeaders: { Origin: allowedOrigin }, auth: { protocol: 2, roomId: room.roomId, token, name: 'TLS test' } });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  try {
    assert.equal((await get(port, '/healthz')).status, 200);
    assert.equal((await get(port, '/rooms', { method: 'POST', headers: { Origin: 'https://untrusted.test' } })).status, 403);
    const response = await get(port, '/rooms', { method: 'POST', headers: { Origin: origin } });
    assert.equal(response.status, 201); assert.equal(response.headers['cache-control'], 'no-store');
    const room = JSON.parse(response.body);
    await assert.rejects(connect(room, room.manager, 'https://untrusted.test'), /websocket error/);
    await assert.rejects(connect(room, 'x'.repeat(43)), /unauthorized/);
    const owner = await connect(room, room.manager); await initialize(owner, [rectangle('tls')]);
    const accepted = await rpc(owner, 'elements-update', update([rectangle('tls', { version: 2 })]));
    assert.equal(accepted.seq, 1);
  } finally { for (const socket of sockets) socket.disconnect(); await relay.close(); }
});

test('relay reports an occupied listen port instead of leaving startup pending', async () => {
  const first = createRelay({ origins: [origin] }), second = createRelay({ origins: [origin] });
  try { const port = await first.listen(); await assert.rejects(second.listen(port), { code: 'EADDRINUSE' }); }
  finally { await first.close(); await second.close(); }
});
