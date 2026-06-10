import { eq } from 'drizzle-orm';
import { db } from '../db';
import { watchAccounts, xUsers } from '../db/schema';

export function upsertWatchAccount(
  handle: string,
  xUserId: string,
  now: string,
  label?: string,
): void {
  db.insert(watchAccounts)
    .values({
      handle,
      xUserId,
      label: label ?? null,
      firstSeenAt: now,
      lastCheckedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: watchAccounts.handle,
      set: { xUserId, label: label ?? null, lastCheckedAt: now, updatedAt: now },
    })
    .run();
}

export function getWatchAccount(handle: string) {
  return db
    .select()
    .from(watchAccounts)
    .where(eq(watchAccounts.handle, handle))
    .get();
}

export function upsertXUser(params: {
  xUserId: string;
  username: string;
  name: string | null;
  description: string | null;
  location: string | null;
  verified: number | null;
  verifiedType: string | null;
  followersCount: number | null;
  followingCount: number | null;
  tweetCount: number | null;
  listedCount: number | null;
  rawJson: string;
  fetchedAt: string;
}): void {
  db.insert(xUsers)
    .values(params)
    .onConflictDoUpdate({
      target: xUsers.xUserId,
      set: {
        username: params.username,
        name: params.name,
        description: params.description,
        location: params.location,
        verified: params.verified,
        verifiedType: params.verifiedType,
        followersCount: params.followersCount,
        followingCount: params.followingCount,
        tweetCount: params.tweetCount,
        listedCount: params.listedCount,
        rawJson: params.rawJson,
        fetchedAt: params.fetchedAt,
      },
    })
    .run();
}
