import { describe, it, expect } from 'vitest';
import { prettifyErrorMessage } from '../format';

describe('prettifyErrorMessage', () => {
  it('passes through n/a unchanged', () => {
    expect(prettifyErrorMessage('n/a')).toBe('n/a');
  });

  it('capitalizes first letter and replaces underscores', () => {
    expect(prettifyErrorMessage('rate_limit_exceeded (429)')).toBe('Rate limit exceeded (429)');
  });

  it('handles colon-separated suffix', () => {
    expect(prettifyErrorMessage('not_found: handle=foo (404)')).toBe('Not found: handle=foo (404)');
  });

  it('handles auth prefix', () => {
    expect(prettifyErrorMessage('auth_failed: token invalid (401)')).toBe('Auth failed: token invalid (401)');
  });

  it('handles network prefix', () => {
    expect(prettifyErrorMessage('network_error: fetch failed ENOTFOUND')).toBe('Network error: fetch failed ENOTFOUND');
  });

  it('converts db_ prefix to DB', () => {
    expect(prettifyErrorMessage('db_error: UNIQUE constraint failed')).toBe('DB error: UNIQUE constraint failed');
  });

  it('converts api_ prefix to API', () => {
    expect(prettifyErrorMessage('api_error: 422')).toBe('API error: 422');
  });
});
