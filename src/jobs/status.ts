import dotenv from 'dotenv';
import { eq, count } from 'drizzle-orm';
import { resolveHandle } from '../utils/cli';
import { getWatchAccount } from '../services/account-service';
import { repairCursorCoverageIfMissing } from '../services/cursor-service';
import { getLatestRun, getLatestFailedRun } from '../services/run-log-service';
import { db } from '../db';
import { xPosts } from '../db/schema';
import { prettifyErrorMessage } from '../utils/format';

dotenv.config();

function main(): void {
  const handle = resolveHandle();

  const account = getWatchAccount(handle);
  const cursor = repairCursorCoverageIfMissing(handle);
  const latestRun = getLatestRun(handle);
  const failedRun = getLatestFailedRun(handle);

  const countResult = db
    .select({ value: count() })
    .from(xPosts)
    .where(eq(xPosts.authorHandle, handle))
    .get();
  const postCount = countResult?.value ?? 0;

  const backfillStatus =
    cursor?.backfillCompleted === 1
      ? 'completed ✓'
      : cursor?.latestTweetId
        ? 'in progress'
        : 'not started';

  const latestTime = cursor?.latestTweetCreatedAt ? ` (${cursor.latestTweetCreatedAt})` : '';
  const oldestTime = cursor?.oldestTweetCreatedAt ? ` (${cursor.oldestTweetCreatedAt})` : '';

  const lines = [
    `Account:   @${handle}`,
    `User ID:   ${account?.xUserId ?? 'not resolved'}`,
    `Posts:     ${postCount} total`,
    `Backfill:  ${cursor ? backfillStatus : 'not started'}`,
    `Latest:    ${cursor?.latestTweetId ?? 'n/a'}${latestTime}`,
    `Oldest:    ${cursor?.oldestTweetId ?? 'n/a'}${oldestTime}`,
    '',
  ];

  if (latestRun) {
    const cost =
      latestRun.estimatedCostUsd != null
        ? ` · $${latestRun.estimatedCostUsd.toFixed(2)}`
        : '';
    lines.push(
      `Last run:  ${latestRun.runType} · ${latestRun.status} · ${latestRun.insertedPosts ?? 0} inserted · ${latestRun.startedAt}${cost}`,
    );
  } else {
    lines.push('Last run:  no runs yet');
  }

  lines.push(`Last err:  ${failedRun ? prettifyErrorMessage(failedRun.errorMessage ?? 'n/a') : 'n/a'}`);

  console.log(lines.join('\n'));
}

main();
