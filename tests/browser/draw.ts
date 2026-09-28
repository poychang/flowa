import type { Page } from '@playwright/test';

/** Let the canvas consume its animation-frame throttled pointer move before release. */
export async function drawRectangle(page: Page, x = 650, y = 450, width = 120, height = 90) {
  await page.getByTitle('長方形 — R 或 2', { exact: true }).click();
  await page.mouse.move(x, y); await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await page.mouse.move(x + width * step / 8, y + height * step / 8);
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.up();
}
