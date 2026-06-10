import dotenv from 'dotenv';
import { eq, count } from 'drizzle-orm';
import { resolveHandle } from '../utils/cli';
import { getWatchAccount } from '../services/account-service';
import { markCursorBackfillCoverage, repairCursorCoverageIfMissing } from '../services/cursor-service';
import { getLatestRun, getLatestFailedRun, getLatestRunByType } from '../services/run-log-service';
import { assessBackfillCoverage } from '../services/coverage-service';
import { db } from '../db';
import { xPosts } from '../db/schema';
import { prettifyErrorMessage } from '../utils/format';
import { nowISO } from '../utils/date';

dotenv.config();

function main(): void {
  const handle = resolveHandle();

  const account = getWatchAccount(handle);
  const cursor = repairCursorCoverageIfMissing(handle);
  const latestRun = getLatestRun(handle);
  const failedRun = getLatestFailedRun(handle);
  const latestBackfillRun = getLatestRunByType(handle, 'backfill');

  const countResult = db
    .select({ value: count() })
    .from(xPosts)
    .where(eq(xPosts.authorHandle, handle))
    .get();
  const postCount = countResult?.value ?? 0;
  const coverage = assessBackfillCoverage({
    handle,
    requestedPages: latestBackfillRun?.requestedPages ?? 0,
    endedWithoutNextToken: cursor?.backfillCompleted === 1,
  });

  if (cursor && coverage.suspicious && cursor.backfillSuspicious !== 1) {
    markCursorBackfillCoverage({
      handle,
      suspicious: true,
      warning: coverage.warning,
      updatedAt: nowISO(),
    });
    cursor.backfillSuspicious = 1;
    cursor.backfillWarning = coverage.warning;
  }

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

  if (cursor?.backfillSuspicious === 1 || coverage.suspicious) {
    lines.push('Coverage: suspicious');
    lines.push(`Coverage note: ${cursor?.backfillWarning ?? coverage.warning ?? 'pagination ended early'}`);
    lines.push('');
  }

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
