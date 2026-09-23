import { io, type Socket } from 'socket.io-client';
import { createHash, randomUUID } from 'node:crypto';
import { LIMITS, VERSION } from '../../packages/protocol/index.ts';
import type { RoomCredentials, Reply, Element, Update } from '../../packages/protocol/index.ts';
export const ORIGIN = 'http://127.0.0.1:5180';
export async function roomAt(url: string): Promise<RoomCredentials> {
  const response = await fetch(`${url}/rooms`, { method: 'POST', headers: { Origin: ORIGIN } });
  if (!response.ok) throw new Error(await response.text()); return response.json();
}
export function rpc<T = any>(socket: Socket, event: string, value: unknown): Promise<T> {
  return new Promise((resolve, reject) => socket.timeout(6000).emit(event, value, (timeout: Error | null, reply: Reply<T>) => timeout ? reject(timeout) : !reply.ok ? reject(new Error(reply.error)) : resolve(reply.value as T)));
}
export function once<T = any>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`timeout:${event}`)), 6000); socket.once(event, value => { clearTimeout(timer); resolve(value); }); });
}
export async function connect(url: string, room: RoomCredentials, role: 'manager' | 'editor' | 'viewer' = 'manager', extra = {}) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { Origin: ORIGIN }, auth: { protocol: VERSION, roomId: room.roomId, token: room[role], name: role, ...extra }, autoConnect: false });
  const joined = new Promise<any>((resolve, reject) => { socket.once('joined', resolve); socket.once('connect_error', error => { socket.disconnect(); reject(error); }); });
  socket.connect(); await joined; return socket;
}
export async function upload(socket: Socket, request: { transferId: string; baseSeq: number }, elements: unknown[]) {
  const bytes = Buffer.from(JSON.stringify(elements));
  await rpc(socket, 'snapshot-meta', { transferId: request.transferId, baseSeq: request.baseSeq, bytes: bytes.length, chunks: Math.ceil(bytes.length / LIMITS.chunk), digest: createHash('sha256').update(bytes).digest('hex') });
  for (let index = 0; index < Math.ceil(bytes.length / LIMITS.chunk); index++) await rpc(socket, 'snapshot-chunk', { transferId: request.transferId, index, data: bytes.subarray(index * LIMITS.chunk, (index + 1) * LIMITS.chunk) });
}
export async function initialize(socket: Socket, elements: unknown[] = []) {
  const incoming = once(socket, 'snapshot-meta'); const request = once(socket, 'snapshot-request');
  await rpc(socket, 'sync-start', {}); await upload(socket, await request, elements); const meta = await incoming;
  await rpc(socket, 'sync-ready', { transferId: meta.transferId, seq: meta.baseSeq });
}
export async function joinFrom(socket: Socket, donor: Socket, elements: unknown[]) {
  const request = once(donor, 'snapshot-request'); const incoming = once(socket, 'snapshot-meta');
  await rpc(socket, 'sync-start', {}); await upload(donor, await request, elements); const meta = await incoming;
  await rpc(socket, 'sync-ready', { transferId: meta.transferId, seq: meta.baseSeq });
}
export function update(elements: unknown[]) { return { protocol: VERSION, id: randomUUID(), elements }; }
