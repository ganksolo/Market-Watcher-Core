import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { resolveHandle, getArg } from '../utils/cli';
import { logger } from '../utils/logger';
import { nowISO } from '../utils/date';
import { sleep } from '../utils/sleep';
import { createXApiClient, ApiError } from '../clients/x-api-client';
import type { XApiListResponse, XTweet } from '../clients/x-api-types';
import { getWatchAccount } from '../services/account-service';
import { getCursor, initCursor, updateCursor } from '../services/cursor-service';
import { upsertPost } from '../services/post-service';
import { createRun, finishRun } from '../services/run-log-service';

dotenv.config();

const TWEET_FIELDS = [
  'id', 'text', 'created_at', 'author_id', 'conversation_id',
  'in_reply_to_user_id', 'lang', 'public_metrics', 'referenced_tweets',
].join(',');

async function main(): Promise<void> {
  const handle = resolveHandle();
  const maxPagesArg = getArg('max-pages');

  const policyPath = path.resolve('config/fetch-policy.json');
  const policy: {
    default: {
      maxResultsPerPage: number;
      maxPagesPerRun: number;
      includeReplies: boolean;
      includeRetweets: boolean;
      includeQuotes: boolean;
      sleepMsBetweenRequests: number;
      estimatedPostReadCost: number;
      maxEstimatedCostPerRun: number;
    };
  } = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));

  const p = policy.default;
  const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : p.maxPagesPerRun;

  const cursor = getCursor(handle);
  if (cursor?.backfillCompleted === 1) {
    logger.info({ handle }, 'Backfill already completed, nothing to do');
    return;
  }

  const account = getWatchAccount(handle);
  if (!account?.xUserId) {
    logger.error({ handle }, 'No x_user_id found — run pnpm x:resolve first');
    process.exit(1);
  }
  const xUserId = account.xUserId;

  let runId: number | undefined = undefined;

  try {
    runId = createRun('backfill', handle, nowISO());

    const client = createXApiClient();

    const excludeParts: string[] = [];
    if (!p.includeRetweets) excludeParts.push('retweets');
    if (!p.includeReplies) excludeParts.push('replies');

    let pagesCount = 0;
    let insertedPosts = 0;
    let duplicatedPosts = 0;
    let currentPaginationToken: string | undefined = cursor?.lastPaginationToken ?? undefined;
    let isFirstPage = !currentPaginationToken;

    logger.info({ handle, xUserId, maxPages }, 'Starting backfill');

    initCursor(handle, nowISO());

    while (true) {
      const estimatedCostIfWeGoAhead = (pagesCount + 1) * p.maxResultsPerPage * p.estimatedPostReadCost;
      if (estimatedCostIfWeGoAhead > p.maxEstimatedCostPerRun) {
        const estimatedCostSoFar = pagesCount * p.maxResultsPerPage * p.estimatedPostReadCost;
        logger.warn({ handle, pagesCount, estimatedCostSoFar }, 'Cost limit reached');
        finishRun(runId, {
          status: 'stopped_by_cost_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: insertedPosts + duplicatedPosts,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: pagesCount * p.maxResultsPerPage,
          estimatedCostUsd: estimatedCostSoFar,
        });
        return;
      }

      if (pagesCount >= maxPages) {
        logger.info({ handle, pagesCount }, 'Page limit reached');
        finishRun(runId, {
          status: 'stopped_by_page_limit',
          finishedAt: nowISO(),
          requestedPages: pagesCount,
          fetchedPosts: insertedPosts + duplicatedPosts,
          insertedPosts,
          duplicatedPosts,
          estimatedPostReads: pagesCount * p.maxResultsPerPage,
          estimatedCostUsd: pagesCount * p.maxResultsPerPage * p.estimatedPostReadCost,
        });
        return;
      }

      const params: Record<string, string> = {
        'tweet.fields': TWEET_FIELDS,
        max_results: String(p.maxResultsPerPage),
      };
      if (excludeParts.length) params.exclude = excludeParts.join(',');
      if (currentPaginationToken) params.pagination_token = currentPaginationToken;

      logger.info({ handle, page: pagesCount + 1, currentPaginationToken }, 'Fetching page');

      const response = await client.get<XApiListResponse<XTweet>>(
        `/users/${xUserId}/tweets`,
        params,
      );

      const tweets = response.data ?? [];
      const meta = response.meta;

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

      const isLastPage = (tweets.length > 0 && !meta?.next_token) || meta?.result_count === 0;
      const cursorPatch: Parameters<typeof updateCursor>[1] = {
        lastPaginationToken: meta?.next_token ?? null,
        oldestTweetId: meta?.oldest_id ?? undefined,
        ...(isLastPage ? { backfillCompleted: 1 } : {}),
        updatedAt: pageNow,
      };
      if (isFirstPage && meta?.newest_id) {
        cursorPatch.latestTweetId = meta.newest_id;
      }
      updateCursor(handle, cursorPatch);
      isFirstPage = false;

      pagesCount++;
      currentPaginationToken = meta?.next_token;

      logger.info(
        { handle, page: pagesCount, inserted: insertedPosts, duplicated: duplicatedPosts },
        'Page complete',
      );

      if (!currentPaginationToken) {
        logger.info({ handle }, 'Backfill complete — no more pages');
        break;
      }

      await sleep(p.sleepMsBetweenRequests);
    }

    const finalCostUsd = pagesCount * p.maxResultsPerPage * p.estimatedPostReadCost;
    finishRun(runId, {
      status: 'success',
      finishedAt: nowISO(),
      requestedPages: pagesCount,
      fetchedPosts: insertedPosts + duplicatedPosts,
      insertedPosts,
      duplicatedPosts,
      estimatedPostReads: pagesCount * p.maxResultsPerPage,
      estimatedCostUsd: finalCostUsd,
    });

    logger.info(
      { handle, pagesCount, insertedPosts, duplicatedPosts, finalCostUsd },
      'Backfill finished successfully',
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (err instanceof ApiError) {
      if (err.status === 401) logger.error('X_BEARER_TOKEN is invalid or expired');
      else if (err.status === 404) logger.error({ handle }, 'Account not found or not accessible');
    }

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
      });
    }

    logger.error({ err }, 'backfill-account failed');
    process.exit(1);
  }
}

main();
