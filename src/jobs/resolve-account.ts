import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { resolveHandle, checkAccountEnabled } from '../utils/cli';
import { logger } from '../utils/logger';
import { nowISO } from '../utils/date';
import { classifyError } from '../utils/classify-error';
import { createXApiClient } from '../clients/x-api-client';
import type { XApiResponse, XUser } from '../clients/x-api-types';
import { upsertWatchAccount, upsertXUser } from '../services/account-service';
import { initCursor } from '../services/cursor-service';
import { createRun, finishRun } from '../services/run-log-service';

dotenv.config();

const USER_FIELDS = [
  'id', 'name', 'username', 'description', 'location',
  'verified', 'verified_type', 'public_metrics', 'created_at',
].join(',');

async function main(): Promise<void> {
  const handle = resolveHandle();
  checkAccountEnabled(handle);

  let runId: number | undefined = undefined;

  try {
    const policyPath = path.resolve('config/fetch-policy.json');
    const policy: { default: { estimatedUserReadCost: number } } =
      JSON.parse(fs.readFileSync(policyPath, 'utf-8'));

    runId = createRun('resolve_user', handle, nowISO());

    const client = createXApiClient();

    logger.info({ handle }, 'Resolving account');

    const response = await client.get<XApiResponse<XUser>>(
      `/users/by/username/${handle}`,
      { 'user.fields': USER_FIELDS },
    );

    if (response.errors?.length) {
      throw new Error(`API errors: ${response.errors.map(e => e.title).join(', ')}`);
    }
    if (!response.data) {
      throw new Error(`No user data returned for handle: ${handle}`);
    }

    const user = response.data;
    const now = nowISO();

    upsertWatchAccount(handle, user.id, now);
    upsertXUser({
      xUserId: user.id,
      username: user.username,
      name: user.name ?? null,
      description: user.description ?? null,
      location: user.location ?? null,
      verified: user.verified ? 1 : null,
      verifiedType: user.verified_type ?? null,
      followersCount: user.public_metrics?.followers_count ?? null,
      followingCount: user.public_metrics?.following_count ?? null,
      tweetCount: user.public_metrics?.tweet_count ?? null,
      listedCount: user.public_metrics?.listed_count ?? null,
      rawJson: JSON.stringify(response),
      fetchedAt: now,
    });
    initCursor(handle, now);

    finishRun(runId, {
      status: 'success',
      finishedAt: now,
      estimatedUserReads: 1,
      estimatedCostUsd: policy.default.estimatedUserReadCost,
    });

    logger.info({ handle, xUserId: user.id }, 'Resolved account successfully');
  } catch (err) {
    const { logMessage, errorMessage } = classifyError(err, { handle });
    if (logMessage) logger.error({ handle }, logMessage);

    if (runId !== undefined) {
      finishRun(runId, {
        status: 'failed',
        finishedAt: nowISO(),
        errorMessage,
      });
    }

    logger.error({ err }, 'resolve-account failed');
    process.exit(1);
  }
}

main();
