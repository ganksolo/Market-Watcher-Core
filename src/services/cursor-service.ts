import { eq } from 'drizzle-orm';
import { db } from '../db';
import { fetchCursors } from '../db/schema';
import { getCoverageBoundsByHandle } from './post-service';

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
    backfillSuspicious?: number;
    backfillWarning?: string | null;
    updatedAt: string;
  },
): void {
  db.update(fetchCursors).set(patch).where(eq(fetchCursors.accountHandle, handle)).run();
}

export function repairCursorCoverageIfMissing(handle: string) {
  const cursor = getCursor(handle);
  if (!cursor) return null;

  const needsLatest = cursor.latestTweetId != null && !cursor.latestTweetCreatedAt;
  const needsOldest = cursor.oldestTweetId != null && !cursor.oldestTweetCreatedAt;

  if (!needsLatest && !needsOldest) {
    return cursor;
  }

  const bounds = getCoverageBoundsByHandle(handle);
  const patch: Parameters<typeof updateCursor>[1] = {
    updatedAt: cursor.updatedAt,
  };

  if (needsLatest && bounds.latestTweetCreatedAt) {
    patch.latestTweetCreatedAt = bounds.latestTweetCreatedAt;
    if (!cursor.latestTweetId && bounds.latestTweetId) {
      patch.latestTweetId = bounds.latestTweetId;
    }
  }

  if (needsOldest && bounds.oldestTweetCreatedAt) {
    patch.oldestTweetCreatedAt = bounds.oldestTweetCreatedAt;
    if (!cursor.oldestTweetId && bounds.oldestTweetId) {
      patch.oldestTweetId = bounds.oldestTweetId;
    }
  }

  if (Object.keys(patch).length > 1) {
    updateCursor(handle, patch);
    return getCursor(handle);
  }

  return cursor;
}

export function markCursorBackfillCoverage(params: {
  handle: string;
  suspicious: boolean;
  warning: string | null;
  updatedAt: string;
}) {
  updateCursor(params.handle, {
    backfillSuspicious: params.suspicious ? 1 : 0,
    backfillWarning: params.warning,
    updatedAt: params.updatedAt,
  });
}
