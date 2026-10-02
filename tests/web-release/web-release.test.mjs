import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { webReleaseConfig } from '../../scripts/web-release-config.mjs';
import { verifyRelease, sha256 } from '../../scripts/release-utils.mjs';

test('release requires explicit HTTPS origins and rejects ambiguous or secret-bearing URLs', () => {
  const env = { RELEASE_WEB_ORIGIN: 'https://Flowa.example:443/', RELEASE_RELAY_ORIGIN: 'https://relay.example' };
  assert.deepEqual(webReleaseConfig(env), { webOrigin: 'https://flowa.example', relayOrigin: 'https://relay.example' });
  for (const key of Object.keys(env)) {
    for (const value of [undefined, '', 'http://localhost', 'https://u:p@flowa.example', 'https://flowa.example/path', 'https://flowa.example?token=x', 'https://flowa.example#x', ' https://flowa.example', 'https://flowa.example\n', 'https://flowa.example:0', 'https://0.0.0.0', 'https://[::]', 'https://*.example', 'https://flowa.example\\'])
      assert.throws(() => webReleaseConfig({ ...env, [key]: value }), /HTTPS origin/);
  }
});

test('Linux web archive is self-contained, bound to its relay, and has a complete PWA allowlist', { skip: process.platform !== 'linux' }, async t => {
  const archive = resolve('release-artifacts/ci-web.tar.gz');
  const expectedHash = (await readFile(`${archive}.sha256`, 'utf8')).split(' ')[0];
  assert.equal(sha256(await readFile(archive)), expectedHash);
  const root = await mkdtemp(join(tmpdir(), 'flowa-web-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('tar', ['--same-permissions', '-xzf', archive, '-C', root]);
  const manifest = await verifyRelease(root);
  assert.equal(manifest.kind, 'flowa-web');
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(manifest.config, webReleaseConfig());
  const names = Object.keys(manifest.files);
  for (const required of ['index.html', 'sw.js', 'manifest.webmanifest', 'THIRD-PARTY-NOTICES.txt', 'dependency-licenses.json']) assert.ok(names.includes(`site/${required}`));
  assert.ok(!names.some(name => /(?:^|\/)\.|\.map$|node_modules|dist-relay/.test(name)));
  assert.ok(!Object.values(manifest.files).some(file => file.link));
  const worker = await readFile(join(root, 'site/sw.js'), 'utf8');
  assert.ok(worker.includes(`const VERSION = '${manifest.pwaVersion}'`));
  const assets = JSON.parse(worker.match(/const ASSETS = (\[[^\n]+\]);/)[1]);
  assert.deepEqual([...assets].sort(), names.filter(n => n.startsWith('site/') && n !== 'site/sw.js').map(n => n.slice(4)).sort());
  const js = (await Promise.all(names.filter(n => n.startsWith('site/assets/') && n.endsWith('.js')).map(n => readFile(join(root, n), 'utf8')))).join('\n');
  assert.ok(js.includes(manifest.config.relayOrigin));
  assert.ok(!js.includes('ambient-config-must-not-ship.invalid'));
  const notices = await readFile(join(root, 'site/THIRD-PARTY-NOTICES.txt'), 'utf8');
  assert.ok(notices.includes('SIL OPEN FONT LICENSE'));
});
