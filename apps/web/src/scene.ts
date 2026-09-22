import { serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';

/** Keep tombstones: Excalidraw's export serializer normally removes them. */
export function serializeScene(elements: readonly ExcalidrawElement[], appState: Partial<AppState>, files: BinaryFiles) {
  const document = JSON.parse(serializeAsJSON(elements, appState, files, 'local'));
  document.elements = elements;
  return JSON.stringify(document);
}
