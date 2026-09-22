import { openDB } from 'idb';
const db = openDB('flowa', 1, { upgrade(db) { db.createObjectStore('boards'); } });
export async function readBoard(): Promise<string | undefined> { return (await db).get('boards', 'draft'); }
export async function saveBoard(data: string) {
  const tx = (await db).transaction('boards', 'readwrite');
  await tx.store.put(data, 'draft');
  await tx.done;
}
