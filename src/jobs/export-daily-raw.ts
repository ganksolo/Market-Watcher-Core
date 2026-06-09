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

  try {
    const ndjsonDir = path.resolve(`exports/raw/${handle}`);
    const mdDir = path.resolve(`exports/daily/${handle}`);
    fs.mkdirSync(ndjsonDir, { recursive: true });
    fs.mkdirSync(mdDir, { recursive: true });

    const ndjsonPath = path.join(ndjsonDir, `${date}.ndjson`);
    const mdPath = path.join(mdDir, `${date}.md`);

    const ndjsonContent = posts.map(p => {
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(p.rawJson);
      } catch {
        throw new Error(`Failed to parse rawJson for tweet ${p.tweetId}`);
      }
      return JSON.stringify({
        tweet_id: p.tweetId,
        author_handle: p.authorHandle,
        created_at: p.createdAt,
        text: p.text,
        url: p.url ?? `https://x.com/${p.authorHandle}/status/${p.tweetId}`,
        type: p.referencedType ?? 'tweet',
        referenced_tweet_id: p.referencedTweetId ?? null,
        public_metrics: {
          like_count: p.likeCount,
          reply_count: p.replyCount,
          retweet_count: p.repostCount,
          quote_count: p.quoteCount,
          bookmark_count: p.bookmarkCount,
          impression_count: p.impressionCount,
        },
        raw_json: parsedRaw,
      });
    }).join('\n') + '\n';
    fs.writeFileSync(ndjsonPath, ndjsonContent, 'utf-8');

    const lines: string[] = [`# @${handle} — ${date} (${posts.length} posts)`, ''];
    for (const post of posts) {
      const type = post.referencedType ?? 'tweet';
      const url = post.url ?? `https://x.com/${post.authorHandle}/status/${post.tweetId}`;
      const rawText = post.text.replace(/\n/g, ' ');
      const text = rawText.length > 280 ? rawText.slice(0, 277) + '...' : rawText;
      lines.push(`- ${post.createdAt} \`${post.tweetId}\` [↗](${url}) [${type}] ${text}`);
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
  } catch (err) {
    logger.error({ err }, 'export-daily-raw failed');
    process.exit(1);
  }
}

main();
