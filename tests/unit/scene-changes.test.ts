import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneChanges } from '../../apps/web/src/scene-changes.ts';

test('view-only notifications are ignored, but mutations, replacement, order and tombstones are retained', () => {
  const tracker = new SceneChanges();
  const a = { id: 'a', version: 1, versionNonce: 1, isDeleted: false };
  const b = { ...a, id: 'b' };
  assert.equal(tracker.changed([a, b], 'state', {}), true);
  assert.equal(tracker.changed([a, b], 'state', {}), false);
  a.version++; assert.equal(tracker.changed([a, b], 'state', {}), true);
  a.versionNonce++; assert.equal(tracker.changed([a, b], 'state', {}), true);
  assert.equal(tracker.changed([b, a], 'state', {}), true);
  a.isDeleted = true; assert.equal(tracker.changed([b, a], 'state', {}), true);
  const replacement = { ...a }; assert.equal(tracker.changed([b, replacement], 'state', {}), true);
  assert.equal(tracker.changed([replacement], 'state', {}), true);
  assert.equal(tracker.changed([], 'state', {}), true);
  assert.equal(tracker.changed([], 'background-changed', {}), true);
});

test('file additions, in-place data changes and removal are detected without encoding data URLs', () => {
  const tracker = new SceneChanges();
  tracker.changed([], 'state', {});
  const file = { id: 'image', dataURL: 'data:original', mimeType: 'image/png', created: 1 };
  assert.equal(tracker.changed([], 'state', { image: file }), true);
  assert.equal(tracker.changed([], 'state', { image: { ...file } }), false);
  file.dataURL = 'data:updated'; assert.equal(tracker.changed([], 'state', { image: file }), true);
  file.created++; assert.equal(tracker.changed([], 'state', { image: file }), true);
  assert.equal(tracker.changed([], 'state', {}), true);
});
