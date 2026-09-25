import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('offline-status')).toHaveText('離線可用', { timeout: 60000 });
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
}
async function draw(page: Page) {
  await page.getByTitle('長方形 — R 或 2', { exact: true }).click();
  await page.mouse.move(650, 450); await page.mouse.down(); await page.mouse.move(800, 550, { steps: 5 }); await page.mouse.up();
}
async function draft(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('flowa'); r.onsuccess = () => resolve(r.result); });
    return new Promise<any>(resolve => { const r = db.transaction('boards').objectStore('boards').get('draft'); r.onsuccess = () => { db.close(); resolve(r.result); }; });
  });
}
async function newRelease(page: Page) {
  await page.request.post('/__test__/release');
  await page.getByRole('button', { name: '檢查更新', exact: true }).click();
  await expect(page.getByRole('button', { name: '儲存副本並更新' })).toBeVisible({ timeout: 60000 });
}
async function controller(page: Page) {
  return page.evaluate(async () => {
    const worker = navigator.serviceWorker.controller!;
    return new Promise<string>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data.version); }; worker.postMessage({ type: 'STATUS' }, [channel.port2]); });
  });
}
test.beforeEach(async ({ request }) => { await request.post('/__test__/release'); });

test('production app restarts offline, saves edits and exports with local fonts', async ({ page, context }, info) => {
  await ready(page); await draw(page);
  await expect.poll(async () => JSON.parse((await draft(page)).scene).elements.length).toBe(1);
  const id = JSON.parse((await draft(page)).scene).elements[0].id;
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone'); expect(manifest.start_url).toBe('/');
  await context.setOffline(true); await page.reload();
  await expect(page.getByTestId('offline-status')).toContainText('目前離線');
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  expect(JSON.parse((await draft(page)).scene).elements[0].id).toBe(id);
  await draw(page);
  await expect.poll(async () => JSON.parse((await draft(page)).scene).elements.length).toBe(2);
  // Fresh font load from the real offline worker, independent of the HTTP cache.
  const fonts = await page.evaluate(async () => {
    const cache = await caches.open((await caches.keys()).find(key => key.startsWith('flowa-shell-'))!);
    const files = await cache.keys();
    return Promise.all(['Excalifont', 'Xiaolai'].map(async family => {
      const file = files.find(request => request.url.includes(`/fonts/${family}/`) && request.url.endsWith('.woff2'))!;
      const response = await fetch(file.url); const face = new FontFace(`Offline${family}`, await response.arrayBuffer()); await face.load();
      document.fonts.add(face); return face.status;
    }));
  });
  expect(fonts).toEqual(['loaded', 'loaded']);
  for (const name of ['備份 JSON ↗', 'PNG', 'SVG']) {
    const download = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
    expect(await (await download).failure()).toBeNull();
  }
  const reopened = await context.newPage(); await page.close(); await reopened.goto('/');
  await expect(reopened.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  expect(JSON.parse((await draft(reopened)).scene).elements).toHaveLength(2);
  await reopened.screenshot({ path: info.outputPath('offline.png'), fullPage: true });
  await reopened.setViewportSize({ width: 390, height: 844 });
  await expect(reopened.getByRole('button', { name: '備份 JSON ↗' })).toBeInViewport();
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await reopened.screenshot({ path: info.outputPath('offline-mobile.png'), fullPage: true });
});

test('update waits for consent and checkpoints pending edits before reload', async ({ page }) => {
  await ready(page); const old = await controller(page); await newRelease(page);
  expect(await controller(page)).toBe(old);
  await draw(page);
  const loaded = page.waitForEvent('load');
  await page.getByRole('button', { name: '儲存副本並更新' }).click();
  await loaded;
  expect(await controller(page)).not.toBe(old);
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  await expect.poll(async () => JSON.parse((await draft(page)).scene).elements.length).toBe(1);
  const recovery = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('flowa'); r.onsuccess = () => resolve(r.result); });
    return new Promise<any>(resolve => { const r = db.transaction('recoveries').objectStore('recoveries').getAll(); r.onsuccess = () => { db.close(); resolve(r.result.at(-1)); }; });
  });
  expect(JSON.parse(recovery.scene).elements).toHaveLength(1);
});

test('backup failure blocks activation and preserves exportable unsaved work', async ({ page }) => {
  await ready(page); const old = await controller(page); await newRelease(page); await draw(page);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) { if (this.name === 'recoveries') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return add.apply(this, args); };
  });
  await page.getByRole('button', { name: '儲存副本並更新' }).click();
  await expect(page.getByTestId('pwa-message')).toContainText('已停止更新');
  expect(await controller(page)).toBe(old);
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  expect(JSON.parse((await draft(page)).scene).elements).toHaveLength(1);
});

test('another open tab blocks activation without reloading either canvas', async ({ page, context }) => {
  await ready(page); const second = await context.newPage(); await ready(second);
  const old = await controller(page); await newRelease(page);
  await page.getByRole('button', { name: '儲存副本並更新' }).click();
  await expect(page.getByTestId('pwa-message')).toContainText('請先關閉其他');
  expect(await controller(page)).toBe(old); expect(await controller(second)).toBe(old);
  await second.close();
  const loaded = page.waitForEvent('load');
  await page.getByRole('button', { name: '儲存副本並更新' }).click();
  await loaded;
  expect(await controller(page)).not.toBe(old);
});

test('failed candidate installation leaves the existing offline app usable and never caches API responses', async ({ page, context }) => {
  await ready(page); await draw(page);
  await expect.poll(async () => JSON.parse((await draft(page)).scene).elements.length).toBe(1);
  const old = await controller(page);
  await page.evaluate(async () => { await fetch('/rooms'); await fetch('/?key=private-query'); });
  await page.request.post('/__test__/release?broken=1');
  await page.getByRole('button', { name: '檢查更新', exact: true }).click();
  await expect(page.getByTestId('pwa-message')).toContainText('離線資源準備失敗', { timeout: 60000 });
  expect(await controller(page)).toBe(old);
  const keys = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat());
  expect(keys.some(url => url.includes('/rooms') || url.includes('?') || url.includes('#'))).toBe(false);
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  expect(JSON.parse((await draft(page)).scene).elements).toHaveLength(1);
});
