import { test, expect, webkit, type Browser, type Page, type Download, type WebSocketRoute } from '@playwright/test';
import { createRelay } from '../../apps/relay/server';
import type { Draft } from '../../apps/web/src/storage';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { drawRectangle as draw } from '../browser/draw';
import { canonical } from '../../packages/protocol';

let relay: ReturnType<typeof createRelay>;
let otherBrowser: Browser;
test.beforeEach(async () => {
  relay = createRelay({ origins: ['http://127.0.0.1:5180'] });
  await relay.listen(3002);
  otherBrowser = await webkit.launch();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && otherBrowser) {
    const states = await Promise.all(otherBrowser.contexts().flatMap(context => context.pages()).map(async page => ({
      status: await page.getByTestId('sync-status').textContent().catch(() => null),
      errors: await page.getByRole('alert').allTextContents(),
    })));
    await info.attach('peer-errors', { body: JSON.stringify(states), contentType: 'application/json' });
    console.log('Peer errors:', states);
  }
  await otherBrowser?.close(); await relay?.close();
});

async function elements(page: Page): Promise<ExcalidrawElement[]> {
  const record = await page.evaluate(async () => {
    const room = new URLSearchParams(location.hash.slice(1)).get('room');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('flowa');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Draft | undefined>((resolve, reject) => {
        const request = db.transaction('boards').objectStore('boards').get(room ? `room:${room}` : 'draft');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
  return record ? JSON.parse(record.scene).elements : [];
}
function content(items: ExcalidrawElement[]) {
  return canonical({ elements: [...items].sort((a, b) => a.id.localeCompare(b.id)) });
}
async function create(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '建立協作房間' })).toBeEnabled();
  await page.getByRole('button', { name: '建立協作房間' }).click();
  await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
}
async function share(page: Page, role: '編輯' | '唯讀') {
  await page.getByRole('button', { name: `複製${role}連結` }).click();
  return page.getByLabel('分享連結', { exact: true }).inputValue();
}
async function downloadedScene(download: Download): Promise<{ elements: ExcalidrawElement[] }> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Missing backup stream');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

test('Chromium and WebKit exchange edits with a touch-enabled readonly tablet', async ({ page }, info) => {
  await create(page);
  const editor = await otherBrowser.newPage({ viewport: { width: 1440, height: 1000 } });
  const viewer = await otherBrowser.newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  await editor.goto(await share(page, '編輯'));
  await viewer.goto(await share(page, '唯讀'));
  for (const peer of [editor, viewer]) await expect(peer.getByTestId('sync-status')).toHaveText('協作同步完成');
  await draw(page); await draw(editor, 850, 650);
  for (const peer of [page, editor, viewer]) await expect.poll(async () => (await elements(peer)).length).toBe(2);
  const expected = content(await elements(page));
  for (const peer of [editor, viewer]) await expect.poll(async () => content(await elements(peer))).toEqual(expected);
  await expect(viewer.getByTitle('長方形 — R 或 2', { exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: '匯入 JSON', exact: true })).toBeDisabled();
  const file = viewer.waitForEvent('download');
  await viewer.getByRole('button', { name: '備份 JSON ↗' }).tap();
  expect(content((await downloadedScene(await file)).elements)).toEqual(expected);
  await editor.reload();
  await expect(editor.getByTestId('sync-status')).toHaveText('協作同步完成');
  await expect.poll(async () => content(await elements(editor))).toEqual(expected);
  await viewer.setViewportSize({ width: 1180, height: 820 });
  await expect(viewer.getByRole('button', { name: '備份 JSON ↗' })).toBeInViewport();
  expect(await viewer.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1180);
  await viewer.screenshot({ path: info.outputPath('webkit-tablet-viewer.png'), fullPage: true });
});

test('WebKit offline edits merge with Chromium and export the pre-reconnect recovery', async ({ page }) => {
  await create(page); await draw(page);
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const editor = await otherBrowser.newPage({ viewport: { width: 1440, height: 1000 } });
  const context = editor.context();
  let offline = false;
  const connections: { client: WebSocketRoute; server: WebSocketRoute }[] = [];
  await context.routeWebSocket('**/socket.io/**', client => {
    if (offline) { client.close(); return; }
    connections.push({ client, server: client.connectToServer() });
  });
  await editor.goto(await share(page, '編輯'));
  await expect(editor.getByTestId('sync-status')).toHaveText('協作同步完成');
  offline = true; await context.setOffline(true);
  for (const { client, server } of connections.splice(0)) { client.close(); server.close(); }
  await expect(editor.getByTestId('sync-status')).toHaveText('離線，本機編輯');
  await draw(editor, 850, 650); await draw(page, 600, 700);
  await expect.poll(async () => (await elements(editor)).length).toBe(2);
  await expect.poll(async () => (await elements(page)).length).toBe(2);
  const offlineCopy = content(await elements(editor));
  expect(offlineCopy).not.toEqual(content(await elements(page)));
  offline = false; await context.setOffline(false);
  await expect(editor.getByTestId('sync-status')).toHaveText('協作同步完成', { timeout: 30000 });
  await expect.poll(async () => (await elements(page)).length).toBe(3);
  await expect.poll(async () => content(await elements(editor))).toEqual(content(await elements(page)));
  const file = editor.waitForEvent('download');
  await editor.getByRole('button', { name: '匯出恢復副本' }).click();
  expect(content((await downloadedScene(await file)).elements)).toEqual(offlineCopy);
});
