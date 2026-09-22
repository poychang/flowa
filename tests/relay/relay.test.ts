import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRelay } from '../../apps/relay/server.ts';
import { rectangle } from '../browser/fixtures.ts';
import { roomAt, connect, rpc, once, initialize, joinFrom, update, upload, ORIGIN } from './helpers.ts';

test('rooms authenticate, deny viewer writes and cross-room access, and distinguish applied ACK', async () => {
  const server = createRelay({ origins: [ORIGIN] }); const url = `http://127.0.0.1:${await server.listen()}`;
  try {
    const room = await roomAt(url), other = await roomAt(url);
    await assert.rejects(connect(url, { ...room, manager: other.manager }), /unauthorized/);
    await assert.rejects(connect(url, room, 'manager', { protocol: 1 }), /invalid-auth/);
    const owner = await connect(url, room); await initialize(owner, [rectangle('base')]);
    const viewer = await connect(url, room, 'viewer'); await joinFrom(viewer, owner, [rectangle('base')]);
    await assert.rejects(rpc(viewer, 'elements-update', update([rectangle('bad')])), /unauthorized/);
    await assert.rejects(rpc(viewer, 'snapshot-meta', {}), /unauthorized/);
    const received = once(viewer, 'elements-update'); const ownerReceive = once(owner, 'elements-update');
    const delta = update([rectangle('base', { version: 2 })]); const accepted = await rpc(owner, 'elements-update', delta);
    const message = await received; assert.equal(message.seq, accepted.seq); await ownerReceive;
    let applied = false; owner.once('sync-ack', () => { applied = true; });
    await rpc(owner, 'applied', { seq: accepted.seq }); assert.equal(applied, false);
    const acknowledgement = once(owner, 'sync-ack'); await rpc(viewer, 'applied', { seq: accepted.seq });
    assert.equal((await acknowledgement).id, delta.id);
    const repeatedAck = once(owner, 'sync-ack');
    assert.equal((await rpc(owner, 'elements-update', delta)).seq, accepted.seq);
    assert.equal((await repeatedAck).id, delta.id);
    const deleted = await fetch(`${url}/rooms/${room.roomId}`, { method: 'DELETE', headers: { Origin: ORIGIN, Authorization: `Bearer ${room.viewer}` } }); assert.equal(deleted.status, 403);
    const closed = once(viewer, 'room-closed');
    await fetch(`${url}/rooms/${room.roomId}`, { method: 'DELETE', headers: { Origin: ORIGIN, Authorization: `Bearer ${room.manager}` } }); await closed;
    await assert.rejects(connect(url, room), /room-expired/);
  } finally { await server.close(); }
});

test('global capacity includes viewers and releases disconnected connections', async () => {
  const server = createRelay({ origins: [ORIGIN] }); const url = `http://127.0.0.1:${await server.listen()}`;
  try {
    const room = await roomAt(url), second = await roomAt(url);
    const peers = await Promise.all([connect(url, room), connect(url, room, 'editor'), connect(url, second), connect(url, second, 'viewer')]);
    await assert.rejects(connect(url, second, 'viewer'), /capacity-exceeded/);
    const disconnected = new Promise(resolve => server.io.sockets.sockets.get(peers[0].id!)!.once('disconnect', resolve)); peers[0].disconnect(); await disconnected;
    const replacement = await connect(url, room); assert.ok(replacement.connected);
  } finally { await server.close(); }
});

