import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { rectangle } from './fixtures';

declare global { interface Window { harness: any; } }
async function open(page: Page, peer: string) {
  await page.goto(`/tests/browser/harness.html?peer=${peer}`);
  await page.waitForFunction(() => Boolean(window.harness));
  await expect(page.getByTitle('長方形 — R 或 2', { exact: true })).toBeVisible();
}
async function replace(page: Page, elements: any[]) {
  await page.evaluate(elements => window.harness.replace(elements), elements);
  await expect.poll(() => page.evaluate(() => window.harness.scene().length)).toBe(elements.length);
}
async function transfer(from: Page, to: Page) {
  const packet = await from.evaluate(() => window.harness.delta());
  if (packet) {
    const result = await to.evaluate(packet => window.harness.receive(packet), packet);
    if (result !== 'deferred') await from.evaluate(id => window.harness.ack(id), packet.id);
  }
  return packet;
}
// Compare serialized document content; JSON normalizes -0 and drops undefined.
const snapshot = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.harness.scene())));

test('two independent contexts converge concurrent color/delete updates, duplicates and stale reconnect', async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await ca.newPage(), b = await cb.newPage();
  try {
    await open(a, 'A'); await open(b, 'B');
    await replace(a, [rectangle('shared')]); await transfer(a, b);
    await replace(a, [rectangle('shared', { version: 2, versionNonce: 50, strokeColor: '#e03131' })]);
    await replace(b, [rectangle('shared', { version: 2, versionNonce: 20, isDeleted: true })]);
    const pa = await a.evaluate(() => window.harness.delta());
    const pb = await b.evaluate(() => window.harness.delta());
    await a.evaluate(packet => window.harness.receive(packet), pb);
    await b.evaluate(packet => window.harness.receive(packet), pa);
    await a.evaluate(id => window.harness.ack(id), pa.id); await b.evaluate(id => window.harness.ack(id), pb.id);
    expect(await snapshot(a)).toEqual(await snapshot(b));
    expect((await snapshot(a))[0].isDeleted).toBe(true);
    expect(await a.evaluate(packet => window.harness.receive(packet), pb)).toBe('duplicate');
    // A disconnected peer retransmits an older version with a fresh message id.
    await a.evaluate(packet => window.harness.receive(packet), { ...pa, id: 'old-reconnect', sender: 'C', elements: [rectangle('shared')] });
    expect((await snapshot(a))[0].isDeleted).toBe(true);
    expect(JSON.parse(await a.evaluate(() => window.harness.backup())).elements[0].isDeleted).toBe(true);
    expect(await a.evaluate(() => window.harness.delta())).toBeUndefined();
  } finally { await ca.close(); await cb.close(); }
});

test('remote updates preserve unsent local additions and local Undo preserves remote work', async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await ca.newPage(), b = await cb.newPage();
  try {
    await open(a, 'A'); await open(b, 'B');
    await replace(a, [rectangle('local', { index: 'a0' })]);
    await replace(b, [rectangle('remote', { index: 'a1', x: 450 })]);
    await transfer(b, a);
    const delta = await a.evaluate(() => window.harness.delta());
    expect(delta.elements.map((element: any) => element.id)).toEqual(['local']);
    await a.getByRole('button', { name: '復原', exact: true }).click();
    await expect.poll(async () => (await snapshot(a)).filter((element: any) => !element.isDeleted).map((element: any) => element.id)).toEqual(['remote']);
    await a.getByRole('button', { name: '重做', exact: true }).click();
    await expect.poll(async () => (await snapshot(a)).filter((element: any) => !element.isDeleted).length).toBe(2);
  } finally { await ca.close(); await cb.close(); }
});

test('bound text and connector bindings survive synchronization; changed elements only', async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await ca.newPage(), b = await cb.newPage();
  try {
    await open(a, 'A'); await open(b, 'B');
    const flow = await a.evaluate(() => window.harness.makeFlow());
    await replace(a, flow); await transfer(a, b);
    expect(await snapshot(a)).toEqual(await snapshot(b));
    const initial = await snapshot(a);
    expect(initial.find((element: any) => element.type === 'arrow').endBinding.elementId).toBe('node-b');
    const changed = initial.map((element: any) => element.type === 'text' ? { ...element, text: '下一步', originalText: '下一步', version: element.version + 1, versionNonce: 1234, strokeColor: '#e03131' } : element);
    await replace(a, changed);
    const packet = await transfer(a, b);
    expect(packet.elements.every((element: any) => element.type === 'text')).toBe(true);
    expect(await snapshot(a)).toEqual(await snapshot(b));
    expect(await b.evaluate(() => window.harness.delta())).toBeUndefined();
  } finally { await ca.close(); await cb.close(); }
});

