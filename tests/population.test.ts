import { describe, expect, it } from 'vitest'
import {
  BASE_POPULATION_CAP,
  BASE_GROWTH_PER_SEC,
  populationCap,
  populationGrowthPerSec,
} from '../src/sim/core/population'

describe('populationCap', () => {
  it('returns the base cap with no housing', () => {
    expect(populationCap(0)).toBe(BASE_POPULATION_CAP)
  })

  it('scales the cap with housing levels', () => {
    expect(populationCap(1)).toBe(6_000)
    expect(populationCap(5)).toBe(10_000)
    expect(populationCap(10)).toBe(15_000)
  })

  it('throws for negative housing levels', () => {
    expect(() => populationCap(-1)).toThrow(RangeError)
  })

  it('throws for non-integer housing levels', () => {
    expect(() => populationCap(1.5)).toThrow(RangeError)
    expect(() => populationCap(Number.NaN)).toThrow(RangeError)
  })
})

describe('populationGrowthPerSec', () => {
  it('returns the base growth with no structures', () => {
    expect(populationGrowthPerSec(0)).toBe(BASE_GROWTH_PER_SEC)
  })

  it('adds housing growth per level', () => {
    expect(populationGrowthPerSec(1)).toBe(4)
    expect(populationGrowthPerSec(5)).toBe(12)
  })

  it('applies the hydroponics multiplier', () => {
    expect(populationGrowthPerSec(0, 1)).toBe(3)
    expect(populationGrowthPerSec(1, 1)).toBe(6)
    expect(populationGrowthPerSec(2, 2)).toBe(12)
  })

  it('throws for negative housing levels', () => {
    expect(() => populationGrowthPerSec(-1)).toThrow(RangeError)
  })

  it('throws for negative or fractional hydroponics levels', () => {
    expect(() => populationGrowthPerSec(0, -1)).toThrow(RangeError)
    expect(() => populationGrowthPerSec(0, 0.5)).toThrow(RangeError)
  })

  it('throws for non-integer housing levels', () => {
    expect(() => populationGrowthPerSec(2.5)).toThrow(RangeError)
    expect(() => populationGrowthPerSec(Number.NaN)).toThrow(RangeError)
  })
})
