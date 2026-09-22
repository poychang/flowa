import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';

export const MAX_SCENE_BYTES = 10 * 1024 * 1024;
export const MAX_RECOVERY_COPIES = 3;
export interface Draft { schemaVersion: 1; revision: number; scene: string; }
export class DraftConflictError extends Error {
  constructor() { super('另一個分頁已更新草稿。請先匯出目前內容，再重新載入。'); }
}
function decode(value: unknown): Draft | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return { schemaVersion: 1, revision: 0, scene: value };
  const draft = value as Partial<Draft>;
  if (!draft || draft.schemaVersion !== 1 || !Number.isSafeInteger(draft.revision) || draft.revision! < 1 || typeof draft.scene !== 'string') {
    throw new Error('無法讀取此版本的草稿；原資料已保留。');
  }
  return draft as Draft;
}

export class BoardRepository {
  private db?: Promise<IDBPDatabase>;
  constructor(private name = 'flowa', private boardKey = 'draft') {}
  private open() {
    return this.db ??= openDB(this.name, 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards');
        if (!db.objectStoreNames.contains('recoveries')) db.createObjectStore('recoveries', { autoIncrement: true });
      },
      blocking: () => { void this.close(); },
    });
  }
  async read(): Promise<Draft | undefined> { return decode(await (await this.open()).get('boards', this.boardKey)); }
  async write(scene: string, expectedRevision: number, backup = false): Promise<Draft> {
    if (new TextEncoder().encode(scene).byteLength > MAX_SCENE_BYTES) throw new Error('畫布超過 10 MB，請匯出備份後縮減內容。');
    const db = await this.open();
    const tx = db.transaction(['boards', 'recoveries'], 'readwrite');
    try {
      const previous = decode(await tx.objectStore('boards').get(this.boardKey));
      if ((previous?.revision ?? 0) !== expectedRevision) throw new DraftConflictError();
      if (backup && previous) {
        await tx.objectStore('recoveries').add({ ...previous, boardKey: this.boardKey, createdAt: Date.now() });
        const allKeys = await tx.objectStore('recoveries').getAllKeys();
        const copies = await tx.objectStore('recoveries').getAll();
        const keys = allKeys.filter((_key, index) => (copies[index].boardKey ?? 'draft') === this.boardKey);
        for (const key of keys.slice(0, -MAX_RECOVERY_COPIES)) await tx.objectStore('recoveries').delete(key);
        // Also bound recovery storage across many different room identifiers.
        const remainingKeys = await tx.objectStore('recoveries').getAllKeys();
        const remaining = await tx.objectStore('recoveries').getAll();
        let total = remaining.reduce((bytes, copy) => bytes + new TextEncoder().encode(copy.scene).byteLength, 0);
        let count = remaining.length;
        for (let index = 0; index < remaining.length && (count > 12 || total > 3 * MAX_SCENE_BYTES); index++) {
          await tx.objectStore('recoveries').delete(remainingKeys[index]);
          total -= new TextEncoder().encode(remaining[index].scene).byteLength; count--;
        }
      }
      const draft: Draft = { schemaVersion: 1, revision: expectedRevision + 1, scene };
      await tx.objectStore('boards').put(draft, this.boardKey);
      await tx.done;
      return draft;
    } catch (error) {
      try { tx.abort(); } catch { /* Transaction may already be aborted. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
  async latestRecovery(): Promise<string | undefined> {
    const copies = await (await this.open()).getAll('recoveries');
    return copies.filter(copy => (copy.boardKey ?? 'draft') === this.boardKey).at(-1)?.scene;
  }
  async close() { if (this.db) { (await this.db).close(); this.db = undefined; } }
}
export const repository = new BoardRepository();
