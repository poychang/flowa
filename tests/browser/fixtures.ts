export const rectangle = (id: string, overrides = {}) => ({
  id, type: 'rectangle', x: 200, y: 200, width: 160, height: 100,
  version: 1, versionNonce: 10, isDeleted: false, index: 'a0',
  angle: 0, strokeColor: '#236b59', backgroundColor: '#b2f2bb', fillStyle: 'solid',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, seed: 1,
  groupIds: [], frameId: null, roundness: null, boundElements: null,
  updated: 1, link: null, locked: false, ...overrides,
});
export const scene = (elements = [rectangle('original')]) => JSON.stringify({
  type: 'excalidraw', version: 2, source: 'flowa-test', elements,
  appState: { viewBackgroundColor: '#ffffff' }, files: {},
});
