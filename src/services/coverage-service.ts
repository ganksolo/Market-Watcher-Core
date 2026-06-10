import { getXUserByUsername } from './account-service';
import { getPostCountByHandle } from './post-service';

export function assessBackfillCoverage(params: {
  handle: string;
  requestedPages: number;
  endedWithoutNextToken: boolean;
}) {
  const xUser = getXUserByUsername(params.handle);
  const localPosts = getPostCountByHandle(params.handle);
  const tweetCount = xUser?.tweetCount ?? null;

  const suspicious =
    params.endedWithoutNextToken &&
    tweetCount != null &&
    tweetCount >= 500 &&
    localPosts <= Math.min(100, Math.floor(tweetCount * 0.1)) &&
    params.requestedPages <= 2;

  const warning = suspicious
    ? `suspicious_backfill_completion: profile tweet_count=${tweetCount}, local_posts=${localPosts}, pagination ended after ${params.requestedPages} page(s)`
    : null;

  return {
    suspicious,
    warning,
    tweetCount,
    localPosts,
  };
}
