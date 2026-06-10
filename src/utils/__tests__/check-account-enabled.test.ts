import fs from 'fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkAccountEnabled } from '../cli';

const makeConfig = (accounts: Array<{ handle: string; enabled?: boolean }>) =>
  JSON.stringify({ accounts });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkAccountEnabled', () => {
  it('calls process.exit(1) when account is disabled', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo', enabled: false }]) as any,
    );
    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit called with ${code}`);
    });

    expect(() => checkAccountEnabled('foo')).toThrow('process.exit called with 1');
  });

  it('does not exit when account is enabled', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo', enabled: true }]) as any,
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => checkAccountEnabled('foo')).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when account is not in config', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'other', enabled: true }]) as any,
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => checkAccountEnabled('foo')).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when enabled field is missing', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo' }]) as any,
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => checkAccountEnabled('foo')).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('normalizes @ prefix in config handle — config has @foo, input is foo', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: '@foo', enabled: false }]) as any,
    );
    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit called with ${code}`);
    });

    // config entry written as '@foo'; normalizeHandle('@foo') === 'foo' matches input
    expect(() => checkAccountEnabled('foo')).toThrow('process.exit called with 1');
  });
});