test('active drag buffers updates and invalid protocol/session/payload cannot mutate scene', async ({ page }) => {
  await open(page, 'A');
  const packet = { protocol: 1, session: 'poc-session', sender: 'B', id: 'message-1', elements: [rectangle('remote')] };
  await page.evaluate(() => window.harness.busy(true));
  expect(await page.evaluate(packet => window.harness.receive(packet), packet)).toBe('deferred');
  expect(await snapshot(page)).toEqual([]);
  await page.evaluate(() => { window.harness.busy(false); });
  await page.evaluate(() => window.harness.flush());
  expect((await snapshot(page))[0].id).toBe('remote');
  for (const bad of [{ ...packet, protocol: 2 }, { ...packet, session: 'other' }, { ...packet, elements: [rectangle('bad', { text: 'x'.repeat(256 * 1024) })] }]) {
    expect(await page.evaluate(packet => { try { window.harness.receive(packet); return false; } catch { return true; } }, bad)).toBe(true);
  }
  expect((await snapshot(page))[0].id).toBe('remote');
});

test('Undo on a shared object keeps a later remote color change', async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await ca.newPage(), b = await cb.newPage();
  try {
    await open(a, 'A'); await open(b, 'B');
    const seed = { protocol: 1, session: 'poc-session', sender: 'seed', id: 'seed', elements: [rectangle('shared')] };
    await a.evaluate(packet => window.harness.receive(packet), seed);
    await b.evaluate(packet => window.harness.receive(packet), seed);
    await replace(a, [rectangle('shared', { x: 300, version: 2, versionNonce: 20 })]);
    await transfer(a, b);
    const received = await snapshot(b);
    await replace(b, [{ ...received[0], strokeColor: '#e03131', version: 3, versionNonce: 30 }]);
    await transfer(b, a);
    await a.getByRole('button', { name: '復原', exact: true }).click();
    await expect.poll(async () => (await snapshot(a))[0].x).toBe(200);
    expect((await snapshot(a))[0].strokeColor).toBe('#e03131');
    expect((await snapshot(a))[0].isDeleted).toBe(false);
    await transfer(a, b);
    expect(await snapshot(a)).toEqual(await snapshot(b));
  } finally { await ca.close(); await cb.close(); }
});

test('concurrent inserts with the same order index converge and reordering propagates', async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await ca.newPage(), b = await cb.newPage();
  try {
    await open(a, 'A'); await open(b, 'B');
    await replace(a, [rectangle('a')]); await replace(b, [rectangle('b')]);
    const pa = await a.evaluate(() => window.harness.delta()), pb = await b.evaluate(() => window.harness.delta());
    await a.evaluate(packet => window.harness.receive(packet), pb); await b.evaluate(packet => window.harness.receive(packet), pa);
    await a.evaluate(id => window.harness.ack(id), pa.id); await b.evaluate(id => window.harness.ack(id), pb.id);
    // Fractional-index repair creates new versions. Exchange those deltas too.
    for (let round = 0; round < 4; round++) { await transfer(a, b); await transfer(b, a); }
    expect(await snapshot(a)).toEqual(await snapshot(b));
    expect(await a.evaluate(() => window.harness.delta())).toBeUndefined();
    expect(await b.evaluate(() => window.harness.delta())).toBeUndefined();
    const reordered = (await snapshot(a)).reverse().map((element: any, index: number) => ({ ...element, index: `a${index}`, version: element.version + 1, versionNonce: 100 + index }));
    await replace(a, reordered); await transfer(a, b);
    expect(await snapshot(a)).toEqual(await snapshot(b));
    expect((await snapshot(b)).map((element: any) => element.id)).toEqual(['b', 'a']);
  } finally { await ca.close(); await cb.close(); }
});

test('lost acknowledgement resends data and deferred buffer is bounded', async ({ page }) => {
  await open(page, 'A'); await replace(page, [rectangle('local')]);
  const first = await page.evaluate(() => window.harness.delta());
  expect(await page.evaluate(() => window.harness.delta())).toEqual(first);
  await page.evaluate(id => window.harness.ack(id), first.id);
  expect(await page.evaluate(() => window.harness.delta())).toBeUndefined();
  await page.evaluate(() => window.harness.busy(true));
  for (let i = 0; i < 4; i++) {
    const packet = { protocol: 1, session: 'poc-session', sender: 'B', id: `buffer-${i}`, elements: [rectangle('remote', { version: i + 1 })] };
    expect(await page.evaluate(packet => window.harness.receive(packet), packet)).toBe('deferred');
  }
  const packet = { protocol: 1, session: 'poc-session', sender: 'B', id: 'overflow', elements: [] };
  expect(await page.evaluate(packet => { try { window.harness.receive(packet); return ''; } catch (error) { return (error as Error).message; } }, packet)).toBe('resync-required');
  expect((await snapshot(page)).map((element: any) => element.id)).toEqual(['local']);
});

test('same revision with conflicting content is rejected without data loss', async ({ page }) => {
  await open(page, 'A'); await replace(page, [rectangle('shared')]);
  const packet = { protocol: 1, session: 'poc-session', sender: 'B', id: 'collision', elements: [rectangle('shared', { strokeColor: '#e03131' })] };
  expect(await page.evaluate(packet => { try { window.harness.receive(packet); return ''; } catch (error) { return (error as Error).message; } }, packet)).toBe('conflicting-revision');
  expect((await snapshot(page))[0].strokeColor).toBe('#236b59');
});
