import { describe, expect, it } from 'vitest'
import {
  MAX_TIER,
  MIN_TIER,
  baselinePassiveIncome,
  structureCost,
} from '../src/sim/core/economy'

describe('baselinePassiveIncome', () => {
  it('returns 10 x tier for in-range tiers', () => {
    expect(baselinePassiveIncome(1)).toBe(10)
    expect(baselinePassiveIncome(3)).toBe(30)
    expect(baselinePassiveIncome(MAX_TIER)).toBe(50)
  })

  it('throws for tiers below the valid range', () => {
    expect(() => baselinePassiveIncome(0)).toThrow(RangeError)
    expect(() => baselinePassiveIncome(-1)).toThrow(RangeError)
  })

  it('throws for tiers above the valid range', () => {
    expect(() => baselinePassiveIncome(6)).toThrow(RangeError)
    expect(() => baselinePassiveIncome(100)).toThrow(RangeError)
  })

  it('throws for non-integer or non-finite tiers', () => {
    expect(() => baselinePassiveIncome(2.5)).toThrow(RangeError)
    expect(() => baselinePassiveIncome(Number.NaN)).toThrow(RangeError)
    expect(() => baselinePassiveIncome(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('exposes the tier bounds', () => {
    expect(MIN_TIER).toBe(1)
    expect(MAX_TIER).toBe(5)
  })
})

describe('structureCost', () => {
  it('returns base cost at level 0', () => {
    expect(structureCost(300, 0)).toBe(300)
  })

  it('applies the x1.15 cost curve per level', () => {
    expect(structureCost(300, 1)).toBeCloseTo(345, 10)
    expect(structureCost(300, 2)).toBeCloseTo(300 * 1.15 ** 2, 10)
    expect(structureCost(500, 3)).toBeCloseTo(500 * 1.15 ** 3, 10)
  })

  it('throws for negative levels', () => {
    expect(() => structureCost(300, -1)).toThrow(RangeError)
  })

  it('throws for non-integer levels', () => {
    expect(() => structureCost(300, 1.5)).toThrow(RangeError)
    expect(() => structureCost(300, Number.NaN)).toThrow(RangeError)
    expect(() => structureCost(300, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('throws for non-positive base costs', () => {
    expect(() => structureCost(0, 0)).toThrow(RangeError)
    expect(() => structureCost(-100, 0)).toThrow(RangeError)
    expect(() => structureCost(Number.POSITIVE_INFINITY, 0)).toThrow(RangeError)
    expect(() => structureCost(Number.NaN, 0)).toThrow(RangeError)
  })
})
