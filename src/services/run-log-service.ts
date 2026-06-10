import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { fetchRuns } from '../db/schema';

export function createRun(
  runType: string,
  handle: string,
  startedAt: string,
): number {
  const result = db
    .insert(fetchRuns)
    .values({ runType, accountHandle: handle, startedAt, status: 'running' })
    .run();
  return Number(result.lastInsertRowid);
}

export function finishRun(
  id: number,
  patch: {
    finishedAt?: string;
    status?: string;
    requestedPages?: number;
    fetchedPosts?: number;
    insertedPosts?: number;
    duplicatedPosts?: number;
    estimatedPostReads?: number;
    estimatedUserReads?: number;
    estimatedCostUsd?: number;
    errorMessage?: string;
    rawLogPath?: string;
  },
): void {
  db.update(fetchRuns).set(patch).where(eq(fetchRuns.id, id)).run();
}

export function getLatestRun(handle: string) {
  return db
    .select()
    .from(fetchRuns)
    .where(eq(fetchRuns.accountHandle, handle))
    .orderBy(desc(fetchRuns.id))
    .limit(1)
    .get();
}

export function getLatestFailedRun(handle: string) {
  return db
    .select()
    .from(fetchRuns)
    .where(and(eq(fetchRuns.accountHandle, handle), eq(fetchRuns.status, 'failed')))
    .orderBy(desc(fetchRuns.id))
    .limit(1)
    .get();
}

export function getLatestRunByType(handle: string, runType: string) {
  return db
    .select()
    .from(fetchRuns)
    .where(and(eq(fetchRuns.accountHandle, handle), eq(fetchRuns.runType, runType)))
    .orderBy(desc(fetchRuns.id))
    .limit(1)
    .get();
}
