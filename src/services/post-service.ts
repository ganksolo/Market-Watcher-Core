import { eq, and, like, asc } from 'drizzle-orm';
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
    .set({ lastFetchedAt: params.lastFetchedAt })
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
