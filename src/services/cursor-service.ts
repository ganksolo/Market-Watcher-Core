import { eq } from 'drizzle-orm';
import { db } from '../db';
import { fetchCursors } from '../db/schema';

export function initCursor(handle: string, updatedAt: string): void {
  db.insert(fetchCursors)
    .values({ accountHandle: handle, updatedAt })
    .onConflictDoNothing()
    .run();
}

export function getCursor(handle: string) {
  return db
    .select()
    .from(fetchCursors)
    .where(eq(fetchCursors.accountHandle, handle))
    .get();
}
