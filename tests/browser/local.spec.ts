import { test, expect } from '@playwright/test';
import type { Page, Download } from '@playwright/test';
import { rectangle, scene } from './fixtures';

async function readDraft(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('flowa'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return new Promise<any>((resolve, reject) => {
      const request = db.transaction('boards').objectStore('boards').get('draft');
      request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error);
    });
  });
}
async function imported(page: Page, content: string) {
  await page.locator('input[type=file]').setInputFiles({ name: 'board.json', mimeType: 'application/json', buffer: Buffer.from(content) });
}
async function downloadText(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('draw, autosave, reload, JSON restore and image exports', { tag: '@cross-browser' }, async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
  await page.getByTitle('長方形 — R 或 2', { exact: true }).click();
  await page.mouse.move(600, 350); await page.mouse.down(); await page.mouse.move(850, 500, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => JSON.parse((await readDraft(page))?.scene ?? '{"elements":[]}').elements.length).toBe(1);
  await expect(page.getByRole('status')).toHaveText('已存於此裝置');
  const before = JSON.parse((await readDraft(page)).scene).elements;
  await page.reload();
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  const jsonEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '備份 JSON ↗' }).click();
  const backup = JSON.parse((await downloadText(await jsonEvent)).toString());
  expect(backup.elements[0].id).toBe(before[0].id);
  expect(backup.elements[0].width).toBeGreaterThan(200);
  for (const kind of ['PNG', 'SVG']) {
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: kind, exact: true }).click();
    const bytes = await downloadText(await event);
    if (kind === 'PNG') expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    else expect(bytes.toString()).toContain('<svg');
  }
  await imported(page, scene([rectangle('restored', { strokeColor: '#e03131' })]));
  await expect.poll(async () => JSON.parse((await readDraft(page)).scene).elements[0].id).toBe('restored');
  await expect(page.getByRole('button', { name: '匯出恢復副本' })).toBeVisible();
  const recoveryEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '匯出恢復副本' }).click();
  expect(JSON.parse((await downloadText(await recoveryEvent)).toString()).elements[0].id).toBe(before[0].id);
  await page.screenshot({ path: info.outputPath('flowa-canvas.png'), fullPage: true });
});

test('invalid import preserves existing draft and scene', { tag: '@cross-browser' }, async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
  await imported(page, scene());
  await expect.poll(async () => JSON.parse((await readDraft(page)).scene).elements[0]?.id).toBe('original');
  await imported(page, scene([rectangle('duplicate'), rectangle('duplicate')]));
  await expect(page.getByRole('alert')).toContainText('重複');
  expect(JSON.parse((await readDraft(page)).scene).elements[0].id).toBe('original');
});

test('another tab cannot overwrite a newer draft', { tag: '@cross-browser' }, async ({ page, context }) => {
  await page.goto('/'); await expect(page.getByRole('status')).toHaveText('已存於此裝置');
  const second = await context.newPage(); await second.goto('/');
  await expect(second.getByRole('status')).toHaveText('已存於此裝置');
  await imported(page, scene([rectangle('first-tab')]));
  await expect.poll(async () => JSON.parse((await readDraft(page)).scene).elements[0]?.id).toBe('first-tab');
  await imported(second, scene([rectangle('stale-tab')]));
  await expect(second.getByRole('alert')).toContainText('另一個分頁');
  expect(JSON.parse((await readDraft(page)).scene).elements[0].id).toBe('first-tab');
});

test('corrupt local draft is preserved and never replaced with blank data', { tag: '@cross-browser' }, async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('status')).toHaveText('已存於此裝置');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('flowa'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('boards', 'readwrite'); tx.objectStore('boards').put('broken JSON', 'draft'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  });
  await page.reload(); await expect(page.getByRole('alert')).toContainText('原資料');
  expect(await readDraft(page)).toBe('broken JSON');
});

test('storage failure shows failure until retry commits successfully', { tag: '@cross-browser' }, async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).failFlowaSave = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'boards' && (window as any).failFlowaSave) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('儲存失敗');
  expect(await readDraft(page)).toBeUndefined();
  await page.evaluate(() => { (window as any).failFlowaSave = false; });
  await page.getByRole('button', { name: '重試儲存' }).click();
  await expect(page.getByRole('status')).toHaveText('已存於此裝置');
  expect((await readDraft(page)).revision).toBe(1);
});

test('JSON backup restores in a clean browser and retains deleted elements', { tag: '@cross-browser' }, async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await page.goto('/'); await expect(page.getByRole('button', { name: '匯入 JSON', exact: true })).toBeEnabled();
    await imported(page, scene([rectangle('visible'), rectangle('deleted', { isDeleted: true, index: 'a1' })]));
    await expect.poll(async () => JSON.parse((await readDraft(page)).scene).elements.length).toBe(2);
    await page.reload(); await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: '備份 JSON ↗' }).click();
    const data = JSON.parse((await downloadText(await event)).toString());
    expect(data.elements.find((element: any) => element.id === 'deleted').isDeleted).toBe(true);
  } finally { await context.close(); }
});
