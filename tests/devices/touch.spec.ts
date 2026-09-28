import { test, expect } from '@playwright/test';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { canonical } from '../../packages/protocol';

test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

test('tablet touch drawing survives rotation, reload and JSON export', async ({ page, context }, info) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
  await page.getByTitle('長方形 — R 或 2', { exact: true }).tap();
  const session = await context.newCDPSession(page);
  // Browser-generated touch gesture, including the gesture lifecycle and input pacing.
  await session.send('Input.synthesizeScrollGesture', { x: 300, y: 550, xDistance: -160, yDistance: -120, speed: 300, gestureSourceType: 'touch', preventFling: true });

  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('flowa'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction('boards').objectStore('boards').get('draft');
        request.onsuccess = () => resolve(JSON.parse(request.result?.scene ?? '{"elements":[]}').elements[0]?.width ?? 0);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  })).toBeGreaterThan(100);
  await expect(page.getByRole('status')).toHaveText('已存於此裝置');
  async function backup(): Promise<{ elements: ExcalidrawElement[] }> {
    const file = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: '備份 JSON ↗' }).tap();
    const stream = await (await file).createReadStream();
    if (!stream) throw new Error('Missing backup');
    const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  }

  const original = await backup();
  expect(original.elements).toHaveLength(1);
  expect(original.elements[0]).toMatchObject({ type: 'rectangle', isDeleted: false });
  expect(original.elements[0].width).toBeGreaterThan(100);
  expect(original.elements[0].height).toBeGreaterThan(70);
  for (const viewport of [{ width: 1180, height: 820 }, { width: 820, height: 1180 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: info.outputPath(`tablet-${viewport.width}.png`), fullPage: true });
  }
  await page.reload();
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  expect(canonical({ elements: (await backup()).elements })).toBe(canonical({ elements: original.elements }));
  await session.detach();
});
