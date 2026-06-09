import type { Config } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

const dbUrl = process.env.DATABASE_URL ?? 'file:./data/market-watcher.sqlite';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: dbUrl },
} satisfies Config;
