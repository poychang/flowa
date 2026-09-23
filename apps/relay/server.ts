import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import { VERSION, LIMITS, joinSchema, parseDelta, parseSnapshot, snapshotMetaSchema, presenceSchema, canonical, jsonBytes } from '../../packages/protocol/index.ts';
import type { Member, Role, RoomCredentials, Update, SnapshotMeta, Reply, Element } from '../../packages/protocol/index.ts';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
type Version = { version: number; nonce: number; hash: string; bytes: number };
type Pending = { update: Update; waiting: Set<string>; bytes: number; at: number };
type Transfer = { id: string; donor: string; target: string; base: number; at: number; seed: boolean; meta?: SnapshotMeta; parts: Buffer[]; received: number };
type Room = { id: string; expiresAt: number; emptyAt: number; credentials: Record<Role, string>; initialized: boolean; seq: number; members: Map<string, Member>; versions: Map<string, Version>; pending: Map<number, Pending>; seen: Map<string, { hash: string; seq: number }>; transfers: Map<string, Transfer> };
export interface RelayOptions { origins: string[]; capacity?: number; roomMs?: number; idleMs?: number; snapshotMs?: number; now?: () => number; }

export function createRelay(options: RelayOptions) {
  const rooms = new Map<string, Room>();
  const now = options.now ?? Date.now;
  const rates = new Map<string, { start: number; count: number }>();
  const stats = { acceptedUpdates: 0, forwardedBytes: 0, outboundPayloadBytes: 0, rejected: 0 };
  function rate(key: string, maximum: number, windowMs: number) {
    const stamp = now(); const existing = rates.get(key);
    if (!existing || stamp - existing.start >= windowMs) {
      if (rates.size >= 1024 && !existing) throw new Error('rate-limited');
      rates.set(key, { start: stamp, count: 1 }); return;
    }
    if (++existing.count > maximum) throw new Error('rate-limited');
  }
  function roleFor(room: Room, token: string): Role | undefined {
    const candidate = Buffer.from(hash(token));
    return (Object.keys(room.credentials) as Role[]).find(role => timingSafeEqual(candidate, Buffer.from(room.credentials[role])));
  }
  function validRoom(id: string) {
    const room = rooms.get(id);
    if (!room || now() >= room.expiresAt) throw new Error('room-expired');
    return room;
  }
  const http = createServer((req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (origin && options.origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, GET, OPTIONS');
    }
    const reply = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && req.url === '/healthz') { reply(200, { ok: true, protocol: VERSION }); return; }
      if (!origin || !options.origins.includes(origin)) { reply(403, { error: 'origin-denied' }); return; }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method === 'POST' && req.url === '/rooms') {
        rate(`create:${req.socket.remoteAddress}`, 5, 60000); rate('create:global', 20, 60000);
        if (rooms.size >= 32) throw new Error('capacity-exceeded');
        const value: RoomCredentials = { roomId: randomUUID(), manager: secret(), editor: secret(), viewer: secret(), expiresAt: now() + (options.roomMs ?? LIMITS.roomMs) };
        rooms.set(value.roomId, { id: value.roomId, expiresAt: value.expiresAt, emptyAt: now(), credentials: { manager: hash(value.manager), editor: hash(value.editor), viewer: hash(value.viewer) }, initialized: false, seq: 0, members: new Map(), versions: new Map(), pending: new Map(), seen: new Map(), transfers: new Map() });
        reply(201, value); return;
      }
      const match = req.url?.match(/^\/rooms\/([\w-]+)$/);
      if (req.method === 'DELETE' && match) {
        const room = validRoom(match[1]); const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (roleFor(room, token) !== 'manager') { reply(403, { error: 'unauthorized' }); return; }
        closeRoom(room); reply(200, { ok: true }); return;
      }
      reply(404, { error: 'not-found' });
    } catch (error) { reply(429, { error: error instanceof Error ? error.message : 'invalid-request' }); }
  });
  const io = new Server(http, { transports: ['websocket'], maxHttpBufferSize: LIMITS.packet, connectTimeout: 5000,
    allowRequest: (req, callback) => callback(null, Boolean(req.headers.origin && options.origins.includes(req.headers.origin))),
  });
  function members(room: Room) { io.to(room.id).emit('members', [...room.members.values()]); }
  function closeRoom(room: Room) { rooms.delete(room.id); io.to(room.id).emit('room-closed'); io.in(room.id).disconnectSockets(true); }
  function authorized(socket: Socket, write = false) {
    const room = validRoom(socket.data.roomId);
    const member = room.members.get(socket.id);
    if (!member || (write && member.role === 'viewer')) throw new Error('unauthorized');
    return { room, member };
  }
  function catalog(room: Room, elements: Element[]) {
    const next = new Map(room.versions);
    for (const element of elements) {
      const old = next.get(element.id); const fingerprint = hash(canonical(element));
      if (old && old.version === element.version && old.nonce === element.versionNonce && old.hash !== fingerprint) throw new Error('conflicting-revision');
      if (!old || element.version > old.version || (element.version === old.version && element.versionNonce < old.nonce)) next.set(element.id, { version: element.version, nonce: element.versionNonce, hash: fingerprint, bytes: jsonBytes(element) });
    }
    if (next.size > LIMITS.elements || [...next.values()].reduce((sum, item) => sum + item.bytes + 1, 2) > LIMITS.scene) throw new Error('scene-too-large');
    return next;
  }
  function failTransfer(room: Room, transfer: Transfer, error: string) {
    room.transfers.delete(transfer.id); io.to(transfer.target).emit('sync-error', { error });
  }
  io.use((socket, next) => {
    try {
      const auth = joinSchema.parse(socket.handshake.auth);
      const room = validRoom(auth.roomId); const role = roleFor(room, auth.token);
      if (!role) throw new Error('unauthorized');
      if (io.of('/').sockets.size >= (options.capacity ?? 4)) throw new Error('capacity-exceeded');
      socket.data.roomId = room.id; socket.data.role = role; socket.data.name = auth.name;
      next();
    } catch (error) { stats.rejected++; const failure = new Error(error instanceof Error && !('issues' in error) ? error.message : 'invalid-auth'); next(failure); }
  });
  io.on('connection', socket => {
    // Count every Engine.IO message payload, including ACKs, Presence and
    // snapshots. Excludes HTTP/WebSocket framing and any TLS overhead.
    socket.conn.on('packetCreate', packet => { if (packet.data) stats.outboundPayloadBytes += typeof packet.data === 'string' ? Buffer.byteLength(packet.data) : Buffer.byteLength(packet.data as Buffer); });
    const room = rooms.get(socket.data.roomId)!;
    const member: Member = { id: socket.id, name: socket.data.name, role: socket.data.role, ready: false, color: ['#1971c2', '#e03131', '#2f9e44', '#9c36b5'][room.members.size % 4] };
    socket.data.appliedSeq = room.seq;
    room.members.set(socket.id, member); socket.join(room.id); members(room);
    socket.emit('joined', { id: socket.id, role: member.role, seq: room.seq, initialized: room.initialized });
    function handler(name: string, action: (value: any) => unknown) {
      socket.on(name, (value, ack?: (reply: Reply<any>) => void) => {
        try { authorized(socket); rate(`socket:${socket.id}`, 80, 1000); const result = action(value); if (typeof ack === 'function') ack({ ok: true, value: result }); }
        catch (error) { stats.rejected++; if (typeof ack === 'function') ack({ ok: false, error: error instanceof Error && !('issues' in error) ? error.message : 'invalid-payload' }); }
      });
    }
    handler('sync-start', () => {
      for (const transfer of room.transfers.values()) if (transfer.target === socket.id) room.transfers.delete(transfer.id);
      member.ready = false; members(room);
      const seed = !room.initialized && member.role === 'manager';
      const donor = seed ? member : [...room.members.values()].find(item => item.id !== socket.id && item.ready && item.role !== 'viewer');
      if (!donor) throw new Error('no-snapshot-source');
      const transfer: Transfer = { id: randomUUID(), donor: donor.id, target: socket.id, base: room.seq, at: now(), seed, parts: [], received: 0 };
      room.transfers.set(transfer.id, transfer);
      socket.data.transferId = transfer.id;
      io.to(donor.id).emit('snapshot-request', { transferId: transfer.id, baseSeq: transfer.base });
      return { transferId: transfer.id, baseSeq: transfer.base };
    });
    handler('snapshot-meta', value => {
      authorized(socket, true); const meta = snapshotMetaSchema.parse(value); const transfer = room.transfers.get(meta.transferId);
      if (!transfer || transfer.donor !== socket.id || transfer.meta || meta.baseSeq < transfer.base || meta.baseSeq > room.seq || meta.chunks !== Math.ceil(meta.bytes / LIMITS.chunk)) throw new Error('invalid-transfer');
      transfer.meta = meta;
    });
    handler('snapshot-chunk', value => {
      authorized(socket, true); const transfer = room.transfers.get(value?.transferId);
      if (!transfer || transfer.donor !== socket.id || !transfer.meta || value.index !== transfer.parts.length || !Buffer.isBuffer(value.data) || value.data.length > LIMITS.chunk || !value.data.length) throw new Error('invalid-chunk');
      transfer.received += value.data.length;
      if (transfer.received > transfer.meta.bytes || transfer.parts.length >= transfer.meta.chunks) throw new Error('payload-too-large');
      transfer.parts.push(value.data);
      if (transfer.parts.length === transfer.meta.chunks) {
        const bytes = Buffer.concat(transfer.parts);
        if (bytes.length !== transfer.meta.bytes || hash(bytes) !== transfer.meta.digest) { failTransfer(room, transfer, 'snapshot-corrupt'); throw new Error('snapshot-corrupt'); }
        const elements = parseSnapshot(bytes.toString('utf8'));
        room.versions = catalog(room, elements);
        room.initialized = true;
        const target = io.sockets.sockets.get(transfer.target);
        if (!target) throw new Error('target-disconnected');
        target.data.snapshotSeq = transfer.meta.baseSeq;
        target.data.appliedSeq = transfer.meta.baseSeq;
        target.emit('snapshot-meta', transfer.meta);
        transfer.parts.forEach((data, index) => { target.emit('snapshot-chunk', { transferId: transfer.id, index, data }); stats.forwardedBytes += data.length; });
        room.transfers.delete(transfer.id);
      }
    });
    handler('sync-ready', value => {
      if (value?.transferId !== socket.data.transferId || !Number.isSafeInteger(value?.seq) || socket.data.snapshotSeq === undefined || !Number.isSafeInteger(socket.data.appliedSeq) || value.seq !== socket.data.appliedSeq || value.seq < socket.data.snapshotSeq || value.seq > room.seq) throw new Error('invalid-ready');
      if (socket.data.appliedSeq !== room.seq) return { ready: false, seq: room.seq };
      member.ready = true;
      // The snapshot plus buffered deltas also acknowledges earlier pending work.
      for (const [seq, pending] of room.pending) if (seq <= socket.data.appliedSeq) {
        pending.waiting.delete(socket.id);
        if (!pending.waiting.size) { io.to(pending.update.sender).emit('sync-ack', { id: pending.update.id, seq }); room.pending.delete(seq); }
      }
      members(room); return { ready: true, seq: room.seq };
    });
    handler('elements-update', value => {
      authorized(socket, true); if (!member.ready) throw new Error('not-ready');
      rate(`delta:${socket.id}`, 12, 1000);
      const delta = parseDelta(value); const key = `${socket.id}:${delta.id}`; const fingerprint = hash(canonical(delta)); const seen = room.seen.get(key);
      if (seen) { if (seen.hash !== fingerprint) throw new Error('conflicting-message'); if (!room.pending.has(seen.seq)) socket.emit('sync-ack', { id: delta.id, seq: seen.seq }); return { seq: seen.seq }; }
      const bytes = jsonBytes(delta);
      if (room.pending.size >= LIMITS.bufferCount || [...room.pending.values()].reduce((sum, item) => sum + item.bytes, bytes) > LIMITS.bufferBytes) throw new Error('resync-required');
      const next = catalog(room, delta.elements);
      const update: Update = { ...delta, seq: ++room.seq, sender: socket.id };
      room.versions = next;
      room.seen.set(key, { hash: fingerprint, seq: update.seq });
      if (room.seen.size > 256) room.seen.delete(room.seen.keys().next().value!);
      room.pending.set(update.seq, { update, waiting: new Set([...room.members.values()].filter(item => item.ready).map(item => item.id)), bytes, at: now() });
      io.to(room.id).emit('elements-update', update); stats.acceptedUpdates++; stats.forwardedBytes += bytes * room.members.size;
      return { seq: update.seq };
    });
    handler('applied', value => {
      if (!Number.isSafeInteger(value?.seq) || !Number.isSafeInteger(socket.data.appliedSeq) || value.seq > room.seq) throw new Error('invalid-ack');
      if (value.seq <= socket.data.appliedSeq) return;
      if (value.seq !== socket.data.appliedSeq + 1) throw new Error('invalid-ack');
      socket.data.appliedSeq = value.seq;
      const pending = room.pending.get(value.seq);
      pending?.waiting.delete(socket.id);
      if (pending && !pending.waiting.size) {
        io.to(pending.update.sender).emit('sync-ack', { id: pending.update.id, seq: value.seq }); room.pending.delete(value.seq);
      }
    });
    handler('presence', value => {
      if (!member.ready) throw new Error('not-ready'); rate(`presence:${socket.id}`, 5, 1000);
      const presence = { id: socket.id, ...presenceSchema.parse(value) };
      socket.to(room.id).emit('presence', presence); stats.forwardedBytes += jsonBytes(presence) * Math.max(0, room.members.size - 1);
    });
    socket.on('disconnect', () => {
      room.members.delete(socket.id); if (!room.members.size) room.emptyAt = now();
      for (const transfer of room.transfers.values()) if (transfer.target === socket.id || transfer.donor === socket.id) failTransfer(room, transfer, 'source-disconnected');
      for (const [seq, pending] of room.pending) {
        pending.waiting.delete(socket.id);
        if (!pending.waiting.size) { io.to(pending.update.sender).emit('sync-ack', { id: pending.update.id, seq }); room.pending.delete(seq); }
      }
      members(room);
    });
  });
  function sweep() {
    for (const room of rooms.values()) {
      if (now() >= room.expiresAt || (!room.members.size && now() - room.emptyAt >= (options.idleMs ?? LIMITS.idleMs))) { closeRoom(room); continue; }
      for (const transfer of room.transfers.values()) if (now() - transfer.at >= (options.snapshotMs ?? LIMITS.snapshotMs)) failTransfer(room, transfer, 'snapshot-timeout');
      for (const [seq, pending] of room.pending) if (now() - pending.at >= LIMITS.ackMs * 3) {
        for (const peer of pending.waiting) { const member = room.members.get(peer); if (member) member.ready = false; io.to(peer).emit('sync-error', { error: 'ack-timeout' }); }
        io.to(pending.update.sender).emit('sync-error', { error: 'ack-timeout' }); room.pending.delete(seq); members(room);
      }
    }
    for (const [key, value] of rates) if (now() - value.start > 60000) rates.delete(key);
  }
  const timer = setInterval(sweep, 1000); timer.unref();
  return { http, io, stats, sweep, listen: (port = 0, host = '127.0.0.1') => new Promise<number>(resolve => http.listen(port, host, () => resolve((http.address() as { port: number }).port))), close: () => new Promise<void>(resolve => { clearInterval(timer); io.close(() => resolve()); }) };
}
