import { MAX_SCENE_BYTES } from './storage.ts';

export const MAX_ELEMENTS = 2000;
const TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'text', 'arrow', 'line', 'freedraw', 'image', 'frame', 'magicframe', 'embeddable', 'iframe']);
export function parseDocument(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_SCENE_BYTES) throw new Error('檔案超過 10 MB 上限。');
  const raw = JSON.parse(text);
  if (!raw || raw.type !== 'excalidraw' || raw.version !== 2 || !Array.isArray(raw.elements) || raw.elements.length > MAX_ELEMENTS) {
    throw new Error('請選擇有效的 Excalidraw JSON（版本 2，最多 2,000 個物件）。');
  }
  const ids = new Set<string>();
  for (const element of raw.elements) {
    if (!element || typeof element.id !== 'string' || !element.id || element.id.length > 256 || ids.has(element.id) || !TYPES.has(element.type)) throw new Error('畫布包含無效或重複的物件。');
    ids.add(element.id);
    for (const key of ['x', 'y', 'width', 'height', 'version', 'versionNonce']) {
      if (!Number.isFinite(element[key])) throw new Error('畫布物件的座標或版本無效。');
    }
    if (!Number.isSafeInteger(element.version) || element.version < 1 || !Number.isSafeInteger(element.versionNonce) || typeof element.isDeleted !== 'boolean') throw new Error('畫布物件版本無效。');
    if (element.type === 'text' && typeof element.text !== 'string') throw new Error('文字物件無效。');
  }
  return raw;
}
