import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { sha256, verifyRelease } from '../../scripts/release-utils.mjs';

test('Linux archive starts outside the checkout with packaged dependencies and licenses', { skip: process.platform !== 'linux', timeout: 20000 }, async t => {
  const archive = resolve('release-artifacts/ci-relay.tar.gz');
  assert.equal((await readFile(`${archive}.sha256`, 'utf8')).split(' ')[0], sha256(await readFile(archive)));
  const root = await mkdtemp(join(tmpdir(), 'flowa-relay-standalone-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await promisify(execFile)('tar', ['-xzf', archive, '-C', root]);
  const manifest = await verifyRelease(root);
  assert.equal(manifest.platform, 'linux'); assert.equal(manifest.arch, process.arch);
  assert.ok(!manifest.dependencies.some(pkg => ['react', '@excalidraw/excalidraw', 'typescript'].includes(pkg.name)));
  const licenses = JSON.parse(await readFile(join(root, 'dependency-licenses.json'), 'utf8'));
  assert.equal(licenses.length, manifest.dependencies.length);
  assert.ok(licenses.every(pkg => pkg.licenseFiles.length > 0));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['socket.io', 'zod']);
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', PORT: String(port), HOST: '127.0.0.1', ALLOWED_ORIGINS: 'https://flowa.example' };
  const child = spawn(process.execPath, ['scripts/start-relay.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; });
  const url = `http://127.0.0.1:${port}`; let health;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try { health = await (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(300) })).json(); break; }
    catch { await delay(50); }
  }
  assert.equal(health?.ok, true, output);
  const check = await promisify(execFile)(process.execPath, ['scripts/check-relay.mjs'], { cwd: root, env: { ...env, RELAY_HEALTH_ORIGIN: url }, timeout: 3000 });
  assert.equal(JSON.parse(check.stdout).protocol, health.protocol);
  const response = await fetch(`${url}/rooms`, { method: 'POST', headers: { Origin: 'https://flowa.example' } });
  assert.equal(response.status, 201); const room = await response.json();
  const socket = io(url, { transports: ['websocket'], reconnection: false, extraHeaders: { Origin: 'https://flowa.example' },
    auth: { protocol: health.protocol, roomId: room.roomId, token: room.manager, name: 'Release smoke' } });
  t.after(() => socket.disconnect());
  await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error; })]);
  socket.disconnect(); child.kill('SIGTERM'); assert.deepEqual(await exited, [0, null]);
});
