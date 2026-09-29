import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { createRelay } from '../../apps/relay/server';
import { scene, rectangle } from './fixtures';
import { drawRectangle as draw } from './draw';
let relay: ReturnType<typeof createRelay>;
test.beforeEach(async () => { relay = createRelay({ origins: ['http://127.0.0.1:5180'] }); await relay.listen(3002); });
test.afterEach(async () => { await relay.close(); });
async function savedElements(page: Page) {
  return page.evaluate(async () => {
    const room = new URLSearchParams(location.hash.slice(1)).get('room');
    const key = room ? `room:${room}` : 'draft';
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('flowa'); request.onsuccess = () => resolve(request.result); });
    return new Promise<any[]>(resolve => { const request = db.transaction('boards').objectStore('boards').get(key); request.onsuccess = () => { db.close(); resolve(JSON.parse(request.result?.scene ?? '{"elements":[]}').elements); }; });
  });
}
async function create(page: Page) {
  await page.goto('/'); await expect(page.getByRole('button', { name: '建立協作房間' })).toBeEnabled();
  await page.getByLabel('顯示名稱', { exact: true }).fill('Nova');
  await page.getByRole('button', { name: '建立協作房間' }).click();
  await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
}
async function share(page: Page, type: '編輯' | '唯讀') {
  await page.getByRole('button', { name: `複製${type}連結` }).click();
  return page.getByLabel('分享連結', { exact: true }).inputValue();
}

test('real relay synchronizes drawing, readonly guest and room close', { tag: '@cross-browser' }, async ({ page, browser }, info) => {
  await create(page);
  const edit = await share(page, '編輯'), view = await share(page, '唯讀');
  const editorContext = await browser.newContext(), viewerContext = await browser.newContext();
  const editor = await editorContext.newPage(), viewer = await viewerContext.newPage();
  try {
    await editor.goto(edit); await expect(editor.getByTestId('sync-status')).toHaveText('協作同步完成');
    await viewer.goto(view); await expect(viewer.getByTestId('sync-status')).toHaveText('協作同步完成');
    await draw(page);
    await expect.poll(async () => (await savedElements(editor)).filter(element => !element.isDeleted).length).toBe(1);
    await expect.poll(async () => (await savedElements(viewer)).filter(element => !element.isDeleted).length).toBe(1);
    await expect(viewer.getByRole('button', { name: '匯入 JSON', exact: true })).toBeDisabled();
    await expect(viewer.getByTitle('長方形 — R 或 2', { exact: true })).toHaveCount(0);
    await draw(editor, 850, 600);
    await expect.poll(async () => (await savedElements(page)).filter(element => !element.isDeleted).length).toBe(2);
    await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
    await page.screenshot({ path: info.outputPath('collaboration.png'), fullPage: true });
    await page.getByRole('button', { name: '關閉房間', exact: true }).click();
    await expect(editor.getByTestId('sync-status')).toHaveText('房間失效');
    expect((await savedElements(editor)).length).toBeGreaterThanOrEqual(2);
  } finally { await editorContext.close(); await viewerContext.close(); }
});

test('offline edits merge after reconnect and keep an exportable recovery copy', { tag: '@cross-browser' }, async ({ page, browser }) => {
  await create(page); await draw(page);
  const context = await browser.newContext(); const editor = await context.newPage();
  // Firefox's offline emulation leaves existing WebSockets alive. Explicitly
  // cut both sides and reject reconnects while offline, retaining a real relay.
  let offline = false;
  const connections: { client: WebSocketRoute; server: WebSocketRoute }[] = [];
  await context.routeWebSocket('**/socket.io/**', client => {
    if (offline) { client.close(); return; }
    connections.push({ client, server: client.connectToServer() });
  });
  try {
    await editor.goto(await share(page, '編輯')); await expect(editor.getByTestId('sync-status')).toHaveText('協作同步完成');
    offline = true;
    await context.setOffline(true);
    for (const { client, server } of connections.splice(0)) { client.close(); server.close(); }
    await expect(editor.getByTestId('sync-status')).toHaveText('離線，本機編輯', { timeout: 45000 });
    await draw(editor, 900, 600); await draw(page, 650, 700);
    await expect.poll(async () => (await savedElements(editor)).filter(element => !element.isDeleted).length).toBe(2);
    await expect.poll(async () => (await savedElements(page)).filter(element => !element.isDeleted).length).toBe(2);
    expect((await savedElements(editor)).map(element => element.id).sort()).not.toEqual((await savedElements(page)).map(element => element.id).sort());
    offline = false;
    await context.setOffline(false);
    await expect(editor.getByTestId('sync-status')).toHaveText('協作同步完成', { timeout: 30000 });
    await expect.poll(async () => (await savedElements(page)).filter(element => !element.isDeleted).length).toBe(3);
    await expect.poll(async () => (await savedElements(editor)).filter(element => !element.isDeleted).length).toBe(3);
    await expect(editor.getByRole('button', { name: '匯出恢復副本' })).toBeVisible();
  } finally { await context.close(); }
});

