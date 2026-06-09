import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import { sleep } from '../utils/sleep';

dotenv.config();

const BASE_URL = 'https://api.twitter.com/2';
const MAX_RETRIES = 3;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`X API error ${status} on ${path}: ${body}`);
    this.name = 'ApiError';
  }
}

export class XApiClient {
  private readonly token: string;

  constructor(bearerToken: string) {
    this.token = bearerToken;
  }

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== '') url.searchParams.set(key, value);
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': 'market-watcher-core/0.1',
        },
      });

      if (response.status === 429) {
        const resetHeader = response.headers.get('x-rate-limit-reset');
        const waitMs = resetHeader
          ? Math.max(0, parseInt(resetHeader, 10) * 1000 - Date.now()) + 1000
          : 60_000;
        logger.warn({ attempt, waitMs, path }, 'Rate limited, retrying after sleep');
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new ApiError(response.status, body, path);
      }

      return response.json() as Promise<T>;
    }

    throw new Error(`Max retries exceeded for ${path}`);
  }
}

export function createXApiClient(): XApiClient {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    logger.error('X_BEARER_TOKEN is not set in environment');
    process.exit(1);
  }
  return new XApiClient(token);
}
