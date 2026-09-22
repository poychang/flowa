import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../../apps/web/src/document.ts';
const element = { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version: 2, versionNonce: 3, isDeleted: true };
const document = (elements: unknown[]) => JSON.stringify({ type: 'excalidraw', version: 2, elements });
test('backup validation retains tombstones', () => assert.equal(parseDocument(document([element])).elements[0].isDeleted, true));
test('invalid JSON, future versions, duplicate ids and malformed elements are rejected', () => {
  for (const input of ['null', '{}', '{', JSON.stringify({ type: 'excalidraw', version: 3, elements: [] }), document([element, element]), document([null]), document([{ ...element, x: null }]), document([{ ...element, version: -1 }]), document(Array.from({ length: 2001 }, (_, id) => ({ ...element, id: String(id) })))]) assert.throws(() => parseDocument(input));
});
