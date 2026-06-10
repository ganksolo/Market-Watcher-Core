import { eq, and, like, asc, desc } from 'drizzle-orm';
import { db } from '../db';
import { xPosts } from '../db/schema';

export function upsertPost(params: {
  tweetId: string;
  authorId: string;
  authorHandle: string;
  text: string;
  lang: string | null;
  createdAt: string;
  conversationId: string | null;
  inReplyToUserId: string | null;
  referencedType: string | null;
  referencedTweetId: string | null;
  likeCount: number | null;
  replyCount: number | null;
  repostCount: number | null;
  quoteCount: number | null;
  bookmarkCount: number | null;
  impressionCount: number | null;
  url: string;
  rawJson: string;
  firstFetchedAt: string;
  lastFetchedAt: string;
}): { inserted: boolean } {
  const insertResult = db
    .insert(xPosts)
    .values(params)
    .onConflictDoNothing()
    .run();

  if (insertResult.changes > 0) {
    return { inserted: true };
  }

  db.update(xPosts)
    .set({
      text: params.text,
      likeCount: params.likeCount,
      replyCount: params.replyCount,
      repostCount: params.repostCount,
      quoteCount: params.quoteCount,
      bookmarkCount: params.bookmarkCount,
      impressionCount: params.impressionCount,
      rawJson: params.rawJson,
      lastFetchedAt: params.lastFetchedAt,
    })
    .where(eq(xPosts.tweetId, params.tweetId))
    .run();

  return { inserted: false };
}

export function getPostsByHandle(
  handle: string,
  opts?: { limit?: number; offset?: number },
) {
  return db
    .select()
    .from(xPosts)
    .where(eq(xPosts.authorHandle, handle))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0)
    .all();
}

export function getPostsByHandleAndDate(handle: string, date: string) {
  return db
    .select()
    .from(xPosts)
    .where(and(eq(xPosts.authorHandle, handle), like(xPosts.createdAt, `${date}%`)))
    .orderBy(asc(xPosts.createdAt))
    .all();
}

export function getCoverageBoundsByHandle(handle: string): {
  latestTweetId: string | null;
  latestTweetCreatedAt: string | null;
  oldestTweetId: string | null;
  oldestTweetCreatedAt: string | null;
} {
  const latest = db
    .select({
      tweetId: xPosts.tweetId,
      createdAt: xPosts.createdAt,
    })
    .from(xPosts)
    .where(eq(xPosts.authorHandle, handle))
    .orderBy(desc(xPosts.createdAt), desc(xPosts.tweetId))
    .limit(1)
    .get();

  const oldest = db
    .select({
      tweetId: xPosts.tweetId,
      createdAt: xPosts.createdAt,
    })
    .from(xPosts)
    .where(eq(xPosts.authorHandle, handle))
    .orderBy(asc(xPosts.createdAt), asc(xPosts.tweetId))
    .limit(1)
    .get();

  return {
    latestTweetId: latest?.tweetId ?? null,
    latestTweetCreatedAt: latest?.createdAt ?? null,
    oldestTweetId: oldest?.tweetId ?? null,
    oldestTweetCreatedAt: oldest?.createdAt ?? null,
  };
}
