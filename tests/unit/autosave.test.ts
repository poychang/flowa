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

test('lazy changes coalesce serialization and explicit flush reads the latest content', async () => {
  let reads = 0, scene = 'A';
  const writes: string[] = [];
  const saver = new Autosave(async value => { writes.push(value); }, () => undefined, 60000);
  const read = () => { reads++; return scene; };
  saver.enqueueLazy(read); scene = 'B'; saver.enqueueLazy(read);
  assert.equal(reads, 0); assert.equal(saver.dirty, true);
  await saver.flush();
  assert.equal(reads, 1); assert.deepEqual(writes, ['B']);
  saver.enqueueLazy(read); await saver.flush();
  assert.deepEqual(writes, ['B']); assert.equal(saver.dirty, false);
  saver.dispose();
});

test('continuous notifications retain the first save deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let scene = 'A'; const writes: string[] = [];
  const saver = new Autosave(async value => { writes.push(value); }, () => undefined, 500);
  saver.enqueueLazy(() => scene);
  t.mock.timers.tick(400); scene = 'B'; saver.enqueueLazy(() => scene);
  t.mock.timers.tick(100); await saver.flush();
  assert.deepEqual(writes, ['B']); assert.equal(saver.dirty, false);
  saver.dispose();
});

test('serialization failure stays dirty and can be retried without another edit', async () => {
  let fail = true; const states: string[] = [], writes: string[] = [];
  const saver = new Autosave(async value => { writes.push(value); }, state => states.push(state), 60000);
  saver.enqueueLazy(() => { if (fail) throw new Error('serialization'); return 'work'; });
  await assert.rejects(saver.flush(), /serialization/);
  assert.equal(saver.dirty, true); assert.equal(states.at(-1), 'failed');
  fail = false; await saver.flush();
  assert.deepEqual(writes, ['work']); assert.equal(saver.dirty, false);
  saver.dispose();
});

test('lazy edits during a pending write are drained before flush completes', async () => {
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const writes: string[] = [];
  const saver = new Autosave(async value => { writes.push(value); if (value === 'A') await first; }, () => undefined, 60000);
  saver.enqueueLazy(() => 'A'); const flushing = saver.flush();
  saver.enqueueLazy(() => 'B'); saver.enqueueLazy(() => 'C');
  release(); await flushing;
  assert.deepEqual(writes, ['A', 'C']); assert.equal(saver.dirty, false);
  saver.dispose();
});
