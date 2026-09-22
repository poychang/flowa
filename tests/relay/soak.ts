import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createRelay } from '../../apps/relay/server.ts';
import { rectangle } from '../browser/fixtures.ts';
import { ORIGIN, roomAt, connect, initialize, joinFrom, rpc, update } from './helpers.ts';
import type { Update } from '../../packages/protocol/index.ts';

const duration = Number(process.env.SOAK_SECONDS ?? 1800) * 1000;
async function scenario(count: number) {
  const relay = createRelay({ origins: [ORIGIN] }); const url = `http://127.0.0.1:${await relay.listen()}`;
  const start = performance.now(), cpu = process.cpuUsage(); const errors: string[] = [], latency: number[] = [], memory: number[] = [];
  const room = await roomAt(url); const peers = []; const scenes: Map<string, any>[] = []; const pending = new Map<string, number>();
  const timers: ReturnType<typeof setInterval>[] = [];
  try {
    const initial = Array.from({ length: 500 }, (_, index) => rectangle(`object-${index}`, { x: index * 5, index: `a${String(index).padStart(4, '1')}` }));
    for (let i = 0; i < count; i++) {
      const peer = await connect(url, room, i === 0 ? 'manager' : 'editor'); peers.push(peer); scenes.push(new Map(initial.map(element => [element.id, { ...element }])));
      peer.on('elements-update', (packet: Update) => {
        for (const element of packet.elements) scenes[i].set(element.id, element);
        void rpc(peer, 'applied', { seq: packet.seq }).catch(error => errors.push(error.message));
      });
      peer.on('sync-ack', ({ id }) => { const sent = pending.get(id); if (sent !== undefined) { latency.push(performance.now() - sent); pending.delete(id); } });
      peer.on('sync-error', value => errors.push(value.error));
      peer.on('disconnect', reason => errors.push(`disconnect:${reason}`));
      if (!i) await initialize(peer, initial); else await joinFrom(peer, peers[0], initial);
    }
    for (let i = 0; i < count; i++) {
      let revision = 1;
      timers.push(setInterval(() => {
        const element = { ...scenes[i].get(`object-${i}`), version: ++revision, versionNonce: revision, x: revision % 500 };
        const packet = update([element]); pending.set(packet.id, performance.now());
        void rpc(peers[i], 'elements-update', packet).catch(error => errors.push(error.message));
      }, 1000));
      timers.push(setInterval(() => { void rpc(peers[i], 'presence', { x: revision, y: i }).catch(error => errors.push(error.message)); }, 250));
    }
    timers.push(setInterval(() => memory.push(process.memoryUsage().rss), 10000));
    await new Promise(resolve => setTimeout(resolve, duration));
    timers.forEach(clearInterval); await new Promise(resolve => setTimeout(resolve, 1000));
    const contents = scenes.map(scene => JSON.stringify([...scene].sort(([a], [b]) => a.localeCompare(b))));
    if (!contents.every(content => content === contents[0])) errors.push('scenes-diverged');
    if (pending.size) errors.push(`unacknowledged:${pending.size}`);
    latency.sort((a, b) => a - b);
    return { participants: count, durationSeconds: Math.round((performance.now() - start) / 1000), objects: 500, updateHzPerPeer: 1, cursorHzPerPeer: 4, acknowledgements: latency.length, p95Milliseconds: latency[Math.floor(latency.length * .95)] ?? null, forwardedBytes: relay.stats.forwardedBytes, errors, rssPeakBytes: Math.max(...memory, process.memoryUsage().rss), processCpuMicroseconds: process.cpuUsage(cpu), note: 'Real Socket.IO peers on loopback; no rendering. Both scenarios run in one process; CPU/RSS include both servers and clients. Not Azure measurements.' };
  } finally { timers.forEach(clearInterval); peers.forEach(peer => { peer.removeAllListeners(); peer.disconnect(); }); await relay.close(); }
}
const results = await Promise.all([scenario(2), scenario(4)]);
await mkdir('docs/testing', { recursive: true });
await writeFile('docs/testing/relay-soak.json', JSON.stringify({ at: new Date().toISOString(), node: process.version, results }, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
if (results.some(result => result.errors.length || result.p95Milliseconds === null || result.p95Milliseconds >= 500)) process.exitCode = 1;