test('a room never overwrites the unrelated single-user draft', async ({ page, browser }) => {
  await create(page); const link = await share(page, '編輯');
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto('/'); await expect(guest.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
    await guest.locator('input[type=file]').setInputFiles({ name: 'local.json', mimeType: 'application/json', buffer: Buffer.from(scene([rectangle('unrelated')])) });
    // The previous empty draft may already say "saved" while File.text() is pending.
    // Wait for the imported transaction and remounted editor before navigating.
    await expect.poll(async () => (await savedElements(guest)).map(element => element.id)).toEqual(['unrelated']);
    await expect(guest.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
    await expect(guest.getByRole('status')).toHaveText('已存於此裝置');
    await guest.goto(link); await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成');
    expect((await savedElements(guest)).some(element => element.id === 'unrelated')).toBe(false);
    await guest.getByRole('button', { name: '離開房間' }).click();
    const downloaded = guest.waitForEvent('download'); await guest.getByRole('button', { name: '備份 JSON ↗' }).click();
    const stream = await (await downloaded).createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
    expect(JSON.parse(Buffer.concat(chunks).toString()).elements[0].id).toBe('unrelated');
  } finally { await context.close(); }
});

test('restored page verifies its connection and checkpoints local content', { tag: '@cross-browser' }, async ({ page, browser }) => {
  await create(page);
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto(await share(page, '編輯'));
    await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成');
    await draw(guest, 650, 500);
    const previousIds = [...relay.io.sockets.sockets.keys()].sort();
    let checked = 0;
    for (const socket of relay.io.sockets.sockets.values()) socket.on('resume-check', () => { checked++; });
    // Simulate the lifecycle notification, not actual OS suspension or BFCache admission.
    await guest.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect.poll(() => checked).toBe(1);
    expect([...relay.io.sockets.sockets.keys()].sort()).toEqual(previousIds);
    await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成');
    await expect.poll(async () => (await savedElements(guest)).length).toBe(1);
    await expect.poll(async () => (await savedElements(page)).map(element => element.id)).toEqual((await savedElements(guest)).map(element => element.id));
    const downloaded = guest.waitForEvent('download'); await guest.getByRole('button', { name: '匯出恢復副本' }).click();
    const stream = await (await downloaded).createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
    expect(JSON.parse(Buffer.concat(chunks).toString()).elements[0].id).toBe((await savedElements(guest))[0].id);
    await page.getByRole('button', { name: '關閉房間', exact: true }).click();
    await expect(guest.getByTestId('sync-status')).toHaveText('房間失效');
    await guest.waitForTimeout(1100); // Exercise the terminal-state guard beyond lifecycle deduplication.
    await guest.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(guest.getByTestId('sync-status')).toHaveText('房間失效');
  } finally { await context.close(); }
});

test('a sole editor stays available after foreground recovery', { tag: '@cross-browser' }, async ({ page }) => {
  await create(page); await draw(page);
  await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
  const socket = [...relay.io.sockets.sockets.values()][0];
  let checked = false; socket.on('resume-check', () => { checked = true; });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => checked).toBe(true);
  expect([...relay.io.sockets.sockets.keys()]).toEqual([socket.id]);
  await draw(page, 850, 600);
  await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
  await expect.poll(async () => (await savedElements(page)).length).toBe(2);
});

test('foreground sequence check recovers missed updates on a connected transport', async ({ page, browser }) => {
  await create(page);
  const context = await browser.newContext(), guest = await context.newPage();
  let dropUpdates = false, dropped = 0;
  await context.routeWebSocket('**/socket.io/**', client => {
    const server = client.connectToServer();
    server.onMessage(message => {
      if (dropUpdates && typeof message === 'string' && message.startsWith('42["elements-update",')) { dropped++; return; }
      client.send(message);
    });
  });
  try {
    await guest.goto(await share(page, '編輯')); await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成');
    dropUpdates = true;
    await draw(page);
    await expect.poll(() => dropped).toBeGreaterThan(0);
    expect(await savedElements(guest)).toHaveLength(0);
    const previousIds = [...relay.io.sockets.sockets.keys()].sort();
    dropUpdates = false;
    await guest.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect.poll(() => [...relay.io.sockets.sockets.keys()].sort()).not.toEqual(previousIds);
    await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成');
    await expect.poll(async () => (await savedElements(guest)).map(element => element.id)).toEqual((await savedElements(page)).map(element => element.id));
    await expect.poll(async () => (await savedElements(guest)).length).toBe(1);
    await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
  } finally { await context.close(); }
});

