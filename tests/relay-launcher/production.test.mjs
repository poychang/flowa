import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { checkRelay } from '../../scripts/check-relay.mjs';
import { VERSION } from '../../dist-relay/packages/protocol/index.js';

const origin = 'https://flowa.example';
async function reservePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function launch(port, overrides = {}) {
  const child = spawn(process.execPath, ['scripts/start-relay.mjs'], { windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port), ALLOWED_ORIGINS: origin, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  return { child, exited, output: () => output, async stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  } };
}
async function ready(process, url) {
  for (let i = 0; i < 100; i++) {
    if (process.child.exitCode !== null) throw new Error(process.output());
    try { return await checkRelay(url, { timeout: 500 }); } catch { await delay(50); }
  }
  throw new Error(`Relay never became ready: ${process.output()}`);
}

test('compiled production launcher serves health, validates origins, and loses rooms after restart', { timeout: 20000 }, async t => {
  const port = await reservePort(), url = `http://127.0.0.1:${port}`;
  const first = launch(port); t.after(() => first.stop()); await ready(first, url);
  const checked = await promisify(execFile)(process.execPath, ['scripts/check-relay.mjs'], {
    env: { ...process.env, RELAY_HEALTH_ORIGIN: url }, windowsHide: true, timeout: 3000 });
  assert.equal(JSON.parse(checked.stdout).protocol, VERSION);
  const health = await fetch(`${url}/healthz`);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { ok: true, protocol: VERSION });
  assert.equal((await fetch(`${url}/rooms`, { method: 'POST', headers: { Origin: 'https://wrong.example' } })).status, 403);
  const response = await fetch(`${url}/rooms`, { method: 'POST', headers: { Origin: origin } });
  assert.equal(response.status, 201); const room = await response.json();
  const socket = io(url, { transports: ['websocket'], reconnection: false, extraHeaders: { Origin: origin },
    auth: { protocol: VERSION, roomId: room.roomId, token: room.manager, name: 'Beta smoke' } });
  t.after(() => socket.disconnect());
  await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error; })]);
  const disconnected = once(socket, 'disconnect');
  await first.stop(); await disconnected;
  if (process.platform !== 'win32') assert.deepEqual(await first.exited, [0, null]);
  const second = launch(port); t.after(() => second.stop()); await ready(second, url);
  const oldRoom = await fetch(`${url}/rooms/${room.roomId}`, { method: 'DELETE', headers: { Origin: origin, Authorization: `Bearer ${room.manager}` } });
  assert.equal(oldRoom.status, 404);
  const recreated = await fetch(`${url}/rooms`, { method: 'POST', headers: { Origin: origin } });
  assert.equal(recreated.status, 201); assert.notEqual((await recreated.json()).roomId, room.roomId);
});

test('production command rejects development origins before opening a port', { timeout: 10000 }, async t => {
  const port = await reservePort(); const child = launch(port, { ALLOWED_ORIGINS: 'http://localhost:5173' });
  t.after(() => child.stop()); assert.equal((await child.exited)[0], 1);
  assert.match(child.output(), /ALLOWED_ORIGINS/);
  await assert.rejects(checkRelay(`http://127.0.0.1:${port}`, { timeout: 200 }));
});

test('production launcher reports occupied ports and exits', { timeout: 10000 }, async t => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const child = launch(server.address().port); t.after(() => child.stop());
  assert.equal((await child.exited)[0], 1); assert.match(child.output(), /EADDRINUSE/);
});

test('health probe rejects redirects, false positives, protocol mismatch and timeouts', { timeout: 10000 }, async t => {
  let mode = 'html';
  const server = createServer((req, res) => {
    if (mode === 'hang') return;
    if (mode === 'redirect') { res.writeHead(302, { Location: '/login' }); res.end(); return; }
    if (mode === 'html') { res.end('<html>login</html>'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: mode !== 'unhealthy', protocol: mode === 'version' ? -1 : VERSION }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (mode of ['html', 'redirect', 'unhealthy', 'version', 'hang']) await assert.rejects(checkRelay(url, { timeout: 100 }));
  mode = 'ok'; assert.equal((await checkRelay(url)).ok, true);
  for (const invalid of ['http://remote.example', 'https://user:secret@host.example', 'https://host.example/path', 'https://host.example#secret'])
    await assert.rejects(checkRelay(invalid), /RELAY_HEALTH_ORIGIN/);
  await assert.rejects(promisify(execFile)(process.execPath, ['scripts/check-relay.mjs'], {
    env: { ...process.env, RELAY_HEALTH_ORIGIN: 'https://user:secret@host.example' }, windowsHide: true, timeout: 3000 }),
  error => error.code === 1 && !error.stderr.includes('secret') && /Relay health check failed/.test(error.stderr));
});