test('no source, malformed scene, origin, snapshot timeout and room expiry are explicit', async () => {
  let clock = Date.now(); const server = createRelay({ origins: [ORIGIN], roomMs: 10000, snapshotMs: 100, now: () => clock }); const url = `http://127.0.0.1:${await server.listen()}`;
  try {
    assert.equal((await fetch(`${url}/rooms`, { method: 'POST', headers: { Origin: 'https://evil.invalid' } })).status, 403);
    const room = await roomAt(url); const guest = await connect(url, room, 'editor');
    await assert.rejects(rpc(guest, 'sync-start', {}), /no-snapshot-source/);
    const owner = await connect(url, room); const timedout = once(owner, 'sync-error');
    await rpc(owner, 'sync-start', {}); clock += 101; server.sweep(); assert.equal((await timedout).error, 'snapshot-timeout');
    await initialize(owner, [rectangle('base')]);
    await assert.rejects(rpc(owner, 'elements-update', update([rectangle('bad', { type: 'image' })])), /invalid-payload/);
    await assert.rejects(rpc(owner, 'elements-update', update([rectangle('bad', { x: null })])), /invalid-payload/);
    await assert.rejects(rpc(owner, 'elements-update', update([rectangle('bad', { text: 'x'.repeat(255 * 1024) })])), /invalid-payload|payload-too-large/);
    const closed = once(owner, 'room-closed'); clock += 10001; server.sweep(); await closed;
    await assert.rejects(connect(url, room), /room-expired/);
  } finally { await server.close(); }
});

test('simultaneous joins cannot exceed the four-connection limit', async () => {
  const server = createRelay({ origins: [ORIGIN] }); const url = `http://127.0.0.1:${await server.listen()}`;
  try {
    const room = await roomAt(url);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => connect(url, room, 'viewer')));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 4);
    assert.equal(results.filter(result => result.status === 'rejected').length, 2);
  } finally { await server.close(); }
});

test('snapshot donor disconnection signals failure instead of empty success', async () => {
  const server = createRelay({ origins: [ORIGIN] }); const url = `http://127.0.0.1:${await server.listen()}`;
  try {
    const room = await roomAt(url); const owner = await connect(url, room); await initialize(owner);
    const guest = await connect(url, room, 'editor'); const failed = once(guest, 'sync-error');
    await rpc(guest, 'sync-start', {}); owner.disconnect();
    assert.equal((await failed).error, 'source-disconnected');
    await assert.rejects(rpc(guest, 'sync-start', {}), /no-snapshot-source/);
  } finally { await server.close(); }
});

test('bounded pending buffer and stale ready are rejected; a new snapshot acknowledges missed packets', async () => {
  let clock = Date.now(); const server = createRelay({ origins: [ORIGIN], now: () => clock }); const url = `http://127.0.0.1:${await server.listen()}`;
  try {
    const room = await roomAt(url); const owner = await connect(url, room); await initialize(owner);
    const viewer = await connect(url, room, 'viewer'); await joinFrom(viewer, owner, []);
    for (let i = 0; i < 64; i++) { clock += 1000; const result = await rpc(owner, 'elements-update', update([rectangle('base', { version: i + 1 })])); await rpc(owner, 'applied', { seq: result.seq }); }
    clock += 1000;
    await assert.rejects(rpc(owner, 'elements-update', update([rectangle('base', { version: 65 })])), /resync-required/);
    await joinFrom(viewer, owner, [rectangle('base', { version: 64 })]);
    assert.equal((await rpc(owner, 'elements-update', update([rectangle('base', { version: 65 })]))).seq, 65);
  } finally { await server.close(); }
});

test('snapshot validates contents, transfer ownership and object-count boundary', async () => {
  const server = createRelay({ origins: [ORIGIN] }); const url = `http://127.0.0.1:${await server.listen()}`;
  try {
    const room = await roomAt(url); const owner = await connect(url, room); await initialize(owner, Array.from({ length: 2000 }, (_, i) => rectangle(`id-${i}`, { index: `a0${i.toString(36)}1` })));
    await assert.rejects(rpc(owner, 'elements-update', update([rectangle('extra')])), /scene-too-large/);
    const viewer = await connect(url, room, 'viewer'); const request = once(owner, 'snapshot-request'); await rpc(viewer, 'sync-start', {}); const transfer = await request;
    await assert.rejects(rpc(viewer, 'snapshot-chunk', { transferId: transfer.transferId, index: 0, data: Buffer.from('[]') }), /unauthorized/);
    await assert.rejects(upload(owner, transfer, [rectangle('bad', { x: null })]), /invalid-payload/);
  } finally { await server.close(); }
});
