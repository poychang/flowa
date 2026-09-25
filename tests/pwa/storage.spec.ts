import { test, expect } from '@playwright/test';

test('persistent-storage denial is honest and does not prevent editing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { value: async () => false });
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => false });
  });
  await page.request.post('/__test__/release'); await page.goto('/');
  await page.getByRole('button', { name: '保護本機儲存' }).click();
  await expect(page.getByTestId('pwa-message')).toContainText('未允許持續保存');
  await expect(page.getByRole('button', { name: '備份 JSON ↗' })).toBeEnabled();
});

test('first offline installation failure can be retried without clearing the draft', async ({ page }) => {
  await page.request.post('/__test__/release?broken=1'); await page.goto('/');
  await expect(page.getByTestId('pwa-message')).toContainText('離線資源準備失敗', { timeout: 60000 });
  await expect(page.getByTestId('offline-status')).not.toHaveText('離線可用');
  await page.request.post('/__test__/release');
  await page.getByRole('button', { name: '檢查更新', exact: true }).click();
  await expect(page.getByTestId('offline-status')).toHaveText('離線可用', { timeout: 60000 });
});
