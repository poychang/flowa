import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDB } from 'idb';
import { BoardRepository } from '../../apps/web/src/storage.ts';
test('room checkpoints and revisions are isolated from other rooms and local draft', async () => {
  const name = crypto.randomUUID();
  const local = new BoardRepository(name), a = new BoardRepository(name, 'room:a'), b = new BoardRepository(name, 'room:b');
  await local.write('local', 0); await a.write('a0', 0); await b.write('b0', 0);
  for (let i = 1; i <= 5; i++) await a.write(`a${i}`, i, true);
  await b.write('b1', 1, true);
  assert.equal(await a.latestRecovery(), 'a4'); assert.equal(await b.latestRecovery(), 'b0'); assert.equal(await local.latestRecovery(), undefined);
  assert.equal((await local.read())?.scene, 'local'); assert.equal((await b.read())?.revision, 2);
  await local.close(); await a.close(); await b.close();
});

test('recovery history stays bounded across many rooms without deleting current boards', async () => {
  const name = crypto.randomUUID();
  for (let i = 0; i < 14; i++) {
    const repository = new BoardRepository(name, `room:${i}`);
    await repository.write(`before-${i}`, 0);
    await repository.write(`after-${i}`, 1, true);
    await repository.close();
  }
  const db = await openDB(name, 2);
  assert.equal(await db.count('recoveries'), 12);
  assert.equal(await db.count('boards'), 14);
  assert.equal((await db.getAll('recoveries'))[0].scene, 'before-2');
  // The byte limit independently evicts old copies, even below the count cap.
  for (let i = 0; i < 4; i++) {
    const repository = new BoardRepository(name, `large:${i}`);
    await repository.write('x'.repeat(9 * 1024 * 1024), 0);
    await repository.write('small', 1, true);
    await repository.close();
  }
  const copies = await db.getAll('recoveries');
  assert.equal(copies.length, 3);
  assert.ok(copies.reduce((bytes, copy) => bytes + new TextEncoder().encode(copy.scene).length, 0) <= 30 * 1024 * 1024);
  assert.equal((await db.get('boards', 'room:0')).scene, 'after-0');
  db.close();
});
