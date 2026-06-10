import { describe, it, expect } from 'vitest';
import { estimateCost } from '../cost';

describe('estimateCost', () => {
  it('returns correct object for normal input', () => {
    const result = estimateCost(100, 1, 0.0001, 0.001);
    expect(result.postReads).toBe(100);
    expect(result.userReads).toBe(1);
    expect(result.totalUsd).toBeCloseTo(0.011, 5);
  });

  it('returns all zeros for zero reads', () => {
    const result = estimateCost(0, 0, 0.0001, 0.001);
    expect(result).toEqual({ postReads: 0, userReads: 0, totalUsd: 0 });
  });

  it('correctly computes with only post reads', () => {
    const result = estimateCost(50, 0, 0.002, 0.001);
    expect(result.totalUsd).toBe(0.1);
    expect(result.userReads).toBe(0);
  });

  it('passes through postReads and userReads values unchanged', () => {
    const result = estimateCost(42, 7, 0.001, 0.01);
    expect(result.postReads).toBe(42);
    expect(result.userReads).toBe(7);
  });
});
