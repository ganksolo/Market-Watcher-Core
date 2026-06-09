import { eq } from 'drizzle-orm';
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
  const result = db
    .insert(xPosts)
    .values(params)
    .onConflictDoNothing()
    .run();
  return { inserted: result.changes > 0 };
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
