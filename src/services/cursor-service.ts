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

export function updateCursor(
  handle: string,
  patch: {
    latestTweetId?: string;
    latestTweetCreatedAt?: string;
    oldestTweetId?: string;
    oldestTweetCreatedAt?: string;
    lastPaginationToken?: string | null;
    backfillCompleted?: number;
    updatedAt: string;
  },
): void {
  db.update(fetchCursors).set(patch).where(eq(fetchCursors.accountHandle, handle)).run();
}
