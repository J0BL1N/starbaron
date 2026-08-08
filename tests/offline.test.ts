import { describe, expect, it } from 'vitest'
import {
  MAX_OFFLINE_BANK_SECONDS,
  calculateOfflineEarnings,
} from '../src/sim/core/offline'

describe('calculateOfflineEarnings', () => {
  it('returns rate x elapsed for short absences', () => {
    expect(calculateOfflineEarnings(10, 100)).toBe(1_000)
    expect(calculateOfflineEarnings(10, 3_600)).toBe(36_000)
  })

  it('supports fractional elapsed time', () => {
    expect(calculateOfflineEarnings(4, 0.5)).toBe(2)
  })

  it('caps elapsed time at the 8h bank', () => {
    const banked = MAX_OFFLINE_BANK_SECONDS
    expect(banked).toBe(8 * 60 * 60)
    expect(calculateOfflineEarnings(10, banked + 3_600)).toBeCloseTo(10 * banked, 10)
    expect(calculateOfflineEarnings(10, banked * 3)).toBeCloseTo(10 * banked, 10)
  })

  it('pays the full amount exactly at the 8h cap', () => {
    expect(calculateOfflineEarnings(10, MAX_OFFLINE_BANK_SECONDS)).toBe(
      10 * MAX_OFFLINE_BANK_SECONDS,
    )
  })

  it('returns 0 for zero elapsed time', () => {
    expect(calculateOfflineEarnings(10, 0)).toBe(0)
  })

  it('returns 0 for a zero rate', () => {
    expect(calculateOfflineEarnings(0, 3_600)).toBe(0)
  })

  it('throws for negative elapsed time', () => {
    expect(() => calculateOfflineEarnings(10, -1)).toThrow(RangeError)
  })

  it('throws for negative or non-finite rates', () => {
    expect(() => calculateOfflineEarnings(-1, 100)).toThrow(RangeError)
    expect(() => calculateOfflineEarnings(Number.NaN, 100)).toThrow(RangeError)
    expect(() => calculateOfflineEarnings(Number.POSITIVE_INFINITY, 100)).toThrow(RangeError)
  })

  it('throws for non-finite elapsed time', () => {
    expect(() => calculateOfflineEarnings(10, Number.NaN)).toThrow(RangeError)
    expect(() => calculateOfflineEarnings(10, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
