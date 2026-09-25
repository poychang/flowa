import { test, expect, type Page } from '@playwright/test';
import type { Draft } from '../../apps/web/src/storage.ts';

async function draw(page: Page) {
  await page.getByTitle('長方形 — R 或 2', { exact: true }).click();
  await page.mouse.move(650, 450); await page.mouse.down(); await page.mouse.move(800, 550, { steps: 5 }); await page.mouse.up();
}

async function draft(page: Page): Promise<Draft | undefined> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('flowa');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('blocked'));
    });
    return new Promise<Draft | undefined>((resolve, reject) => {
      const tx = db.transaction('boards');
      tx.onerror = () => reject(tx.error);
      const r = tx.objectStore('boards').get('draft');
      r.onsuccess = () => { db.close(); resolve(r.result); };
      r.onerror = () => reject(r.error);
    });
  });
}

test('persistent-storage denial is honest and does not prevent editing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { value: async () => false });
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => false });
  });
  await page.request.post('/__test__/release'); await page.goto('/');
  await page.getByRole('button', { name: '保護本機儲存' }).click();
  await expect(page.getByTestId('pwa-message')).toContainText('未允許持續保存');
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  await draw(page);
  await expect.poll(async () => JSON.parse((await draft(page))?.scene ?? '{"elements":[]}').elements.length).toBe(1);
});

test('first offline installation failure can be retried without clearing the draft', async ({ page }) => {
  await page.request.post('/__test__/release?broken=1'); await page.goto('/');
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
  await draw(page);
  await expect.poll(async () => JSON.parse((await draft(page))?.scene ?? '{"elements":[]}').elements.length).toBe(1);
  const saved = await draft(page);
  expect(saved).toBeDefined();
  if (!saved) throw new Error('Expected saved draft');
  await expect(page.getByTestId('pwa-message')).toContainText('離線資源準備失敗', { timeout: 60000 });
  await expect(page.getByTestId('offline-status')).not.toHaveText('離線可用');
  expect(await draft(page)).toMatchObject({ revision: saved.revision, scene: saved.scene });
  await page.request.post('/__test__/release');
  await page.getByRole('button', { name: '檢查更新', exact: true }).click();
  await expect(page.getByTestId('offline-status')).toHaveText('離線可用', { timeout: 60000 });
  expect(await draft(page)).toMatchObject({ revision: saved.revision, scene: saved.scene });
});
