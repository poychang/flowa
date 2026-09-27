import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../../packages/protocol/index.ts';
import { rectangle } from '../browser/fixtures.ts';

test('empty bound children remain equivalent after Excalidraw restore without mutating input', () => {
  const original = rectangle('shape');
  assert.equal(canonical(original), canonical({ ...original, boundElements: [] }));
  assert.equal(canonical({ elements: [original] }), canonical({ elements: [{ ...original, boundElements: [] }] }));
  assert.equal(original.boundElements, null);
});

test('canonical comparison still detects actual binding, content and revision conflicts', () => {
  const original = rectangle('shape');
  for (const change of [
    { boundElements: [{ id: 'label', type: 'text' }] },
    { strokeColor: '#ff0000' }, { x: 999 }, { version: 2 }, { versionNonce: 999 },
    { frameId: '' }, { isDeleted: true },
  ]) assert.notEqual(canonical(original), canonical({ ...original, ...change }));
  assert.notEqual(canonical({ frameId: null }), canonical({ frameId: [] }));
  assert.notEqual(canonical({ ...original, customData: { boundElements: null } }), canonical({ ...original, customData: { boundElements: [] } }));
});
