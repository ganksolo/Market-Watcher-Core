import dotenv from 'dotenv';
import path from 'path';
import { execFileSync } from 'child_process';
import { getArg } from '../utils/cli';
import { nowISO, toDateString } from '../utils/date';
import { logger } from '../utils/logger';

dotenv.config();

function runJob(scriptPath: string, args: string[]): void {
  execFileSync(
    process.execPath,
    ['--import', 'tsx', path.resolve(scriptPath), ...args],
    { stdio: 'inherit' },
  );
}

function main(): void {
  const handle = getArg('handle');
  const date = getArg('date') ?? toDateString(nowISO());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    logger.error({ date }, 'Invalid --date argument (expected YYYY-MM-DD)');
    process.exit(1);
  }

  const handleArgs = handle ? ['--handle', handle] : [];
  const dateArgs = ['--date', date];

  logger.info({ handle: handle ?? '(default)', date }, 'Starting daily pipeline');

  runJob('src/jobs/sync-account.ts', handleArgs);
  runJob('src/jobs/export-daily-raw.ts', [...handleArgs, ...dateArgs]);
  runJob('src/jobs/export-digest.ts', [...handleArgs, ...dateArgs]);
  runJob('src/jobs/status.ts', handleArgs);

  logger.info({ handle: handle ?? '(default)', date }, 'Daily pipeline complete');
}

main();
