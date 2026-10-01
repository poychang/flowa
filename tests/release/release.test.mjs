import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inventory, notices, verifyRelease } from '../../scripts/release-utils.mjs';

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'flowa-release-test-'));
  // Only the exact mkdtemp directory owned by this test is removed.
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
test('release verification rejects modified, missing and unexpected files', async t => {
  const root = await directory(t); await writeFile(join(root, 'main.js'), 'original');
  const manifest = { format: 1, files: await inventory(root) };
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest));
  await verifyRelease(root);
  await writeFile(join(root, 'main.js'), 'changed'); await assert.rejects(verifyRelease(root), /integrity/);
  await rm(join(root, 'main.js')); await assert.rejects(verifyRelease(root), /integrity/);
  await writeFile(join(root, 'main.js'), 'original');
  await writeFile(join(root, 'unexpected'), 'extra'); await assert.rejects(verifyRelease(root), /integrity/);
});
test('release inventory rejects links outside the package and absolute links', { skip: process.platform === 'win32' }, async t => {
  const root = await directory(t), external = await directory(t);
  await symlink(external, join(root, 'external')); await assert.rejects(inventory(root), /relative/);
  await rm(join(root, 'external')); await symlink('../' + external.split('/').at(-1), join(root, 'external'));
  await assert.rejects(inventory(root), /escapes/);
  await rm(join(root, 'external'));
  await writeFile(join(external, 'manifest.json'), '{}');
  await symlink(join(external, 'manifest.json'), join(root, 'release-manifest.json'));
  await assert.rejects(verifyRelease(root), /regular file/);
});
test('dependency notices preserve original text and fail on missing license files', async t => {
  const root = await directory(t), pkg = join(root, 'node_modules/.pnpm/example@1/node_modules/example');
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }));
  await assert.rejects(notices(root), /License text missing/);
  const license = 'Copyright fixture author\nPermission text\n'; await writeFile(join(pkg, 'LICENSE'), license);
  const data = await notices(root); assert.equal(data.length, 1);
  assert.ok((await readFile(join(root, 'THIRD-PARTY-NOTICES.txt'), 'utf8')).includes(license));
  assert.equal(data[0].path, 'node_modules/.pnpm/example@1/node_modules/example');
});
