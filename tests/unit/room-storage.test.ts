import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
