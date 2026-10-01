import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, platform, release } from 'node:os';
import { join, relative } from 'node:path';
import { artifactDirectory } from './artifact';
import { scene } from '../browser/fixtures';
import { elements, workload } from './workload';
import { drawRectangle } from '../browser/draw';
import { canonical } from '../../packages/protocol';

const seconds = Number(process.env.PERF_SECONDS ?? 300);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, ...args], { encoding: 'utf8' }).trim();
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? null, p95: sorted[Math.floor(sorted.length * .95)] ?? null, max: sorted.at(-1) ?? null };
};
async function buildHash(root = artifactDirectory): Promise<string> {
  const entries: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else entries.push(`dist/${relative(root, path).replaceAll('\\', '/')}:${sha(await readFile(path))}`);
    }
  }
  await visit(root); return sha(entries.sort().join('\n'));
}
async function draft(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('flowa'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      return await new Promise<any>((resolve, reject) => { const r = db.transaction('boards').objectStore('boards').get('draft'); r.onsuccess = () => resolve(JSON.parse(r.result?.scene ?? '{"elements":[]}')); r.onerror = () => reject(r.error); });
    } finally { db.close(); }
  });
}
async function frames(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function pan(page: Page, direction: number) {
  await page.keyboard.down('Space'); await page.mouse.move(650, 500); await page.mouse.down();
  for (let step = 1; step <= 8; step++) { await frames(page); await page.mouse.move(650 + direction * step * 10, 500 + direction * step * 5); }
  await page.mouse.up(); await page.keyboard.up('Space'); await frames(page);
}
declare global {
  interface Window { flowaMeasurement?: { canvasCreations: () => number; stop: () => { intervals: number[]; longTasks: number[]; longTasksSupported: boolean; canvasCreations: number } }; }
}

for (const count of [500, 2000]) test(`${count} objects preserve data during sustained canvas interaction`, async ({ page, context, browser }, info) => {
  const started = new Date().toISOString();
  const sourceCommit = git('rev-parse', 'HEAD');
  const dirtyPaths = git('status', '--porcelain', '--', 'apps', 'packages', 'patches', 'tests/performance', 'tests/browser/draw.ts', 'tests/browser/fixtures.ts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.config.ts', 'playwright.performance.config.ts');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('crash', () => errors.push('page-crashed'));
  const artifactHash = await buildHash();
  await page.goto('/'); await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
  // Reserve one object for a real pointer-drawn rectangle, never exceed 2,000.
  const initial = elements(count);
  const files = workload === 'mixed' ? await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e03131'; ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#1971c2'; ctx.fillRect(0, 0, 16, 16); ctx.fillRect(16, 16, 16, 16);
    return { 'perf-image': { id: 'perf-image', mimeType: 'image/png', dataURL: canvas.toDataURL(), created: 1 } };
  }) : {};
  const importedDocument = { ...JSON.parse(scene()), elements: initial, files };
  const importAt = performance.now();
  await page.locator('input[type=file]').setInputFiles({ name: 'performance.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(importedDocument)) });
  await expect.poll(async () => (await draft(page)).elements.length).toBe(count - 1);
  await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
  const importAndSaveMilliseconds = performance.now() - importAt;
  const sourceElements = (await draft(page)).elements;
  // Compare against the input too: a lossy import must not become the new golden data.
  for (const input of initial) {
    const restored = sourceElements.find((element: any) => element.id === input.id);
    expect(restored.type).toBe(input.type);
    if ('text' in input) expect(restored.text).toBe(input.text);
    if ('points' in input) expect(restored.points).toEqual(input.points);
    if ('fileId' in input) expect(restored.fileId).toBe(input.fileId);
  }
  const fileContent = (value: any) => Object.fromEntries(Object.entries(value ?? {}).map(([id, file]: [string, any]) => [id, { id: file.id, mimeType: file.mimeType, dataURL: file.dataURL }]));
  expect(fileContent((await draft(page)).files)).toEqual(fileContent(files));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000); // Fixed warm-up, outside the sustained sample.
  const drawingAt = performance.now(); await drawRectangle(page, 1050, 450, 120, 90);
  const drawingCommandMilliseconds = performance.now() - drawingAt;
  const saveAt = performance.now();
  await expect.poll(async () => (await draft(page)).elements.find((element: any) => !element.id.startsWith('perf-'))?.width ?? 0).toBeGreaterThan(100);
  const drawingSaveMilliseconds = performance.now() - saveAt;
  const before = (await draft(page)).elements;
  expect(before).toHaveLength(count);
  const drawn = before.find((element: any) => !element.id.startsWith('perf-'));
  await page.keyboard.press('v');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await draft(page)).elements.find((element: any) => element.id === drawn.id)?.x).toBeGreaterThan(drawn.x);

  // Verify pan and zoom change the canvas before measuring repeated operations.
  const pixels = () => page.locator('canvas.excalidraw__canvas.static').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const originalPixels = await pixels(); await pan(page, 1);
  expect(await pixels()).not.toBe(originalPixels); await pan(page, -1);
  const zoom = page.locator('.reset-zoom-button'); const originalZoom = await zoom.innerText();
  await page.keyboard.press('Control+='); await expect(zoom).not.toHaveText(originalZoom);
  await page.keyboard.press('Control+-'); await expect(zoom).toHaveText(originalZoom);
  const startingVersion = (await draft(page)).elements.find((element: any) => element.id === drawn.id).version;

  const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
  // Profiling is opt-in: keep sampled runs separate from timing baselines.
  const profiling = process.env.PERF_PROFILE === '1';
  if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  async function heap() { const value = await cdp.send('Performance.getMetrics'); return value.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null; }
  const memory: { seconds: number; usedJSHeapBytes: number | null }[] = [{ seconds: 0, usedJSHeapBytes: await heap() }];
  await page.evaluate(() => {
    let canvasCreations = 0;
    const createElement = document.createElement;
    document.createElement = ((name: string, options?: ElementCreationOptions) => {
      if (name.toLowerCase() === 'canvas') canvasCreations++;
      return createElement.call(document, name, options);
    }) as typeof document.createElement;
    const intervals: number[] = [], longTasks: number[] = []; let last = performance.now(), id = 0;
    const tick = (now: number) => { intervals.push(now - last); last = now; id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick);
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supported ? new PerformanceObserver(list => { longTasks.push(...list.getEntries().map(entry => entry.duration)); }) : undefined;
    observer?.observe({ type: 'longtask' });
    window.flowaMeasurement = { canvasCreations: () => canvasCreations, stop: () => { document.createElement = createElement; cancelAnimationFrame(id); if (observer) { longTasks.push(...observer.takeRecords().map(entry => entry.duration)); observer.disconnect(); } return { intervals, longTasks, longTasksSupported: supported, canvasCreations }; } };
  });
  const panTimes: number[] = [], zoomTimes: number[] = []; let cycles = 0, sampleAt = 30, progressAt = 60;
  const stoppedZoomSamples: { afterCycle: number; milliseconds: number; canvasCreations: number }[] = [];
  async function stoppedZoom() {
    const before = await page.evaluate(() => window.flowaMeasurement!.canvasCreations());
    const at = performance.now();
    await page.keyboard.press('Control+='); await page.waitForTimeout(400); await frames(page);
    await page.keyboard.press('Control+-'); await page.waitForTimeout(400); await frames(page);
    stoppedZoomSamples.push({ afterCycle: cycles, milliseconds: performance.now() - at,
      canvasCreations: await page.evaluate(() => window.flowaMeasurement!.canvasCreations()) - before });
  }
  const workloadAt = performance.now();
  while (performance.now() - workloadAt < seconds * 1000) {
    let at = performance.now(); await pan(page, 1); await pan(page, -1); panTimes.push(performance.now() - at);
    at = performance.now(); await page.keyboard.press('Control+='); await frames(page); await page.keyboard.press('Control+-'); await frames(page); zoomTimes.push(performance.now() - at);
    await page.keyboard.press(cycles % 2 ? 'ArrowLeft' : 'ArrowRight'); cycles++;
    // Mixed runs exercise the delayed rebuild repeatedly, including short CI runs.
    if (workload === 'mixed' && (cycles === 1 || cycles % 5 === 0)) await stoppedZoom();
    const elapsed = (performance.now() - workloadAt) / 1000;
    if (elapsed >= sampleAt) { memory.push({ seconds: elapsed, usedJSHeapBytes: await heap() }); sampleAt += 30; }
    if (elapsed >= progressAt) { console.log(JSON.stringify({ objects: count, elapsedSeconds: Math.floor(elapsed), cycles, errors: errors.length })); progressAt += 60; }
  }
  const interactionSeconds = (performance.now() - workloadAt) / 1000;
  const interactionCanvasCreations = await page.evaluate(() => window.flowaMeasurement!.canvasCreations());
  // Also stop at a new zoom level. Include deferred sharp-cache rebuilds in the sample,
  // rather than measuring only fast out-and-back zoom bursts that reuse the old raster.
  const settledAt = performance.now();
  await page.keyboard.press('Control+='); await frames(page);
  const zoomInCommandMilliseconds = performance.now() - settledAt;
  await page.waitForTimeout(400); await frames(page);
  const zoomInAndSettleMilliseconds = performance.now() - settledAt;
  await page.keyboard.press('Control+-'); await page.waitForTimeout(400); await frames(page);
  const settledZoomProbe = { zoomInCommandMilliseconds, zoomInAndSettleMilliseconds,
    roundTripMilliseconds: performance.now() - settledAt, idleWaitPerStepMilliseconds: 400 };
  const measuredSeconds = (performance.now() - workloadAt) / 1000;
  const measured = await page.evaluate(() => window.flowaMeasurement!.stop());
  memory.push({ seconds: measuredSeconds, usedJSHeapBytes: await heap() });
  if (profiling) {
    const { profile } = await cdp.send('Profiler.stop');
    const profilePath = info.outputPath(`canvas-${count}.cpuprofile`);
    await writeFile(profilePath, JSON.stringify(profile));
    await info.attach('cpu-profile', { path: profilePath, contentType: 'application/json' });
  }
  await cdp.detach();
  expect(cycles).toBeGreaterThan(0); expect(measured.intervals.length).toBeGreaterThan(10);
  if (workload === 'mixed') {
    expect(stoppedZoomSamples.length).toBeGreaterThan(0);
    expect(stoppedZoomSamples.every(sample => sample.canvasCreations > 0)).toBe(true);
  }
  await expect(zoom).toHaveText(originalZoom);
  await expect.poll(async () => (await draft(page)).elements.find((element: any) => element.id === drawn.id)?.version).toBeGreaterThanOrEqual(startingVersion + cycles);
  await expect(page.getByRole('status')).toHaveText('已存於此裝置');
  const final = (await draft(page)).elements;
  const finalFiles = fileContent((await draft(page)).files);
  expect(finalFiles).toEqual(fileContent(files));
  expect(final).toHaveLength(count);
  expect(canonical({ elements: final.filter((element: any) => element.id.startsWith('perf-')) })).toBe(canonical({ elements: sourceElements }));
  const finalHash = sha(canonical({ elements: final }));
  await page.screenshot({ path: info.outputPath(`canvas-${count}.png`) });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '備份 JSON ↗' }).click();
  const stream = await (await download).createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(sha(canonical({ elements: exported.elements }))).toBe(finalHash);
  expect(fileContent(exported.files)).toEqual(finalFiles);
  await page.reload(); await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  const reloadedDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '備份 JSON ↗' }).click();
  const reloadedStream = await (await reloadedDownload).createReadStream(); const reloadedChunks: Buffer[] = [];
  for await (const chunk of reloadedStream!) reloadedChunks.push(chunk);
  const reloaded = JSON.parse(Buffer.concat(reloadedChunks).toString());
  expect(sha(canonical({ elements: reloaded.elements }))).toBe(finalHash);
  expect(fileContent(reloaded.files)).toEqual(finalFiles);
  expect(errors).toEqual([]);
  const report = { started, finished: new Date().toISOString(), sourceCommit, dirtyPaths, artifactHash, artifactDirectory, profiling,
    browser: browser.version(), node: process.version, platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, totalMemoryBytes: totalmem(),
    workload, elementTypes: Object.fromEntries([...new Set(initial.map(element => element.type))].map(type => [type, initial.filter(element => element.type === type).length])),
    fileContentHash: sha(JSON.stringify(finalFiles)), stoppedZoomSamples,
    viewport: page.viewportSize(), devicePixelRatio: await page.evaluate(() => devicePixelRatio), objects: count, requestedSeconds: seconds, interactionSeconds, measuredSeconds, cycles, settledZoomProbe,
    canvasCreations: { interaction: interactionCanvasCreations, includingSettledProbe: measured.canvasCreations },
    importAndSaveMilliseconds, drawingCommandMilliseconds, drawingSaveMilliseconds,
    panPairCommandMilliseconds: summarize(panTimes), zoomPairCommandMilliseconds: summarize(zoomTimes),
    animationFrameIntervalMilliseconds: summarize(measured.intervals), intervalsOver50ms: measured.intervals.filter(value => value > 50).length,
    longTaskMilliseconds: summarize(measured.longTasks), longTasksSupported: measured.longTasksSupported, memory, errors, finalSceneHash: finalHash,
    note: 'Headless Chromium production preview; SW blocked, no relay. Workload identifies dense rectangles or mixed shapes, unbound text/arrows and repeated references to one PNG. RAF intervals are callback scheduling, not GPU frame rate. Commands include Playwright transport and deliberate frame pacing. Heap samples do not prove a leak; no forced GC. Drawing is measured once; sustained workload pans, zooms and nudges the selected object. Mixed workload includes stopped zoom after cycle 1 and every 5 cycles; interactionSeconds includes those waits. All runs include a final stopped-zoom probe with 400 ms explicit idle per step. canvasCreations counts document.createElement(canvas), not total live canvases or memory.' };
  const path = info.outputPath(`metrics-${count}.json`); await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  await info.attach('performance-metrics', { path, contentType: 'application/json' });
});
