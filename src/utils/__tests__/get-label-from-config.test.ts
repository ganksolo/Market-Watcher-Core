import fs from 'fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLabelFromConfig } from '../cli';

const makeConfig = (accounts: Array<{ handle: string; label?: string }>) =>
  JSON.stringify({ accounts });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getLabelFromConfig', () => {
  it('returns the label when present', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo', label: 'Foo Corp' }]) as any,
    );
    expect(getLabelFromConfig('foo')).toBe('Foo Corp');
  });

  it('returns undefined when label field is missing', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'foo' }]) as any,
    );
    expect(getLabelFromConfig('foo')).toBeUndefined();
  });

  it('returns undefined when account is not in config', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: 'other', label: 'Other' }]) as any,
    );
    expect(getLabelFromConfig('foo')).toBeUndefined();
  });

  it('normalizes @ prefix — config has @foo, input is foo', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      makeConfig([{ handle: '@foo', label: 'Foo Corp' }]) as any,
    );
    expect(getLabelFromConfig('foo')).toBe('Foo Corp');
  });
});
