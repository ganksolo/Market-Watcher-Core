import fs from 'fs';
import path from 'path';

export function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

export function requireArg(name: string): string {
  const val = getArg(name);
  if (!val) {
    console.error(`Missing required argument: --${name}`);
    process.exit(1);
  }
  return val;
}

export function normalizeHandle(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle;
}

export function resolveHandle(): string {
  const fromArg = getArg('handle');
  if (fromArg) return normalizeHandle(fromArg);

  const accountsPath = path.resolve('config/accounts.json');
  const accounts: { accounts: Array<{ handle: string; enabled: boolean }> } =
    JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  const first = accounts.accounts.find(a => a.enabled);
  if (!first) {
    console.error('No enabled account found in config/accounts.json and --handle not provided');
    process.exit(1);
  }
  return normalizeHandle(first.handle);
}
