import { io, type Socket } from 'socket.io-client';
import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { VERSION, LIMITS, canonical, jsonBytes, parseDelta, parseSnapshot, snapshotMetaSchema } from '../../../../packages/protocol/index';
import type { Delta, Update, SnapshotMeta, Reply, Role, Member } from '../../../../packages/protocol/index';
import { mergeElements } from './merge';

export type SyncState = 'connecting' | 'waiting' | 'syncing' | 'synced' | 'offline' | 'expired' | 'error';
export interface RoomLink { roomId: string; token: string; }
export interface SessionHooks {
  beforeSync: () => Promise<void>;
  status: (state: SyncState, error?: string) => void;
  joined: (role: Role, id: string) => void;
  editable: (ready: boolean) => void;
  members: (members: Member[]) => void;
  presence: (id: string, point: { x: number; y: number }) => void;
}
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class CollaborationSession {
  private socket: Socket;
  private role: Role = 'viewer';
  private state: SyncState = 'connecting';
  private known = new Map<string, string>();
  private incoming: Update[] = [];
  private incomingBytes = 0;
  private inflight?: { packet: Delta; at: number; retries: number };
  private snapshot?: { meta: SnapshotMeta; parts: Uint8Array[]; bytes: number };
  private transferId = '';
  private appliedSeq = 0;
  private ready = false;
  private dirty = true;
  private disposed = false;
  private generation = 0;
  private attempts = 0;
  private bootstrap = false;
  private ticking = false;
  private outgoing = false;
  private lastPointer = 0;
  private timer: ReturnType<typeof setInterval>;
  constructor(private api: ExcalidrawImperativeAPI, url: string, link: RoomLink, name: string, private hooks: SessionHooks) {
    this.socket = io(url, { transports: ['websocket'], auth: { protocol: VERSION, ...link, name }, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 5000, autoConnect: false });
    this.socket.on('joined', value => {
      this.role = value.role; hooks.joined(this.role, value.id); this.bootstrap = !value.initialized && this.role === 'manager';
      this.appliedSeq = value.seq; this.attempts = 0; void this.begin();
    });
    this.socket.on('connect_error', error => {
      if (['room-expired', 'unauthorized', 'invalid-auth'].includes(error.message)) { this.set(error.message === 'room-expired' ? 'expired' : 'error', error.message); this.socket.disconnect(); }
      else this.set('offline', error.message);
    });
    this.socket.on('disconnect', () => { this.ready = false; this.generation++; this.snapshot = undefined; this.inflight = undefined; if (!['expired', 'error'].includes(this.state)) this.set('offline'); });
    this.socket.on('room-closed', () => { this.ready = false; this.set('expired', 'room-expired'); });
    this.socket.on('members', hooks.members);
    this.socket.on('presence', value => hooks.presence(value.id, value));
    this.socket.on('sync-error', value => { void this.recover(value.error); });
    this.socket.on('snapshot-request', value => { void this.provideSnapshot(value).catch(error => {
      // A joining guest may disappear mid-transfer; do not disable its donor.
      if (!['invalid-transfer', 'invalid-chunk', 'target-disconnected', 'snapshot-timeout'].includes(error?.message)) this.fail(error);
    }); });
    this.socket.on('snapshot-meta', value => {
      try { const meta = snapshotMetaSchema.parse(value); if (meta.transferId !== this.transferId) return; this.snapshot = { meta, parts: [], bytes: 0 }; }
      catch (error) { this.fail(error); }
    });
    this.socket.on('snapshot-chunk', value => { void this.receiveChunk(value).catch(error => this.recover(error instanceof Error ? error.message : 'invalid-snapshot')); });
    this.socket.on('elements-update', (packet: Update) => {
      try {
        parseDelta({ protocol: packet.protocol, id: packet.id, elements: packet.elements });
        if (!Number.isSafeInteger(packet.seq) || packet.seq < 1 || typeof packet.sender !== 'string') throw new Error('invalid-update');
        const bytes = jsonBytes(packet);
        if (this.incoming.length >= LIMITS.bufferCount || this.incomingBytes + bytes > LIMITS.bufferBytes) throw new Error('resync-required');
        this.incoming.push(packet); this.incomingBytes += bytes;
      } catch (error) { void this.recover(error instanceof Error ? error.message : 'invalid-update'); }
    });
    this.socket.on('sync-ack', ({ id }) => {
      const flight = this.inflight;
      if (!flight || flight.packet.id !== id) return;
      for (const element of flight.packet.elements) this.known.set(element.id, canonical(element));
      this.inflight = undefined; this.dirty = true;
    });
    this.timer = setInterval(() => { void this.tick(); }, 150);
    this.socket.connect(); hooks.status('connecting');
  }
  private set(state: SyncState, error?: string) { if (this.disposed) return; this.state = state; this.hooks.editable(this.ready); this.hooks.status(state, error); }
  private rpc<T = any>(event: string, value: unknown): Promise<T> {
    if (!this.socket.connected) return Promise.reject(new Error('disconnected'));
    return new Promise((resolve, reject) => this.socket.timeout(LIMITS.ackMs).emit(event, value, (error: Error | null, reply: Reply<T>) => error ? reject(error) : !reply?.ok ? reject(new Error(reply?.error ?? 'invalid-ack')) : resolve(reply.value as T)));
  }
  private busy() {
    const state = this.api.getAppState(); return Boolean(state.editingTextElement || state.resizingElement || state.newElement || state.selectedElementsAreBeingDragged);
  }
  private async begin() {
    const generation = ++this.generation;
    this.ready = false; this.known.clear(); this.incoming = []; this.incomingBytes = 0; this.inflight = undefined; this.snapshot = undefined; this.set('connecting');
    try {
      await this.hooks.beforeSync();
      if (this.disposed || generation !== this.generation || !this.socket.connected) return;
      this.set('waiting');
      const result = await this.rpc('sync-start', {});
      this.transferId = result.transferId;
      setTimeout(() => { if (!this.disposed && generation === this.generation && !this.ready) void this.recover('snapshot-timeout'); }, LIMITS.snapshotMs + 500);
    } catch (error) { this.fail(error); }
  }
  private fail(error: unknown) {
    this.ready = false; this.generation++;
    const message = error instanceof Error ? error.message : 'sync-failed';
    this.set(message === 'room-expired' ? 'expired' : 'error', message);
  }
  private async recover(error: string) {
    if (this.disposed || !this.socket.connected || this.state === 'expired' || this.state === 'error') return;
    if (['conflicting-revision', 'scene-too-large', 'invalid-payload'].includes(error) || ++this.attempts > 2) { this.fail(new Error(error)); return; }
    await this.begin();
  }
  private async provideSnapshot(request: { transferId: string; baseSeq: number }) {
    const generation = this.generation; const started = Date.now();
    while (this.busy() || this.incoming.length || this.appliedSeq < request.baseSeq || (this.ready && (this.dirty || this.inflight))) {
      if (this.disposed || generation !== this.generation || Date.now() - started > LIMITS.snapshotMs) throw new Error('snapshot-timeout');
      // Publish local edits before donating: otherwise a donor disappearing
      // after the snapshot could leave existing peers unaware of those edits.
      if (this.ready) await this.tick();
      await sleep(30);
    }
    if ((!this.ready && !this.bootstrap) || this.role === 'viewer') throw new Error('not-ready');
    const text = JSON.stringify(this.api.getSceneElementsIncludingDeleted()); parseSnapshot(text);
    const bytes = new TextEncoder().encode(text);
    const meta: SnapshotMeta = { transferId: request.transferId, baseSeq: this.appliedSeq, bytes: bytes.length, chunks: Math.ceil(bytes.length / LIMITS.chunk), digest: await digest(bytes) };
    await this.rpc('snapshot-meta', meta);
    for (let index = 0; index < meta.chunks; index++) await this.rpc('snapshot-chunk', { transferId: meta.transferId, index, data: bytes.slice(index * LIMITS.chunk, (index + 1) * LIMITS.chunk) });
  }
  private async receiveChunk(value: { transferId: string; index: number; data: ArrayBuffer }) {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.meta.transferId !== value.transferId) return;
    const bytes = new Uint8Array(value.data);
    if (value.index !== snapshot.parts.length || bytes.length > LIMITS.chunk || !bytes.length) throw new Error('invalid-chunk');
    snapshot.bytes += bytes.length;
    if (snapshot.bytes > snapshot.meta.bytes || snapshot.parts.length >= snapshot.meta.chunks) throw new Error('payload-too-large');
    snapshot.parts.push(bytes);
    if (snapshot.parts.length !== snapshot.meta.chunks) return;
    const generation = this.generation;
    const all = new Uint8Array(snapshot.bytes); let offset = 0; for (const part of snapshot.parts) { all.set(part, offset); offset += part.length; }
    if (all.length !== snapshot.meta.bytes || await digest(all) !== snapshot.meta.digest) throw new Error('snapshot-corrupt');
    if (generation !== this.generation || this.disposed) return;
    const remote = parseSnapshot(new TextDecoder().decode(all)) as unknown as OrderedExcalidrawElement[];
    this.set('syncing');
    const elements = this.role === 'viewer' ? remote : mergeElements(this.api.getSceneElementsIncludingDeleted(), remote, this.api.getAppState());
    this.known = new Map(remote.map(element => [element.id, canonical(element)]));
    this.api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    this.appliedSeq = snapshot.meta.baseSeq; this.snapshot = undefined;
    const started = Date.now();
    while (generation === this.generation && !this.disposed) {
      await this.consume();
      const result = await this.rpc('sync-ready', { transferId: this.transferId, seq: this.appliedSeq });
      if (result.ready) { this.ready = true; this.bootstrap = false; this.dirty = this.role !== 'viewer'; this.set('syncing'); return; }
      if (Date.now() - started > LIMITS.snapshotMs) throw new Error('snapshot-timeout');
      await sleep(30);
    }
  }
  private async consume() {
    if (this.busy()) return;
    while (this.incoming.length) {
      const packet = this.incoming[0];
      if (packet.seq > this.appliedSeq + 1) throw new Error('sequence-gap');
      if (packet.seq > this.appliedSeq) {
        if (packet.sender !== this.socket.id) {
          const remote = packet.elements as unknown as OrderedExcalidrawElement[];
          const elements = mergeElements(this.api.getSceneElementsIncludingDeleted(), remote, this.api.getAppState());
          const byId = new Map(remote.map(element => [element.id, canonical(element)]));
          for (const element of elements) if (byId.get(element.id) === canonical(element)) this.known.set(element.id, canonical(element));
          this.api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
          this.dirty = this.role !== 'viewer';
        }
        this.appliedSeq = packet.seq;
      }
      this.incoming.shift(); this.incomingBytes -= jsonBytes(packet);
      await this.rpc('applied', { seq: packet.seq });
    }
  }
  changed() { this.dirty = true; }
  pointer(point: { x: number; y: number }) {
    if (!this.ready || Date.now() - this.lastPointer < 220) return;
    this.lastPointer = Date.now(); void this.rpc('presence', point).catch(() => undefined);
  }
  private async tick() {
    if (!this.ready || this.ticking || this.disposed || !this.socket.connected) return;
    this.ticking = true;
    try {
      await this.consume();
      if (this.role !== 'viewer' && !this.busy()) {
        if (this.inflight && Date.now() - this.inflight.at > LIMITS.ackMs && !this.outgoing) {
          if (++this.inflight.retries > 3) throw new Error('ack-timeout');
          this.inflight.at = Date.now(); await this.send(this.inflight.packet);
        } else if (!this.inflight && this.dirty) {
          const changed = this.api.getSceneElementsIncludingDeleted().filter(element => this.known.get(element.id) !== canonical(element));
          const elements = []; let bytes = 1024;
          for (const element of changed) { const size = jsonBytes(element) + 1; if (size > LIMITS.packet - 1024) throw new Error('payload-too-large'); if (bytes + size > LIMITS.packet) break; elements.push(element); bytes += size; }
          if (elements.length) {
            const packet = parseDelta({ protocol: VERSION, id: crypto.randomUUID(), elements });
            this.inflight = { packet, at: Date.now(), retries: 0 }; this.set('syncing'); await this.send(packet);
          } else { this.dirty = false; this.set('synced'); }
        }
      } else if (!this.incoming.length && !this.inflight) this.set('synced');
    } catch (error) { await this.recover(error instanceof Error ? error.message : 'sync-failed'); }
    finally { this.ticking = false; }
  }
  private async send(packet: Delta) { this.outgoing = true; try { await this.rpc('elements-update', packet); } finally { this.outgoing = false; } }
  retry() { this.attempts = 0; if (!this.socket.connected) this.socket.connect(); else void this.begin(); }
  close() { this.disposed = true; this.generation++; clearInterval(this.timer); this.socket.removeAllListeners(); this.socket.disconnect(); }
}
