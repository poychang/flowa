import { createRoot } from 'react-dom/client';
import { Excalidraw, CaptureUpdateAction, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { ElementSyncAdapter } from '../../apps/web/src/sync/adapter';
import { serializeScene } from '../../apps/web/src/scene';
import '@excalidraw/excalidraw/index.css';

// Test-only entry point: Vite production builds include only the root index.html.
const peer = new URLSearchParams(location.search).get('peer') ?? 'A';
function ready(api: ExcalidrawImperativeAPI) {
  const sync = new ElementSyncAdapter(api, 'poc-session', peer);
  Object.assign(window, { harness: {
    scene: () => structuredClone(api.getSceneElementsIncludingDeleted()),
    replace: (elements: OrderedExcalidrawElement[]) => api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY }),
    receive: (packet: unknown) => sync.receive(packet),
    delta: () => sync.createDelta(),
    ack: (id: string) => sync.acknowledge(id),
    busy: (value: boolean) => api.updateScene({ appState: { selectedElementsAreBeingDragged: value }, captureUpdate: CaptureUpdateAction.NEVER }),
    flush: () => sync.flushDeferred(),
    backup: () => serializeScene(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles()),
    makeFlow: () => convertToExcalidrawElements([
      { id: 'node-a', type: 'rectangle', x: 100, y: 200, width: 120, height: 80, label: { text: '開始' } },
      { id: 'node-b', type: 'rectangle', x: 400, y: 200, width: 120, height: 80, label: { text: '完成' } },
      { type: 'arrow', x: 220, y: 240, width: 180, height: 0, start: { id: 'node-a' }, end: { id: 'node-b' } },
    ], { regenerateIds: false }),
  } });
}
createRoot(document.getElementById('root')!).render(<div style={{ height: '95vh' }}><Excalidraw excalidrawAPI={ready} langCode="zh-TW"/></div>);
