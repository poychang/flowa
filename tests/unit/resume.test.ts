import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchResume, type ResumeReason } from '../../apps/web/src/sync/resume.ts';

function setup() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const win = new EventTarget(); let time = 0; const reasons: ResumeReason[] = [];
  const stop = watchResume(reason => reasons.push(reason), doc, win, () => time);
  return { doc, win, reasons, stop, advance: (ms: number) => { time += ms; },
    visibility: (state: DocumentVisibilityState) => { doc.visibilityState = state; doc.dispatchEvent(new Event('visibilitychange')); },
    restore: () => win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })),
  };
}
test('short tab switches do not resync, long background pauses do', () => {
  const s = setup(); s.visibility('hidden'); s.advance(5000); s.visibility('visible');
  assert.deepEqual(s.reasons, []);
  s.visibility('hidden'); s.advance(60000); s.visibility('visible');
  assert.deepEqual(s.reasons, ['visible']); s.stop();
});
test('restored pages resume once despite duplicate lifecycle signals', () => {
  const s = setup(); s.win.dispatchEvent(new Event('pageshow')); assert.deepEqual(s.reasons, []);
  s.restore(); s.restore(); s.win.dispatchEvent(new Event('online'));
  assert.deepEqual(s.reasons, ['restored']); s.stop();
});
test('network and restore signals wait until a hidden page becomes visible', () => {
  const s = setup(); s.visibility('hidden'); s.win.dispatchEvent(new Event('online')); s.restore();
  assert.deepEqual(s.reasons, []); s.visibility('visible'); assert.deepEqual(s.reasons, ['restored']); s.stop();
});
test('closing the observer detaches all lifecycle listeners', () => {
  const s = setup(); s.stop(); s.restore(); s.win.dispatchEvent(new Event('online'));
  s.visibility('hidden'); s.advance(60000); s.visibility('visible'); assert.deepEqual(s.reasons, []);
});
test('an online hint cannot suppress a stronger restored-page signal', () => {
  const s = setup(); s.win.dispatchEvent(new Event('online')); s.restore();
  assert.deepEqual(s.reasons, ['online', 'restored']);
  s.advance(2000); s.visibility('hidden'); s.restore(); s.win.dispatchEvent(new Event('online')); s.visibility('visible');
  assert.deepEqual(s.reasons, ['online', 'restored', 'restored']); s.stop();
});
