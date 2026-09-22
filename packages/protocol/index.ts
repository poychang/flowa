import { z } from 'zod';

export const VERSION = 2;
export const LIMITS = {
  packet: 256 * 1024, chunk: 192 * 1024, scene: 10 * 1024 * 1024,
  elements: 2000, chunks: 64, bufferCount: 64, bufferBytes: 1024 * 1024,
  snapshotMs: 15000, ackMs: 5000, roomMs: 8 * 60 * 60 * 1000, idleMs: 10 * 60 * 1000,
} as const;
export const id = z.string().min(1).max(128).regex(/^[\w-]+$/);
const number = z.number().finite();
const point = z.tuple([number, number]);
const binding = z.object({ elementId: id, focus: number.optional(), gap: number.optional() }).passthrough().nullable();
export const elementSchema = z.object({
  id, type: z.enum(['rectangle', 'diamond', 'ellipse', 'text', 'arrow', 'line', 'freedraw', 'frame']),
  x: number, y: number, width: number.nonnegative(), height: number.nonnegative(),
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  versionNonce: z.number().int().min(0).max(0xffffffff), isDeleted: z.boolean(),
  index: z.string().min(2).max(128).regex(/^[A-Za-z][A-Za-z0-9]+$/),
  angle: number, strokeColor: z.string().max(128), backgroundColor: z.string().max(128),
  fillStyle: z.enum(['hachure', 'cross-hatch', 'solid', 'zigzag']),
  strokeWidth: number.nonnegative(), strokeStyle: z.enum(['solid', 'dashed', 'dotted']),
  roughness: number.nonnegative(), opacity: number.min(0).max(100), seed: number,
  groupIds: z.array(id).max(100), frameId: id.nullable(),
  boundElements: z.array(z.object({ id, type: z.enum(['text', 'arrow']) })).max(2000).nullable(),
  updated: number, link: z.string().max(4096).nullable(), locked: z.boolean(),
  text: z.string().max(100000).optional(), originalText: z.string().max(100000).optional(),
  points: z.array(point).max(10000).optional(), pressures: z.array(number).max(10000).optional(),
  startBinding: binding.optional(), endBinding: binding.optional(),
}).passthrough().superRefine((value, ctx) => {
  if (value.type === 'text' && (typeof value.text !== 'string' || !Number.isFinite(value.fontSize) || !Number.isFinite(value.fontFamily))) ctx.addIssue({ code: 'custom', message: 'invalid-text' });
  if (['arrow', 'line', 'freedraw'].includes(value.type) && !value.points?.length) ctx.addIssue({ code: 'custom', message: 'invalid-points' });
});
export type Element = z.infer<typeof elementSchema>;
export const elementsSchema = z.array(elementSchema).max(LIMITS.elements).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: 'duplicate-id' });
});
export const deltaSchema = z.object({ protocol: z.literal(VERSION), id, elements: elementsSchema }).strict();
export type Delta = z.infer<typeof deltaSchema>;
export type Update = Delta & { sender: string; seq: number };
export type Role = 'manager' | 'editor' | 'viewer';
export const presenceSchema = z.object({ x: number, y: number }).strict();
export const joinSchema = z.object({ protocol: z.literal(VERSION), roomId: id, token: z.string().min(40).max(128), name: z.string().trim().min(1).max(40) }).strict();
export interface Member { id: string; name: string; color: string; role: Role; ready: boolean; }
export interface RoomCredentials { roomId: string; manager: string; editor: string; viewer: string; expiresAt: number; }
export interface Reply<T = undefined> { ok: boolean; value?: T; error?: string; }
export interface SnapshotMeta { transferId: string; baseSeq: number; bytes: number; chunks: number; digest: string; }
export const snapshotMetaSchema = z.object({ transferId: id, baseSeq: z.number().int().nonnegative(), bytes: z.number().int().min(2).max(LIMITS.scene), chunks: z.number().int().min(1).max(LIMITS.chunks), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export function jsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
export function parseDelta(value: unknown): Delta {
  if (jsonBytes(value) > LIMITS.packet) throw new Error('payload-too-large');
  if ((value as any)?.protocol !== VERSION) throw new Error('protocol-mismatch');
  return deltaSchema.parse(value);
}
export function parseSnapshot(text: string): Element[] {
  if (new TextEncoder().encode(text).byteLength > LIMITS.scene) throw new Error('scene-too-large');
  return elementsSchema.parse(JSON.parse(text));
}
export function canonical(value: unknown) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
