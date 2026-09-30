import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createRelay } from '../../apps/relay/server.ts';
import { canonical, parseSnapshot, type Element, type SnapshotMeta, type Update } from '../../packages/protocol/index.ts';
import { rectangle } from '../browser/fixtures.ts';
import { ORIGIN, roomAt, connect, initialize, joinFrom, rpc, update } from './helpers.ts';
import type { Socket } from 'socket.io-client';

function seconds(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value * 1000;
}
const duration = seconds('SOAK_SECONDS', 1800);
const interval = seconds('SOAK_RECONNECT_SECONDS', 300);
const offline = seconds('SOAK_OFFLINE_SECONDS', 10);
if (interval <= offline + 1000 || duration <= interval + offline + 1000) throw new Error('Soak must include a complete reconnect cycle and settling time');
const expectedReconnects = Math.ceil((duration - offline - 1000) / interval) - 1;
const output = process.env.SOAK_OUTPUT ?? 'test-results/reconnect-soak.json';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const sources = ['apps/relay/server.ts', 'packages/protocol/index.ts', 'tests/relay/reconnect-soak.ts', 'tests/relay/helpers.ts', 'tests/browser/fixtures.ts', 'pnpm-lock.yaml'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async path => [path, hash(await readFile(path))])));
const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, ...args], { encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
const dirtyPaths = git('status', '--porcelain', '--', ...sources);
const cpu = process.cpuUsage(), started = new Date().toISOString();
let rssPeakBytes = process.memoryUsage().rss;
const memoryTimer = setInterval(() => { rssPeakBytes = Math.max(rssPeakBytes, process.memoryUsage().rss); }, 1000);

async function scenario(count: number) {
  const relay = createRelay({ origins: [ORIGIN] });
  const errors: string[] = [], latency: number[] = [];
  const pending = new Map<string, number>();
  const acknowledgements = new Set<Promise<void>>();
  const peers: Socket[] = [], scenes: Map<string, Element>[] = [], sequences: number[] = [];
  const reconnects: { atSeconds: number; offlineSeconds: number; recoveryMilliseconds: number; snapshotBytes: number; onlineUpdatesWhileOffline: number; offlineEditRecovered: boolean; converged: boolean }[] = [];
  let startedAt = performance.now(), active = -1, stopping = false, plannedDisconnect = false;
  const contents = () => scenes.map(scene => canonical([...scene.values()].sort((a, b) => a.id.localeCompare(b.id))));
  const converged = () => { const values = contents(); return values.every(value => value === values[0]); };
  function track(promise: Promise<void>) {
    acknowledgements.add(promise);
    void promise.catch(error => errors.push(String(error.message))).finally(() => acknowledgements.delete(promise));
  }
  function watch(peer: Socket, index: number) {
    peer.on('elements-update', (packet: Update) => {
      if (packet.seq !== sequences[index] + 1) { errors.push(`sequence-gap:${index}:${packet.seq}`); return; }
      for (const element of packet.elements) scenes[index].set(element.id, element);
      sequences[index] = packet.seq;
      track(rpc(peer, 'applied', { seq: packet.seq }));
    });
    peer.on('sync-ack', ({ id }) => {
      const sent = pending.get(id);
      if (sent !== undefined) { latency.push(performance.now() - sent); pending.delete(id); }
    });
    peer.on('sync-error', value => errors.push(value.error));
    peer.on('disconnect', reason => { if (!stopping && !(plannedDisconnect && index === count - 1)) errors.push(`unexpected-disconnect:${index}:${reason}`); });
  }
  async function drain() {
    const deadline = performance.now() + 10000;
    while (pending.size || acknowledgements.size) {
      if (errors.length || performance.now() > deadline) throw new Error('ack-drain-failed');
      await sleep(10);
    }
  }
  async function send(index: number, element: Element) {
    const packet = update([element]); pending.set(packet.id, performance.now());
    await rpc(peers[index], 'elements-update', packet);
  }
  // The workload pauses only during the snapshot boundary. Online peers keep
  // editing throughout the offline interval; this is not a snapshot-overlap test.
  async function snapshot(peer: Socket, index: number) {
    let meta: SnapshotMeta | undefined; const parts: Buffer[] = [];
    const onMeta = (value: SnapshotMeta) => { meta = value; };
    const onChunk = (value: { transferId: string; index: number; data: Buffer }) => {
      if (!meta || value.transferId !== meta.transferId || value.index !== parts.length) { errors.push('invalid-snapshot-chunk'); return; }
      parts.push(Buffer.from(value.data));
    };
    peer.on('snapshot-meta', onMeta); peer.on('snapshot-chunk', onChunk);
    try {
      await joinFrom(peer, peers[0], [...scenes[0].values()]);
      const bytes = Buffer.concat(parts);
      if (!meta || parts.length !== meta.chunks || bytes.length !== meta.bytes || hash(bytes) !== meta.digest) throw new Error('snapshot-corrupt');
      scenes[index] = new Map(parseSnapshot(bytes.toString('utf8')).map(element => [element.id, element]));
      sequences[index] = meta.baseSeq;
      return bytes.length;
    } finally { peer.off('snapshot-meta', onMeta); peer.off('snapshot-chunk', onChunk); }
  }
  try {
    const url = `http://127.0.0.1:${await relay.listen()}`, room = await roomAt(url);
    const initial = parseSnapshot(JSON.stringify(Array.from({ length: 500 }, (_, i) => rectangle(`object-${i}`, { x: i * 5, index: `a${i.toString(36).padStart(4, '0')}1` }))));
    for (let i = 0; i < count; i++) {
      peers[i] = await connect(url, room, i === 0 ? 'manager' : 'editor');
      scenes[i] = new Map(initial.map(element => [element.id, { ...element }])); sequences[i] = 0;
      if (!i) await initialize(peers[i], initial); else await snapshot(peers[i], i);
      watch(peers[i], i);
    }
    startedAt = performance.now();
    let nextEdit = 0, nextPresence = 0, nextReconnect = interval, offlineAt = 0, progressAt = 60000;
    let offlineEdit: Element | undefined;
    while (performance.now() - startedAt < duration) {
      const elapsed = performance.now() - startedAt;
      if (errors.length) throw new Error('workload-error');
      if (active < 0 && elapsed >= nextReconnect && elapsed + offline + 1000 < duration) {
        await drain(); active = count - 1; plannedDisconnect = true;
        const serverSocket = relay.io.sockets.sockets.get(peers[active].id!)!;
        const disconnected = new Promise<void>(resolve => serverSocket.once('disconnect', () => resolve()));
        peers[active].disconnect(); await disconnected; plannedDisconnect = false;
        offlineAt = performance.now();
        const old = scenes[active].get(`object-${active}`)!;
        offlineEdit = { ...old, version: old.version + 1, versionNonce: old.version + 1, y: old.y + 1 };
        scenes[active].set(offlineEdit.id, offlineEdit);
      }
      if (active >= 0 && performance.now() - offlineAt >= offline) {
        await drain(); const recoveryAt = performance.now();
        const beforeSeq = sequences[active];
        peers[active].removeAllListeners(); peers[active] = await connect(url, room, 'editor');
        const snapshotBytes = await snapshot(peers[active], active); watch(peers[active], active);
        const onlineUpdatesWhileOffline = sequences[active] - beforeSeq;
        if (!onlineUpdatesWhileOffline) throw new Error('no-online-edits-during-outage');
        // Each peer owns a distinct object: retain its offline edit only when
        // newer than the received snapshot, then publish through the real relay.
        if (offlineEdit!.version <= scenes[active].get(offlineEdit!.id)!.version) throw new Error('offline-edit-not-newer');
        await send(active, offlineEdit!); await drain();
        const equal = converged();
        const offlineEditRecovered = scenes.every(scene => canonical(scene.get(offlineEdit!.id)) === canonical(offlineEdit));
        reconnects.push({ atSeconds: (offlineAt - startedAt) / 1000, offlineSeconds: (recoveryAt - offlineAt) / 1000, recoveryMilliseconds: performance.now() - recoveryAt, snapshotBytes, onlineUpdatesWhileOffline, offlineEditRecovered, converged: equal });
        if (!offlineEditRecovered) throw new Error('offline-edit-lost');
        if (!equal) throw new Error('reconnect-diverged');
        active = -1; nextReconnect += interval;
      }
      if (elapsed >= nextEdit) {
        for (let i = 0; i < count; i++) if (i !== active) {
          const old = scenes[i].get(`object-${i}`)!;
          await send(i, { ...old, version: old.version + 1, versionNonce: old.version + 1, x: (old.version + 1) % 500 });
        }
        nextEdit = elapsed + 1000;
      }
      if (elapsed >= nextPresence) {
        for (let i = 0; i < count; i++) if (i !== active) await rpc(peers[i], 'presence', { x: elapsed % 500, y: i });
        nextPresence = elapsed + 250;
      }
      if (elapsed >= progressAt) {
        console.log(JSON.stringify({ participants: count, elapsedSeconds: Math.floor(elapsed / 1000), reconnects: reconnects.length, errors: errors.length, acknowledgements: latency.length }));
        progressAt += 60000;
      }
      await sleep(20);
    }
    await drain();
    if (active >= 0 || reconnects.length !== expectedReconnects) throw new Error(`incomplete-reconnect:${reconnects.length}/${expectedReconnects}`);
    if (!converged()) throw new Error('scenes-diverged');
  } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  finally { stopping = true; peers.forEach(peer => { peer.removeAllListeners(); peer.disconnect(); }); await relay.close(); }
  latency.sort((a, b) => a - b);
  return { participants: count, durationSeconds: (performance.now() - startedAt) / 1000, objects: 500, targetUpdateHzPerOnlinePeer: 1, targetCursorHzPerOnlinePeer: 4,
    acknowledgements: latency.length, p95Milliseconds: latency[Math.floor(latency.length * .95)] ?? null,
    outboundPayloadBytes: relay.stats.outboundPayloadBytes, reconnects, errors, unacknowledged: pending.size,
    finalSceneHashes: contents().map(hash), converged: scenes.length === count && converged() };
}

try {
  const results = await Promise.all([scenario(2), scenario(4)]);
  const report = { started, finished: new Date().toISOString(), node: process.version, platform: process.platform, sourceCommit, dirtyPaths, sourceHashes,
    configuration: { durationSeconds: duration / 1000, reconnectIntervalSeconds: interval / 1000, offlineSeconds: offline / 1000 },
    processCpuMicroseconds: process.cpuUsage(cpu), rssPeakBytes: Math.max(rssPeakBytes, process.memoryUsage().rss), results,
    note: 'Concurrent loopback scenarios in one process; CPU/RSS include both relays and clients. Payload includes snapshots, ACKs and Presence, excludes transport framing/TLS. Disjoint object edits; snapshots pause workload after draining ACKs. No browser, IndexedDB, production session, WAN or Azure measurement.' };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (results.some(result => result.errors.length || !result.converged || result.unacknowledged || result.p95Milliseconds === null || result.p95Milliseconds >= 500)) process.exitCode = 1;
} finally { clearInterval(memoryTimer); }
