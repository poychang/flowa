import { serializeAsJSON, loadFromBlob, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import { parseDocument } from './document';

/** Keep tombstones: Excalidraw's export serializer normally removes them. */
export function serializeScene(elements: readonly ExcalidrawElement[], appState: Partial<AppState>, files: BinaryFiles) {
  const document = JSON.parse(serializeAsJSON(elements, appState, files, 'local'));
  document.elements = elements;
  return JSON.stringify(document);
}

export async function deserializeScene(text: string) {
  const raw = parseDocument(text);
  const restored = await loadFromBlob(new Blob([JSON.stringify(raw)], { type: 'application/json' }), null, null);
  // loadFromBlob also strips deleted elements. Restore the validated full list.
  restored.elements = restoreElements(raw.elements, null, { repairBindings: true });
  return restored;
}
