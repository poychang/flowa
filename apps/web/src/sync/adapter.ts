import { CaptureUpdateAction, reconcileElements } from '@excalidraw/excalidraw';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { parseDocument } from '../document';

export const PROTOCOL_VERSION = 1;
export const MAX_PACKET_BYTES = 256 * 1024;
export interface ElementPacket {
  protocol: 1;
  session: string;
  sender: string;
  id: string;
  elements: OrderedExcalidrawElement[];
}
const fingerprint = (element: OrderedExcalidrawElement) => JSON.stringify(element, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
const wins = (a: OrderedExcalidrawElement, b: OrderedExcalidrawElement) =>
  a.version > b.version || (a.version === b.version && a.versionNonce <= b.versionNonce);

/** Phase 0 only: no transport, authentication, files or room lifecycle. */
export class ElementSyncAdapter {
  private known = new Map<string, OrderedExcalidrawElement>();
  private pending = new Map<string, ElementPacket>();
  private seen = new Set<string>();
  private deferred: ElementPacket[] = [];
  constructor(private api: ExcalidrawImperativeAPI, private session: string, private sender: string) {}

  private validate(value: unknown): ElementPacket {
    const text = JSON.stringify(value);
    if (!text || new TextEncoder().encode(text).byteLength > MAX_PACKET_BYTES) throw new Error('payload-too-large');
    const packet = JSON.parse(text) as ElementPacket;
    if (!packet || packet.protocol !== PROTOCOL_VERSION) throw new Error('protocol-mismatch');
    if (packet.session !== this.session) throw new Error('wrong-session');
    if (typeof packet.sender !== 'string' || !packet.sender || packet.sender.length > 128 || typeof packet.id !== 'string' || !packet.id || packet.id.length > 128) throw new Error('invalid-envelope');
    parseDocument(JSON.stringify({ type: 'excalidraw', version: 2, elements: packet.elements }));
    for (const element of packet.elements) {
      // Only text and vector shapes are covered by this PoC.
      if (['image', 'embeddable', 'iframe', 'magicframe'].includes(element.type)) throw new Error('unsupported-element');
      if (typeof element.index !== 'string' || !/^[A-Za-z][A-Za-z0-9]+$/.test(element.index) || element.index.length > 128) throw new Error('invalid-index');
    }
    return packet;
  }
  createDelta(): ElementPacket | undefined {
    const elements = this.api.getSceneElementsIncludingDeleted().filter(element => {
      const previous = this.known.get(element.id);
      return !previous || fingerprint(previous) !== fingerprint(element);
    });
    if (!elements.length) return undefined;
    const packet = this.validate({ protocol: 1, session: this.session, sender: this.sender, id: crypto.randomUUID(), elements });
    const content = JSON.stringify(packet.elements);
    for (const pending of this.pending.values()) if (JSON.stringify(pending.elements) === content) return structuredClone(pending);
    if (this.pending.size >= 16) throw new Error('awaiting-ack');
    this.pending.set(packet.id, packet);
    return structuredClone(packet);
  }
  acknowledge(id: string) {
    const packet = this.pending.get(id);
    if (!packet) return;
    for (const element of packet.elements) {
      const current = this.known.get(element.id);
      if (!current || wins(element, current)) this.known.set(element.id, element);
    }
    this.pending.delete(id);
  }
  private busy() {
    const state = this.api.getAppState();
    return Boolean(state.editingTextElement || state.resizingElement || state.newElement || state.selectedElementsAreBeingDragged);
  }
  receive(value: unknown): 'applied' | 'duplicate' | 'deferred' {
    const packet = this.validate(value);
    const key = `${packet.sender}:${packet.id}`;
    if (packet.sender === this.sender || this.seen.has(key)) return 'duplicate';
    if (this.busy()) {
      if (!this.deferred.some(item => item.sender === packet.sender && item.id === packet.id)) {
        if (this.deferred.length >= 4) throw new Error('resync-required');
        this.deferred.push(packet);
      }
      return 'deferred';
    }
    const local = structuredClone([...this.api.getSceneElementsIncludingDeleted()]);
    const localById = new Map(local.map(element => [element.id, element]));
    for (const remote of packet.elements) {
      const existing = localById.get(remote.id);
      if (existing && existing.version === remote.version && existing.versionNonce === remote.versionNonce && fingerprint(existing) !== fingerprint(remote)) {
        throw new Error('conflicting-revision');
      }
    }
    // Reconciliation repairs colliding indices in place and bumps versions.
    // Keep the original packet intact so repairs remain outgoing local deltas.
    const elements = reconcileElements(local, structuredClone(packet.elements) as RemoteExcalidrawElement[], this.api.getAppState());
    if (elements.length > 2000) throw new Error('scene-too-large');
    const incoming = new Map(packet.elements.map(element => [element.id, element]));
    for (const element of elements) {
      const remote = incoming.get(element.id);
      // Do not mark unsent local changes as delivered when a remote packet arrives.
      if (remote && fingerprint(element) === fingerprint(remote)) this.known.set(element.id, structuredClone(element));
    }
    this.api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    this.seen.add(key);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    return 'applied';
  }
  flushDeferred() {
    if (this.busy()) return;
    while (this.deferred.length) {
      this.receive(this.deferred[0]);
      this.deferred.shift();
    }
  }
}
