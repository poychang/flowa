import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, platform, release } from 'node:os';
import { join } from 'node:path';
import { rectangle, scene } from '../browser/fixtures';
import { drawRectangle } from '../browser/draw';
import { canonical } from '../../packages/protocol';

const seconds = Number(process.env.PERF_SECONDS ?? 300);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, ...args], { encoding: 'utf8' }).trim();
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? null, p95: sorted[Math.floor(sorted.length * .95)] ?? null, max: sorted.at(-1) ?? null };
};
async function buildHash(root = 'dist'): Promise<string> {
  const entries: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else entries.push(`${path.replaceAll('\\', '/')}:${sha(await readFile(path))}`);
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
  interface Window { flowaMeasurement?: { stop: () => { intervals: number[]; longTasks: number[]; longTasksSupported: boolean } }; }
}

for (const count of [500, 2000]) test(`${count} objects preserve data during sustained canvas interaction`, async ({ page, context, browser }, info) => {
  const started = new Date().toISOString();
  const sourceCommit = git('rev-parse', 'HEAD');
  const dirtyPaths = git('status', '--porcelain', '--', 'apps', 'packages', 'tests/performance', 'tests/browser/draw.ts', 'tests/browser/fixtures.ts', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'playwright.performance.config.ts');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('crash', () => errors.push('page-crashed'));
  const artifactHash = await buildHash();
  await page.goto('/'); await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
  // Reserve one object for a real pointer-drawn rectangle, never exceed 2,000.
  const initial = Array.from({ length: count - 1 }, (_, i) => rectangle(`perf-${i}`, {
    index: `a${i.toString(36).padStart(4, '0')}1`, x: 100 + i % 40 * 20, y: 60 + Math.floor(i / 40) * 12,
    width: 16, height: 8, roughness: 1,
  }));
  const importAt = performance.now();
  await page.locator('input[type=file]').setInputFiles({ name: 'performance.json', mimeType: 'application/json', buffer: Buffer.from(scene(initial)) });
  await expect.poll(async () => (await draft(page)).elements.length).toBe(count - 1);
  await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
  const importAndSaveMilliseconds = performance.now() - importAt;
  const sourceElements = (await draft(page)).elements;
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
  async function heap() { const value = await cdp.send('Performance.getMetrics'); return value.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null; }
  const memory: { seconds: number; usedJSHeapBytes: number | null }[] = [{ seconds: 0, usedJSHeapBytes: await heap() }];
  await page.evaluate(() => {
    const intervals: number[] = [], longTasks: number[] = []; let last = performance.now(), id = 0;
    const tick = (now: number) => { intervals.push(now - last); last = now; id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick);
    const supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supported ? new PerformanceObserver(list => { longTasks.push(...list.getEntries().map(entry => entry.duration)); }) : undefined;
    observer?.observe({ type: 'longtask' });
    window.flowaMeasurement = { stop: () => { cancelAnimationFrame(id); if (observer) { longTasks.push(...observer.takeRecords().map(entry => entry.duration)); observer.disconnect(); } return { intervals, longTasks, longTasksSupported: supported }; } };
  });
  const panTimes: number[] = [], zoomTimes: number[] = []; let cycles = 0, sampleAt = 30, progressAt = 60;
  const workloadAt = performance.now();
  while (performance.now() - workloadAt < seconds * 1000) {
    let at = performance.now(); await pan(page, 1); await pan(page, -1); panTimes.push(performance.now() - at);
    at = performance.now(); await page.keyboard.press('Control+='); await frames(page); await page.keyboard.press('Control+-'); await frames(page); zoomTimes.push(performance.now() - at);
    await page.keyboard.press(cycles % 2 ? 'ArrowLeft' : 'ArrowRight'); cycles++;
    const elapsed = (performance.now() - workloadAt) / 1000;
    if (elapsed >= sampleAt) { memory.push({ seconds: elapsed, usedJSHeapBytes: await heap() }); sampleAt += 30; }
    if (elapsed >= progressAt) { console.log(JSON.stringify({ objects: count, elapsedSeconds: Math.floor(elapsed), cycles, errors: errors.length })); progressAt += 60; }
  }
  const measuredSeconds = (performance.now() - workloadAt) / 1000;
  const measured = await page.evaluate(() => window.flowaMeasurement!.stop());
  memory.push({ seconds: measuredSeconds, usedJSHeapBytes: await heap() }); await cdp.detach();
  expect(cycles).toBeGreaterThan(1); expect(measured.intervals.length).toBeGreaterThan(10);
  await expect(zoom).toHaveText(originalZoom);
  await expect.poll(async () => (await draft(page)).elements.find((element: any) => element.id === drawn.id)?.version).toBeGreaterThanOrEqual(startingVersion + cycles);
  await expect(page.getByRole('status')).toHaveText('已存於此裝置');
  const final = (await draft(page)).elements;
  expect(final).toHaveLength(count);
  expect(canonical({ elements: final.filter((element: any) => element.id.startsWith('perf-')) })).toBe(canonical({ elements: sourceElements }));
  const finalHash = sha(canonical({ elements: final }));
  await page.screenshot({ path: info.outputPath(`canvas-${count}.png`) });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '備份 JSON ↗' }).click();
  const stream = await (await download).createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(sha(canonical({ elements: JSON.parse(Buffer.concat(chunks).toString()).elements }))).toBe(finalHash);
  await page.reload(); await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  expect(sha(canonical({ elements: (await draft(page)).elements }))).toBe(finalHash); expect(errors).toEqual([]);
  const report = { started, finished: new Date().toISOString(), sourceCommit, dirtyPaths, artifactHash,
    browser: browser.version(), node: process.version, platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, totalMemoryBytes: totalmem(),
    viewport: page.viewportSize(), devicePixelRatio: await page.evaluate(() => devicePixelRatio), objects: count, requestedSeconds: seconds, measuredSeconds, cycles,
    importAndSaveMilliseconds, drawingCommandMilliseconds, drawingSaveMilliseconds,
    panPairCommandMilliseconds: summarize(panTimes), zoomPairCommandMilliseconds: summarize(zoomTimes),
    animationFrameIntervalMilliseconds: summarize(measured.intervals), intervalsOver50ms: measured.intervals.filter(value => value > 50).length,
    longTaskMilliseconds: summarize(measured.longTasks), longTasksSupported: measured.longTasksSupported, memory, errors, finalSceneHash: finalHash,
    note: 'Headless Chromium production preview; SW blocked, no relay. Dense rectangles. RAF intervals are callback scheduling, not GPU frame rate. Commands include Playwright transport and deliberate frame pacing. Heap samples do not prove a leak; no forced GC. Drawing is measured once; sustained workload pans, zooms and nudges the selected object.' };
  const path = info.outputPath(`metrics-${count}.json`); await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  await info.attach('performance-metrics', { path, contentType: 'application/json' });
});
