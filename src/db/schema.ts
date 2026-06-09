import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const watchAccounts = sqliteTable('watch_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  handle: text('handle').notNull().unique(),
  xUserId: text('x_user_id'),
  label: text('label'),
  enabled: integer('enabled').default(1),
  note: text('note'),
  firstSeenAt: text('first_seen_at'),
  lastCheckedAt: text('last_checked_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const xUsers = sqliteTable('x_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  xUserId: text('x_user_id').notNull().unique(),
  username: text('username').notNull(),
  name: text('name'),
  description: text('description'),
  location: text('location'),
  verified: integer('verified'),
  verifiedType: text('verified_type'),
  followersCount: integer('followers_count'),
  followingCount: integer('following_count'),
  tweetCount: integer('tweet_count'),
  listedCount: integer('listed_count'),
  rawJson: text('raw_json').notNull(),
  fetchedAt: text('fetched_at').notNull(),
});

export const xPosts = sqliteTable('x_posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tweetId: text('tweet_id').notNull().unique(),
  authorId: text('author_id').notNull(),
  authorHandle: text('author_handle').notNull(),
  text: text('text').notNull(),
  lang: text('lang'),
  createdAt: text('created_at').notNull(),
  conversationId: text('conversation_id'),
  inReplyToUserId: text('in_reply_to_user_id'),
  referencedType: text('referenced_type'),
  referencedTweetId: text('referenced_tweet_id'),
  likeCount: integer('like_count'),
  replyCount: integer('reply_count'),
  repostCount: integer('repost_count'),
  quoteCount: integer('quote_count'),
  bookmarkCount: integer('bookmark_count'),
  impressionCount: integer('impression_count'),
  url: text('url'),
  rawJson: text('raw_json').notNull(),
  firstFetchedAt: text('first_fetched_at').notNull(),
  lastFetchedAt: text('last_fetched_at').notNull(),
});

export const fetchCursors = sqliteTable('fetch_cursors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountHandle: text('account_handle').notNull().unique(),
  latestTweetId: text('latest_tweet_id'),
  latestTweetCreatedAt: text('latest_tweet_created_at'),
  oldestTweetId: text('oldest_tweet_id'),
  oldestTweetCreatedAt: text('oldest_tweet_created_at'),
  lastPaginationToken: text('last_pagination_token'),
  backfillCompleted: integer('backfill_completed').default(0),
  updatedAt: text('updated_at').notNull(),
});

export const fetchRuns = sqliteTable('fetch_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runType: text('run_type').notNull(),
  accountHandle: text('account_handle').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(),
  requestedPages: integer('requested_pages').default(0),
  fetchedPosts: integer('fetched_posts').default(0),
  insertedPosts: integer('inserted_posts').default(0),
  duplicatedPosts: integer('duplicated_posts').default(0),
  estimatedPostReads: integer('estimated_post_reads').default(0),
  estimatedUserReads: integer('estimated_user_reads').default(0),
  estimatedCostUsd: real('estimated_cost_usd').default(0),
  errorMessage: text('error_message'),
  rawLogPath: text('raw_log_path'),
});

export const rawArchives = sqliteTable('raw_archives', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountHandle: text('account_handle').notNull(),
  archiveDate: text('archive_date').notNull(),
  filePath: text('file_path').notNull(),
  postCount: integer('post_count').notNull(),
  createdAt: text('created_at').notNull(),
});
