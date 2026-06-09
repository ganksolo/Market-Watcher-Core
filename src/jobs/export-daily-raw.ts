import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { resolveHandle, getArg } from '../utils/cli';
import { logger } from '../utils/logger';
import { nowISO } from '../utils/date';
import { getWatchAccount } from '../services/account-service';
import { getPostsByHandleAndDate } from '../services/post-service';
import { db } from '../db';
import { rawArchives } from '../db/schema';

dotenv.config();

function main(): void {
  const handle = resolveHandle();
  const date = getArg('date');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    logger.error({ date }, 'Invalid or missing --date argument (expected YYYY-MM-DD)');
    process.exit(1);
  }

  const account = getWatchAccount(handle);
  if (!account) {
    logger.error({ handle }, 'Account not found — run pnpm x:resolve first');
    process.exit(1);
  }

  const posts = getPostsByHandleAndDate(handle, date);

  if (posts.length === 0) {
    logger.info({ handle, date }, 'No posts for this date');
    return;
  }

  const ndjsonDir = path.resolve(`exports/raw/${handle}`);
  const mdDir = path.resolve(`exports/daily/${handle}`);
  fs.mkdirSync(ndjsonDir, { recursive: true });
  fs.mkdirSync(mdDir, { recursive: true });

  const ndjsonPath = path.join(ndjsonDir, `${date}.ndjson`);
  const mdPath = path.join(mdDir, `${date}.md`);

  const ndjsonContent = posts.map(p => p.rawJson).join('\n') + '\n';
  fs.writeFileSync(ndjsonPath, ndjsonContent, 'utf-8');

  const lines: string[] = [`# @${handle} — ${date} (${posts.length} posts)`, ''];
  for (const post of posts) {
    const time = post.createdAt.slice(11, 16);
    const rawText = post.text.replace(/\n/g, ' ');
    const text = rawText.length > 280 ? rawText.slice(0, 277) + '...' : rawText;
    const url = post.url ?? `https://x.com/${handle}/status/${post.tweetId}`;
    lines.push(`- ${time} [↗](${url}) ${text}`);
  }
  fs.writeFileSync(mdPath, lines.join('\n') + '\n', 'utf-8');

  db.insert(rawArchives)
    .values({
      accountHandle: handle,
      archiveDate: date,
      filePath: ndjsonPath,
      postCount: posts.length,
      createdAt: nowISO(),
    })
    .run();

  logger.info({ handle, date, postCount: posts.length, ndjsonPath, mdPath }, 'Export complete');
}

main();
