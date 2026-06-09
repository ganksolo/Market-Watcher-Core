import dotenv from 'dotenv';
import { eq, count } from 'drizzle-orm';
import { resolveHandle } from '../utils/cli';
import { getWatchAccount } from '../services/account-service';
import { getCursor } from '../services/cursor-service';
import { getLatestRun } from '../services/run-log-service';
import { db } from '../db';
import { xPosts } from '../db/schema';

dotenv.config();

function main(): void {
  const handle = resolveHandle();

  const account = getWatchAccount(handle);
  const cursor = getCursor(handle);
  const latestRun = getLatestRun(handle);

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

  const lines = [
    `Account:   @${handle}`,
    `User ID:   ${account?.xUserId ?? 'not resolved'}`,
    `Posts:     ${postCount} total`,
    `Backfill:  ${cursor ? backfillStatus : 'not started'}`,
    `Latest:    ${cursor?.latestTweetId ?? 'n/a'}`,
    `Oldest:    ${cursor?.oldestTweetId ?? 'n/a'}`,
    '',
  ];

  if (latestRun) {
    lines.push(
      `Last run:  ${latestRun.runType} · ${latestRun.status} · ${latestRun.insertedPosts ?? 0} inserted · ${latestRun.startedAt}`,
    );
  } else {
    lines.push('Last run:  no runs yet');
  }

  console.log(lines.join('\n'));
}

main();
