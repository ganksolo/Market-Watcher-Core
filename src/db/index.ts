import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import * as schema from './schema';

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

export const db = drizzle(sqlite, { schema });
