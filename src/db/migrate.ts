import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = process.env.DATABASE_URL ?? 'file:./data/market-watcher.sqlite';
const dbPath = dbUrl.replace(/^file:/, '');
const resolved = path.resolve(dbPath);

const dataDir = path.dirname(resolved);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(resolved);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS watch_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT NOT NULL UNIQUE,
    x_user_id TEXT,
    label TEXT,
    enabled INTEGER DEFAULT 1,
    note TEXT,
    first_seen_at TEXT,
    last_checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS x_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    x_user_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    name TEXT,
    description TEXT,
    location TEXT,
    verified INTEGER,
    verified_type TEXT,
    followers_count INTEGER,
    following_count INTEGER,
    tweet_count INTEGER,
    listed_count INTEGER,
    raw_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS x_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id TEXT NOT NULL UNIQUE,
    author_id TEXT NOT NULL,
    author_handle TEXT NOT NULL,
    text TEXT NOT NULL,
    lang TEXT,
    created_at TEXT NOT NULL,
    conversation_id TEXT,
    in_reply_to_user_id TEXT,
    referenced_type TEXT,
    referenced_tweet_id TEXT,
    like_count INTEGER,
    reply_count INTEGER,
    repost_count INTEGER,
    quote_count INTEGER,
    bookmark_count INTEGER,
    impression_count INTEGER,
    url TEXT,
    raw_json TEXT NOT NULL,
    first_fetched_at TEXT NOT NULL,
    last_fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fetch_cursors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_handle TEXT NOT NULL UNIQUE,
    latest_tweet_id TEXT,
    latest_tweet_created_at TEXT,
    oldest_tweet_id TEXT,
    oldest_tweet_created_at TEXT,
    last_pagination_token TEXT,
    backfill_completed INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fetch_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type TEXT NOT NULL,
    account_handle TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    requested_pages INTEGER DEFAULT 0,
    fetched_posts INTEGER DEFAULT 0,
    inserted_posts INTEGER DEFAULT 0,
    duplicated_posts INTEGER DEFAULT 0,
    estimated_post_reads INTEGER DEFAULT 0,
    estimated_user_reads INTEGER DEFAULT 0,
    estimated_cost_usd REAL DEFAULT 0,
    error_message TEXT,
    raw_log_path TEXT
  );

  CREATE TABLE IF NOT EXISTS raw_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_handle TEXT NOT NULL,
    archive_date TEXT NOT NULL,
    file_path TEXT NOT NULL,
    post_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

console.log('Migration complete: all 6 tables created successfully');
console.log(`Database: ${resolved}`);

sqlite.close();
