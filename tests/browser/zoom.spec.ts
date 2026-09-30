import { test, expect } from '@playwright/test';

for (const input of ['keyboard', 'buttons']) test(`${input} zoom reuses raster caches during a burst and restores sharp rendering`, { tag: '@cross-browser' }, async ({ page }) => {
  await page.goto('/tests/browser/harness.html');
  await page.waitForFunction(() => Boolean(window.harness));
  await page.evaluate(() => window.harness.replace(window.harness.makeFlow()));
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => window.harness.scene().length)).toBeGreaterThan(3);
  await page.locator('canvas.excalidraw__canvas.interactive').click({ position: { x: 900, y: 600 } });
  const before = await page.evaluate(() => JSON.stringify(window.harness.scene()));
  const originalZoom = await page.evaluate(() => window.harness.zoomState().zoom);
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const zoom = async (direction: 'in' | 'out') => {
    if (input === 'keyboard') await page.keyboard.press(direction === 'in' ? 'Control+=' : 'Control+-');
    else await page.locator(`.zoom-${direction}-button`).click();
    await page.clock.runFor(32);
  };
  await zoom('in');
  expect(await page.evaluate(() => window.harness.zoomState())).toEqual({ zoom: originalZoom + .1, cached: true });
  await page.clock.runFor(200);
  await zoom('out');
  await page.clock.runFor(200);
  // Beyond the first action's deadline: the most recent action owns the timer.
  expect(await page.evaluate(() => window.harness.zoomState())).toEqual({ zoom: originalZoom, cached: true });
  await zoom('in'); await page.clock.runFor(400);
  expect(await page.evaluate(() => window.harness.zoomState())).toEqual({ zoom: originalZoom + .1, cached: false });
  const pixels = () => page.locator('canvas.excalidraw__canvas.static').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const settled = await pixels();
  expect(await page.evaluate(() => JSON.stringify(window.harness.scene()))).toBe(before);
  // Replacing with cloned elements forces fresh per-element caches at the same zoom.
  await page.evaluate(() => window.harness.replace(window.harness.scene()));
  await page.clock.runFor(100);
  expect(await pixels()).toBe(settled);
  expect(await page.evaluate(() => JSON.stringify(window.harness.scene()))).toBe(before);
});
