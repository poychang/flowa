import { reconcileElements } from '@excalidraw/excalidraw';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { AppState } from '@excalidraw/excalidraw/types';
import { canonical, LIMITS } from '../../../../packages/protocol/index';
export function mergeElements(local: readonly OrderedExcalidrawElement[], remote: readonly OrderedExcalidrawElement[], state: AppState) {
  const byId = new Map(local.map(element => [element.id, element]));
  for (const element of remote) {
    const previous = byId.get(element.id);
    if (previous && previous.version === element.version && previous.versionNonce === element.versionNonce && canonical(previous) !== canonical(element)) throw new Error('conflicting-revision');
  }
  const merged = reconcileElements(structuredClone([...local]), structuredClone([...remote]) as RemoteExcalidrawElement[], state);
  if (merged.length > LIMITS.elements) throw new Error('scene-too-large');
  return merged;
}
