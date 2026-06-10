import { describe, it, expect } from 'vitest';
import { normalizeHandle } from '../cli';

describe('normalizeHandle', () => {
  it('strips leading @ and preserves case', () => {
    expect(normalizeHandle('@Handle')).toBe('Handle');
  });

  it('returns handle unchanged when no @ prefix', () => {
    expect(normalizeHandle('Handle')).toBe('Handle');
  });

  it('returns lowercase handle unchanged', () => {
    expect(normalizeHandle('handle')).toBe('handle');
  });

  it('strips @ from all-uppercase handle', () => {
    expect(normalizeHandle('@UPPER')).toBe('UPPER');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeHandle('')).toBe('');
  });
});
