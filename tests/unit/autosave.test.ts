import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Autosave } from '../../apps/web/src/autosave.ts';

test('edits arriving during a write are saved serially; status waits for final write', async () => {
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const writes: string[] = [], states: string[] = [];
  const saver = new Autosave(async scene => { writes.push(scene); if (scene === 'A') await first; }, state => states.push(state), 60000);
  saver.enqueue('A'); const flush = saver.flush();
  saver.enqueue('B'); saver.enqueue('C');
  assert.equal(saver.dirty, true);
  assert.ok(!states.includes('saved'));
  release(); await flush;
  assert.deepEqual(writes, ['A', 'C']);
  assert.equal(states.at(-1), 'saved'); assert.equal(saver.dirty, false);
  saver.dispose();
});

test('quota failure remains dirty and explicit retry saves unchanged content', async () => {
  let fail = true;
  const states: string[] = [];
  const saver = new Autosave(async () => { if (fail) throw new Error('quota'); }, state => states.push(state), 60000);
  saver.enqueue('important work');
  await assert.rejects(saver.flush());
  assert.equal(saver.dirty, true); assert.equal(states.at(-1), 'failed');
  fail = false; await saver.flush();
  assert.equal(saver.dirty, false); assert.equal(states.at(-1), 'saved');
  saver.dispose();
});

test('unchanged scene and view-only notifications do not schedule another write', async () => {
  let writes = 0;
  const saver = new Autosave(async () => { writes++; }, () => undefined, 60000);
  saver.seed('same'); saver.enqueue('same'); await saver.flush();
  assert.equal(writes, 0); saver.dispose();
});
