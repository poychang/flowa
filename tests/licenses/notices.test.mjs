import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fontNotices, frontendNotices } from '../../scripts/frontend-notices.mjs';
import { sha256 } from '../../scripts/release-utils.mjs';

test('font review rejects missing, additional, modified assets and version changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowa-licenses-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fonts = join(root, 'fonts'), evidence = join(root, 'evidence');
  await mkdir(fonts); await mkdir(evidence);
  await writeFile(join(evidence, 'manifest.json'), JSON.stringify({ excalidrawVersion: '0.18.1', families: { Test: {
    files: [{ file: 'test.woff2', sha256: sha256('font bytes') }], embeddedMetadata: [{ 0: ['Copyright test'], 13: [], 14: [] }],
  } } }));
  await writeFile(join(evidence, 'OFL-1.1.txt'), 'Test license');
  await assert.rejects(fontNotices(fonts, evidence), /inventory changed/);
  await writeFile(join(fonts, 'test.woff2'), 'font bytes');
  assert.match((await fontNotices(fonts, evidence)).text, /Copyright test/);
  await assert.rejects(fontNotices(fonts, evidence, '0.19.0'), /version changed/);
  await writeFile(join(fonts, 'extra.woff2'), 'font bytes');
  await assert.rejects(fontNotices(fonts, evidence), /inventory changed/);
  await rm(join(fonts, 'extra.woff2'));
  await writeFile(join(fonts, 'test.woff2'), 'different bytes');
  await assert.rejects(fontNotices(fonts, evidence), /content changed/);
});

test('a new dependency without license text fails instead of silently disappearing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowa-licenses-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'licenses/packages'), { recursive: true });
  await mkdir(join(root, 'node_modules/example'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { example: '1.0.0' } }));
  await writeFile(join(root, 'licenses/packages/sources.json'), '[]');
  await writeFile(join(root, 'node_modules/example/package.json'), JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }));
  await assert.rejects(frontendNotices(root, root), /License text missing: example@1.0.0/);
});

test('all explicit package fallbacks retain nonempty original notices and source URLs', async () => {
  const sources = JSON.parse(await readFile('licenses/packages/sources.json', 'utf8'));
  for (const source of sources) {
    assert.match(source.source, /^https:\/\/raw\.githubusercontent\.com\//);
    const text = await readFile(join('licenses/packages', source.file), 'utf8');
    assert.match(text, /[Cc]opyright/);
    assert.match(text, /Permission is hereby granted/);
  }
});
