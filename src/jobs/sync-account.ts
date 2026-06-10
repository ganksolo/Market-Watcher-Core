import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { resolveHandle, getArg, checkAccountEnabled } from '../utils/cli';
import { classifyError } from '../utils/classify-error';
import { logger } from '../utils/logger';
import { nowISO } from '../utils/date';
import { sleep } from '../utils/sleep';
import { createXApiClient } from '../clients/x-api-client';
import type { XApiListResponse, XTweet } from '../clients/x-api-types';
import { getWatchAccount } from '../services/account-service';
import { getCursor, updateCursor } from '../services/cursor-service';
import { upsertPost } from '../services/post-service';
import { createRun, finishRun } from '../services/run-log-service';

dotenv.config();

const TWEET_FIELDS = [
  'id', 'text', 'created_at', 'author_id', 'conversation_id',
  'in_reply_to_user_id', 'lang', 'public_metrics', 'referenced_tweets',
].join(',');

async function main(): Promise<void> {
  const handle = resolveHandle();
  checkAccountEnabled(handle);
  const maxPagesArg = getArg('max-pages');

  const cursor = getCursor(handle);
  if (!cursor?.latestTweetId) {
    logger.error({ handle }, 'Backfill not completed — run pnpm x:backfill first');
    process.exit(1);
  }

  const account = getWatchAccount(handle);
  if (!account?.xUserId) {
    logger.error({ handle }, 'No x_user_id found — run pnpm x:resolve first');
    process.exit(1);
  }
  const xUserId = account.xUserId;

  let runId: number | undefined = undefined;
  let p: {
    maxResultsPerPage: number;
    maxPagesPerRun: number;
    maxPostsPerRun: number;
    includeReplies: boolean;
    includeRetweets: boolean;
    includeQuotes: boolean;
    sleepMsBetweenRequests: number;
    estimatedPostReadCost: number;
    maxEstimatedCostPerRun: number;
  } | undefined = undefined;
  let pagesCount = 0;
  let insertedPosts = 0;
  let duplicatedPosts = 0;
  let totalEstimatedPostReads = 0;

  try {
    runId = createRun('sync', handle, nowISO());

    const policyPath = path.resolve('config/fetch-policy.json');
    const policy: {
      default: {
        maxResultsPerPage: number;
        maxPagesPerRun: number;
        maxPostsPerRun: number;
        includeReplies: boolean;
        includeRetweets: boolean;
        includeQuotes: boolean;
        sleepMsBetweenRequests: number;
        estimatedPostReadCost: number;
        maxEstimatedCostPerRun: number;
      };
    } = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
    p = policy.default;
    const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;
    const maxPostsPerRun = p.maxPostsPerRun;

    const client = createXApiClient();

    const excludeParts: string[] = [];
    if (!p.includeRetweets) excludeParts.push('retweets');
    if (!p.includeReplies) excludeParts.push('replies');

    const baseParams: Record<string, string> = {
      'tweet.fields': TWEET_FIELDS,
      max_results: String(p.maxResultsPerPage),
      since_id: cursor.latestTweetId,
    };
    if (excludeParts.length) baseParams.exclude = excludeParts.join(',');

    let newestId: string | undefined = undefined;
    let currentPaginationToken: string | undefined;
    let firstPageTweets: XTweet[] = [];

    logger.info({ handle, xUserId, maxPages, sinceId: cursor.latestTweetId }, 'Starting sync');

    while (true) {
      // Posts limit check
      const totalFetched = insertedPosts + duplicatedPosts;
      const remaining = maxPostsPerRun - totalFetched;
      // X API GET /2/users/:id/tweets requires max_results >= 5
      const API_MIN_RESULTS = 5;
      if (remaining <= 0 || remaining < API_MIN_RESULTS) {
        logger.info({ handle, totalFetched, maxPostsPerRun }, 'Posts limit reached');
        finishRun(runId, {
          status: 'stopped_by_posts_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: totalFetched,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: totalEstimatedPostReads,
          estimatedCostUsd: totalEstimatedPostReads * p.estimatedPostReadCost,
        });
        return;
      }

      // Compute this page's request size (trimmed to remaining quota)
      const actualMaxResults = Math.min(p.maxResultsPerPage, remaining);

      // Cost check (per-page, based on actualMaxResults)
      const estimatedCostIfWeGoAhead =
        (totalEstimatedPostReads + actualMaxResults) * p.estimatedPostReadCost;
      if (estimatedCostIfWeGoAhead > p.maxEstimatedCostPerRun) {
        logger.warn({ handle, estimatedCostIfWeGoAhead, maxEstimatedCostPerRun: p.maxEstimatedCostPerRun }, 'Cost limit reached');
        finishRun(runId, {
          status: 'stopped_by_cost_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: totalFetched,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: totalEstimatedPostReads,
          estimatedCostUsd: totalEstimatedPostReads * p.estimatedPostReadCost,
        });
        return;
      }

      if (pagesCount >= maxPages) {
        logger.info({ handle, pagesCount }, 'Page limit reached');
        finishRun(runId, {
          status: 'stopped_by_page_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: totalFetched,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: totalEstimatedPostReads,
          estimatedCostUsd: totalEstimatedPostReads * p.estimatedPostReadCost,
        });
        return;
      }

      // Commit to this page
      totalEstimatedPostReads += actualMaxResults;

      const params: Record<string, string> = { ...baseParams };
      params.max_results = String(actualMaxResults);
      if (currentPaginationToken) params.pagination_token = currentPaginationToken;

      logger.info({ handle, page: pagesCount + 1 }, 'Fetching sync page');

      const response = await client.get<XApiListResponse<XTweet>>(
        `/users/${xUserId}/tweets`,
        params,
      );

      const tweets = response.data ?? [];
      const meta = response.meta;

      if (pagesCount === 0 && tweets.length === 0) {
        finishRun(runId, {
          status: 'success',
          finishedAt: nowISO(),
          requestedPages: 0,
          fetchedPosts: 0,
          insertedPosts: 0,
          duplicatedPosts: 0,
          estimatedPostReads: 0,
          estimatedCostUsd: 0,
        });
        logger.info({ handle }, 'Already up to date');
        return;
      }

      if (pagesCount === 0 && meta?.newest_id) {
        newestId = meta.newest_id;
      }

      if (pagesCount === 0) {
        firstPageTweets = tweets;
      }

      const pageNow = nowISO();
      for (const tweet of tweets) {
        if (!p.includeQuotes && tweet.referenced_tweets?.[0]?.type === 'quoted') continue;

        const result = upsertPost({
          tweetId: tweet.id,
          authorId: tweet.author_id ?? xUserId,
          authorHandle: handle,
          text: tweet.text,
          lang: tweet.lang ?? null,
          createdAt: tweet.created_at ?? pageNow,
          conversationId: tweet.conversation_id ?? null,
          inReplyToUserId: tweet.in_reply_to_user_id ?? null,
          referencedType: tweet.referenced_tweets?.[0]?.type ?? null,
          referencedTweetId: tweet.referenced_tweets?.[0]?.id ?? null,
          likeCount: tweet.public_metrics?.like_count ?? null,
          replyCount: tweet.public_metrics?.reply_count ?? null,
          repostCount: tweet.public_metrics?.retweet_count ?? null,
          quoteCount: tweet.public_metrics?.quote_count ?? null,
          bookmarkCount: tweet.public_metrics?.bookmark_count ?? null,
          impressionCount: tweet.public_metrics?.impression_count ?? null,
          url: `https://x.com/${handle}/status/${tweet.id}`,
          rawJson: JSON.stringify(tweet),
          firstFetchedAt: pageNow,
          lastFetchedAt: pageNow,
        });
        result.inserted ? insertedPosts++ : duplicatedPosts++;
      }

      pagesCount++;
      currentPaginationToken = meta?.next_token;

      logger.info(
        { handle, page: pagesCount, inserted: insertedPosts, duplicated: duplicatedPosts },
        'Page complete',
      );

      if (!currentPaginationToken) break;

      await sleep(p.sleepMsBetweenRequests);
    }

    if (newestId) {
      const latestCreatedAt = firstPageTweets[0]?.created_at;
      updateCursor(handle, {
        latestTweetId: newestId,
        ...(latestCreatedAt ? { latestTweetCreatedAt: latestCreatedAt } : {}),
        updatedAt: nowISO(),
      });
    }

    const finalCostUsd = totalEstimatedPostReads * p.estimatedPostReadCost;
    finishRun(runId, {
      status: 'success',
      finishedAt: nowISO(),
      requestedPages: pagesCount,
      fetchedPosts: insertedPosts + duplicatedPosts,
      insertedPosts,
      duplicatedPosts,
      estimatedPostReads: totalEstimatedPostReads,
      estimatedCostUsd: finalCostUsd,
    });

    logger.info(
      { handle, pagesCount, insertedPosts, duplicatedPosts, finalCostUsd },
      'Sync finished successfully',
    );
  } catch (err) {
    const { logMessage, errorMessage } = classifyError(err, { handle });
    if (logMessage) logger.error({ handle }, logMessage);

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
        requestedPages: pagesCount,
        fetchedPosts: insertedPosts + duplicatedPosts,
        insertedPosts,
        duplicatedPosts,
        estimatedPostReads: totalEstimatedPostReads,
        estimatedCostUsd: p != null
          ? totalEstimatedPostReads * p.estimatedPostReadCost
          : undefined,
      });
    }

    logger.error({ err }, 'sync-account failed');
    process.exit(1);
  }
}

main();