test('restore backup failure preserves content and requires explicit retry', async ({ page, browser }) => {
  await create(page);
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto(await share(page, '編輯')); await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成');
    await draw(guest, 650, 500);
    await expect.poll(async () => (await savedElements(guest)).length).toBe(1);
    const id = (await savedElements(guest))[0].id;
    await guest.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) { if (this.name === 'recoveries') throw new DOMException('Backup quota exceeded', 'QuotaExceededError'); return add.apply(this, args); };
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(guest.getByTestId('sync-status')).toHaveText('同步失敗');
    await guest.waitForTimeout(1100); // Do not let lifecycle deduplication mask the error-state guard.
    await guest.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(guest.getByTestId('sync-status')).toHaveText('同步失敗');
    const downloaded = guest.waitForEvent('download'); await guest.getByRole('button', { name: '備份 JSON ↗' }).click();
    const stream = await (await downloaded).createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
    expect(JSON.parse(Buffer.concat(chunks).toString()).elements.map((element: any) => element.id)).toEqual([id]);
  } finally { await context.close(); }
});

test('editor and viewer links in the same tab do not retain manager controls', async ({ page, browser }) => {
  await create(page);
  const editor = await share(page, '編輯'), viewer = await share(page, '唯讀');
  const context = await browser.newContext(); const donor = await context.newPage();
  try {
    await donor.goto(editor); await expect(donor.getByTestId('sync-status')).toHaveText('協作同步完成');
    await page.goto(editor); await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
    await expect(page.getByText('編輯者', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '複製編輯連結' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '複製唯讀連結' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '關閉房間' })).toHaveCount(0);
    await page.goto(viewer); await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
    await expect(page.getByText('唯讀', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '複製編輯連結' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '複製唯讀連結' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '關閉房間' })).toHaveCount(0);
  } finally { await context.close(); }
});

test('a manager link in a fresh tab can close the room without cached share credentials', async ({ page, browser }) => {
  await create(page);
  const manager = page.url();
  const context = await browser.newContext(); const managerPage = await context.newPage();
  try {
    await managerPage.goto(manager); await expect(managerPage.getByTestId('sync-status')).toHaveText('協作同步完成');
    await expect(managerPage.getByText('管理者', { exact: true })).toBeVisible();
    await expect(managerPage.getByRole('button', { name: '複製編輯連結' })).toHaveCount(0);
    await expect(managerPage.getByRole('button', { name: '複製唯讀連結' })).toHaveCount(0);
    await expect(managerPage.getByRole('button', { name: '關閉房間' })).toBeVisible();
    await managerPage.getByRole('button', { name: '關閉房間' }).click();
    await expect(page.getByTestId('sync-status')).toHaveText('房間失效');
  } finally { await context.close(); }
});

test('restart expires old credentials and preserves the local room copy', async ({ page }) => {
  await create(page); await draw(page);
  await expect.poll(async () => (await savedElements(page)).length).toBe(1);
  await relay.close(); relay = createRelay({ origins: ['http://127.0.0.1:5180'] }); await relay.listen(3002);
  await expect(page.getByTestId('sync-status')).toHaveText('房間失效', { timeout: 30000 });
  expect((await savedElements(page)).length).toBe(1);
  await page.getByRole('button', { name: '以副本重新開房' }).click();
  await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
  expect((await savedElements(page)).length).toBe(1);
});

for (const count of [500, 2000]) test(`${count} objects transfer in bounded chunks to a new browser`, async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.goto('/'); await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
  const elements = Array.from({ length: count }, (_, index) => rectangle(`object-${index}`, { index: `a0${(index + 1).toString(36).padStart(4, '0')}1`, x: index % 40 * 30, y: Math.floor(index / 40) * 30, width: 20, height: 20 }));
  await page.locator('input[type=file]').setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(scene(elements)) });
  await expect(page.getByRole('status')).toHaveText('已存於此裝置');
  await page.getByRole('button', { name: '建立協作房間' }).click();
  await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成', { timeout: 45000 });
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto(await share(page, '唯讀'));
    await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成', { timeout: 45000 });
    await expect.poll(async () => (await savedElements(guest)).length).toBe(count);
  } finally { await context.close(); }
});

test('snapshot overlaps ongoing edits without losing them', async ({ page, browser }) => {
  await create(page);
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    const link = await share(page, '編輯');
    await guest.goto(link);
    await draw(page, 500, 450); await draw(page, 750, 450);
    await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成');
    await expect.poll(async () => (await savedElements(guest)).filter(element => !element.isDeleted).length).toBe(2);
    await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
  } finally { await context.close(); }
});

