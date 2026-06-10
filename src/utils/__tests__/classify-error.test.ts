import { describe, it, expect } from 'vitest';
import { classifyError } from '../classify-error';
import { ApiError } from '../../clients/x-api-client';

describe('classifyError', () => {
  describe('ApiError cases', () => {
    it('401 → auth_failed token invalid', () => {
      const result = classifyError(new ApiError(401, 'Unauthorized', '/users/by/username/foo'));
      expect(result.logMessage).toContain('invalid or expired');
      expect(result.errorMessage).toBe('auth_failed: token invalid (401)');
    });

    it('403 → auth_failed forbidden', () => {
      const result = classifyError(new ApiError(403, 'Forbidden', '/users/foo'));
      expect(result.errorMessage).toBe('auth_failed: forbidden (403)');
    });

    it('404 with handle context → not_found with handle', () => {
      const result = classifyError(new ApiError(404, 'Not Found', '/users/by/username/foo'), { handle: 'foo' });
      expect(result.errorMessage).toBe('not_found: handle=foo (404)');
      expect(result.logMessage).toContain('@foo');
    });

    it('404 without context → not_found with unknown', () => {
      const result = classifyError(new ApiError(404, 'Not Found', '/users/by/username/foo'));
      expect(result.errorMessage).toBe('not_found: handle=unknown (404)');
    });

    it('429 → rate_limit_exceeded', () => {
      const result = classifyError(new ApiError(429, 'Too Many Requests', '/users/foo/tweets'));
      expect(result.errorMessage).toBe('rate_limit_exceeded (429)');
    });

    it('503 → server_error 503', () => {
      const result = classifyError(new ApiError(503, 'Service Unavailable', '/users/foo/tweets'));
      expect(result.errorMessage).toBe('server_error: 503');
    });

    it('422 → api_error 422', () => {
      const result = classifyError(new ApiError(422, 'Unprocessable', '/users/foo/tweets'));
      expect(result.errorMessage).toBe('api_error: 422');
    });
  });

  describe('network TypeError', () => {
    it('ENOTFOUND → network_error with logMessage', () => {
      const err = new TypeError('fetch failed ENOTFOUND api.twitter.com');
      const result = classifyError(err);
      expect(result.logMessage).toContain('Network error');
      expect(result.errorMessage).toContain('network_error');
    });
  });

  describe('ENOENT', () => {
    it('ENOENT → config_error', () => {
      const err = Object.assign(new Error('ENOENT: no such file config/accounts.json'), { code: 'ENOENT' });
      const result = classifyError(err);
      expect(result.logMessage).toContain('Config file not found');
      expect(result.errorMessage).toContain('config_error');
    });
  });

  describe('SqliteError', () => {
    it('SqliteError → db_error', () => {
      const err = Object.assign(new Error('UNIQUE constraint failed'), { name: 'SqliteError' });
      const result = classifyError(err);
      expect(result.logMessage).toContain('Database error');
      expect(result.errorMessage).toContain('db_error');
    });
  });

  describe('generic fallback', () => {
    it('plain Error → empty logMessage, uses err.message', () => {
      const result = classifyError(new Error('something unexpected'));
      expect(result.logMessage).toBe('');
      expect(result.errorMessage).toBe('something unexpected');
    });

    it('non-Error string → empty logMessage, stringified', () => {
      const result = classifyError('raw string error');
      expect(result.logMessage).toBe('');
      expect(result.errorMessage).toBe('raw string error');
    });
  });
});
