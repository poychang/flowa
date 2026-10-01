import { rectangle } from '../browser/fixtures';

export const workload = process.env.PERF_WORKLOAD ?? 'rectangles';
if (!['rectangles', 'mixed'].includes(workload)) throw new Error('PERF_WORKLOAD must be rectangles or mixed');

// Keep the historical rectangle layout unchanged for comparisons.
export function elements(count: number) {
  return Array.from({ length: count - 1 }, (_, i) => {
    const base = rectangle(`perf-${i}`, {
      index: `a${i.toString(36).padStart(4, '0')}1`, x: 100 + i % 40 * 20, y: 60 + Math.floor(i / 40) * 12,
      width: 16, height: 8, roughness: 1,
    });
    if (workload === 'rectangles') return base;
    switch (i % 5) {
      case 1: return { ...base, type: 'text', text: `節點 ${i}`, originalText: `節點 ${i}`,
        fontSize: 10, fontFamily: 1, textAlign: 'left', verticalAlign: 'top',
        containerId: null, autoResize: true, lineHeight: 1.25, backgroundColor: 'transparent' };
      case 2: return { ...base, type: 'arrow', points: [[0, 0], [16, 8]],
        startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow', elbowed: false };
      case 3: return { ...base, type: 'ellipse' };
      case 4: return { ...base, type: 'image', fileId: 'perf-image', status: 'saved', scale: [1, 1], crop: null };
      default: return base;
    }
  });
}