test('failed reconnect backup stops remote apply and keeps offline changes', async ({ page, browser }) => {
  await create(page);
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto(await share(page, '編輯')); await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成');
    await context.setOffline(true); await expect(guest.getByTestId('sync-status')).toHaveText('離線，本機編輯');
    await draw(guest, 650, 500); await expect.poll(async () => (await savedElements(guest)).length).toBe(1);
    await guest.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) { if (this.name === 'recoveries') throw new DOMException('Backup quota exceeded', 'QuotaExceededError'); return add.apply(this, args); };
    });
    await draw(page, 900, 600);
    await expect.poll(async () => (await savedElements(page)).length).toBe(1);
    await context.setOffline(false);
    await expect(guest.getByTestId('sync-status')).toHaveText('同步失敗');
    expect((await savedElements(guest)).length).toBe(1);
    expect((await savedElements(guest))[0].id).not.toBe((await savedElements(page))[0].id);
  } finally { await context.close(); }
});

test('moving a flow node preserves bound text and connector across peers', async ({ page, browser }) => {
  const helper = await browser.newPage(); await helper.goto('/tests/browser/harness.html');
  await helper.waitForFunction(() => Boolean(window.harness));
  const elements = await helper.evaluate(() => window.harness.makeFlow()); await helper.close();
  await page.goto('/'); await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles({ name: 'flow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'excalidraw', version: 2, elements, files: {}, appState: {} })) });
  await expect(page.getByRole('status')).toHaveText('已存於此裝置');
  await page.getByRole('button', { name: '建立協作房間' }).click(); await expect(page.getByTestId('sync-status')).toHaveText('協作同步完成');
  const context = await browser.newContext(); const guest = await context.newPage();
  try {
    await guest.goto(await share(page, '編輯')); await expect(guest.getByTestId('sync-status')).toHaveText('協作同步完成');
    const box = await page.getByRole('region', { name: 'Flowa 畫布' }).boundingBox();
    await page.getByTitle('選取 — V 或 1', { exact: true }).click();
    await page.mouse.move(130, box!.y + 220); await page.mouse.down(); await page.mouse.move(190, box!.y + 280, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await savedElements(page)).find(element => element.id === 'node-a')?.x).toBeGreaterThan(100);
    await expect.poll(async () => (await savedElements(guest)).find(element => element.id === 'node-a')?.x).toBeGreaterThan(100);
    const remote = await savedElements(guest), local = await savedElements(page);
    expect(remote.find(element => element.type === 'arrow').startBinding.elementId).toBe('node-a');
    expect(remote.find(element => element.type === 'arrow').points).toEqual(local.find(element => element.type === 'arrow').points);
    expect(remote.find(element => element.type === 'text' && element.containerId === 'node-a')).toBeTruthy();
  } finally { await context.close(); }
});

test('narrow viewport keeps sharing and export controls usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await create(page);
  await expect(page.getByRole('button', { name: '複製編輯連結' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('collaboration-mobile.png'), fullPage: true });
});

test('an expired link never creates or exports a blank replacement', async ({ page }) => {
  await page.goto('/#room=nonexistent&key=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  await expect(page.getByTestId('sync-status')).toHaveText('房間失效');
  await expect(page.getByText('無法取得房間內容。請向持有副本的人取得新的分享連結。')).toBeVisible();
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeDisabled();
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('flowa'); r.onsuccess = () => resolve(r.result); });
    return new Promise(resolve => { const r = db.transaction('boards').objectStore('boards').get('room:nonexistent'); r.onsuccess = () => { db.close(); resolve(r.result); }; });
  });
  expect(stored).toBeUndefined();
});

test('changing a room fragment preserves unsaved work when storage fails', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: '建立協作房間' })).toBeEnabled();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'boards') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return put.apply(this, args); };
  });
  await draw(page);
  await page.evaluate(() => { location.hash = 'room=nonexistent&key=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; });
  await expect(page.getByRole('alert')).toContainText('切換前儲存失敗');
  await expect(page).toHaveURL('http://127.0.0.1:5180/');
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '備份 JSON ↗' }).click();
  const stream = await (await downloaded).createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).elements.filter((element: any) => !element.isDeleted)).toHaveLength(1);
});

test('changing a room fragment flushes the current draft before joining', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: '建立協作房間' })).toBeEnabled();
  await draw(page);
  await page.evaluate(() => { location.hash = 'room=nonexistent&key=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; });
  await expect(page.getByTestId('sync-status')).toHaveText('房間失效');
  await page.getByRole('button', { name: '離開房間' }).click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '備份 JSON ↗' }).click();
  const stream = await (await downloaded).createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).elements.filter((element: any) => !element.isDeleted)).toHaveLength(1);
});
