import { ApiError } from '../clients/x-api-client';

export function classifyError(
  err: unknown,
  context?: { handle?: string },
): { logMessage: string; errorMessage: string } {
  if (err instanceof ApiError) {
    const { status, path } = err;
    if (status === 401) {
      return {
        logMessage: 'X_BEARER_TOKEN is invalid or expired',
        errorMessage: 'auth_failed: token invalid (401)',
      };
    }
    if (status === 403) {
      return {
        logMessage: 'Access forbidden — check X app permissions',
        errorMessage: 'auth_failed: forbidden (403)',
      };
    }
    if (status === 404) {
      const handle = context?.handle ?? 'unknown';
      return {
        logMessage: `Account not found or not accessible: @${handle}`,
        errorMessage: `not_found: handle=${handle} (404)`,
      };
    }
    if (status === 429) {
      return {
        logMessage: 'Rate limit exceeded after retries',
        errorMessage: 'rate_limit_exceeded (429)',
      };
    }
    if (status >= 500) {
      return {
        logMessage: `X API server error ${status} on ${path}`,
        errorMessage: `server_error: ${status}`,
      };
    }
    return {
      logMessage: `X API error ${status} on ${path}`,
      errorMessage: `api_error: ${status}`,
    };
  }

  if (
    err instanceof TypeError &&
    /fetch|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(err.message)
  ) {
    return {
      logMessage: 'Network error — check connectivity',
      errorMessage: `network_error: ${err.message}`,
    };
  }

  // ENOENT from config file reads (accounts.json, fetch-policy.json) in current job
  if (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    return {
      logMessage: `Config file not found: ${err.message}`,
      errorMessage: `config_error: ${err.message}`,
    };
  }

  // better-sqlite3 errors have name === 'SqliteError'
  if (err instanceof Error && err.name === 'SqliteError') {
    return {
      logMessage: `Database error: ${err.message}`,
      errorMessage: `db_error: ${err.message}`,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    logMessage: '',
    errorMessage: message,
  };
}
