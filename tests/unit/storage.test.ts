import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDB } from 'idb';
import { BoardRepository, DraftConflictError, MAX_RECOVERY_COPIES, MAX_SCENE_BYTES } from '../../apps/web/src/storage.ts';

test('legacy draft migrates without changing its contents', async () => {
  const name = crypto.randomUUID();
  const old = await openDB(name, 1, { upgrade(db) { db.createObjectStore('boards'); } });
  await old.put('boards', '{"elements":[]}', 'draft'); old.close();
  const repository = new BoardRepository(name);
  const draft = await repository.read();
  assert.equal(draft?.scene, '{"elements":[]}');
  assert.equal(draft?.revision, 0);
  await repository.write('new scene', 0, true);
  assert.equal(await repository.latestRecovery(), draft?.scene);
  await repository.close();
});

test('concurrent tabs cannot silently overwrite each other', async () => {
  const name = crypto.randomUUID();
  const a = new BoardRepository(name), b = new BoardRepository(name);
  await a.write('original', 0);
  const results = await Promise.allSettled([a.write('A', 1), b.write('B', 1)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failure.reason instanceof DraftConflictError);
  assert.equal((await a.read())?.revision, 2);
  await a.close(); await b.close();
});

test('replacement keeps bounded recovery copies and conflict leaves both untouched', async () => {
  const name = crypto.randomUUID();
  const repository = new BoardRepository(name);
  for (let i = 0; i < 7; i++) await repository.write(`scene ${i}`, i, true);
  assert.equal(await repository.latestRecovery(), 'scene 5');
  await assert.rejects(repository.write('stale', 1, true), DraftConflictError);
  assert.equal((await repository.read())?.scene, 'scene 6');
  assert.equal(await repository.latestRecovery(), 'scene 5');
  const db = await openDB(name);
  assert.equal(await db.count('recoveries'), MAX_RECOVERY_COPIES);
  db.close();
  await repository.close();
});

test('oversize write cannot replace a saved draft', async () => {
  const repository = new BoardRepository(crypto.randomUUID());
  await repository.write('safe', 0);
  await assert.rejects(repository.write('x'.repeat(MAX_SCENE_BYTES + 1), 1, true));
  assert.equal((await repository.read())?.scene, 'safe');
  assert.equal(await repository.latestRecovery(), undefined);
  await repository.close();
});

test('unknown future record is preserved rather than migrated destructively', async () => {
  const name = crypto.randomUUID();
  const repository = new BoardRepository(name);
  await repository.read();
  const db = await openDB(name);
  const future = { schemaVersion: 99, scene: 'future data' };
  await db.put('boards', future, 'draft');
  await assert.rejects(repository.read());
  await assert.rejects(repository.write('overwrite', 0));
  assert.deepEqual(await db.get('boards', 'draft'), future);
  db.close(); await repository.close();
});
