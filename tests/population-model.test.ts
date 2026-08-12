import { describe, expect, it } from 'vitest'
import {
  BASE_GROWTH_PER_SEC,
  BASE_POPULATION_CAP,
  populationCap,
  populationGrowthPerSec,
} from '../src/sim/core/population'
import {
  applyGrowth,
  applyWarLoss,
  growthRateFor,
  populationCapFor,
  populationInvariants,
  snapshotAt,
} from '../src/sim/core/population-model'
import type { PopulationState } from '../src/sim/core/population-model'

function state(overrides: Partial<PopulationState> = {}): PopulationState {
  return {
    population: 100,
    housingLevels: 1,
    hydroponicsLevels: 0,
    lastTickAt: 1000,
    ...overrides,
  }
}

describe('populationCapFor', () => {
  it('returns the base cap for no housing and multiplier 1', () => {
    expect(populationCapFor(0, 1)).toBe(BASE_POPULATION_CAP)
  })

  it('equals the existing populationCap formula times the multiplier', () => {
    expect(populationCapFor(5, 2)).toBe(populationCap(5) * 2)
    expect(populationCapFor(0, 0.5)).toBe(BASE_POPULATION_CAP * 0.5)
    expect(populationCapFor(3, 1)).toBe(populationCap(3))
  })

  it('throws for negative housing levels', () => {
    expect(() => populationCapFor(-1, 1)).toThrow(RangeError)
  })

  it('throws for fractional housing levels', () => {
    expect(() => populationCapFor(1.5, 1)).toThrow(RangeError)
  })

  it('throws for a zero or negative planet multiplier', () => {
    expect(() => populationCapFor(0, 0)).toThrow(RangeError)
    expect(() => populationCapFor(0, -2)).toThrow(RangeError)
  })

  it('throws for a non-finite planet multiplier', () => {
    expect(() => populationCapFor(0, Number.NaN)).toThrow(RangeError)
    expect(() => populationCapFor(0, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('growthRateFor', () => {
  it('mirrors base growth with no structures', () => {
    expect(growthRateFor(0)).toBe(BASE_GROWTH_PER_SEC)
  })

  it('adds housing growth per level', () => {
    expect(growthRateFor(1)).toBe(4)
    expect(growthRateFor(5)).toBe(12)
  })

  it('applies the hydroponics multiplier exactly like the existing formula', () => {
    expect(growthRateFor(0, 1)).toBe(populationGrowthPerSec(0, 1))
    expect(growthRateFor(2, 2)).toBe(populationGrowthPerSec(2, 2))
    expect(growthRateFor(1, 1)).toBe(6)
  })

  it('throws for negative housing levels', () => {
    expect(() => growthRateFor(-1)).toThrow(RangeError)
  })

  it('throws for fractional hydroponics levels', () => {
    expect(() => growthRateFor(0, 0.5)).toThrow(RangeError)
  })
})

describe('snapshotAt', () => {
  it('returns no change when at equals lastTickAt', () => {
    const s = state()
    expect(snapshotAt(s, s.lastTickAt).population).toBe(s.population)
  })

  it('recovers population across a gap by exactly growth times the gap', () => {
    const s = state({ population: 100, housingLevels: 1, hydroponicsLevels: 0, lastTickAt: 1000 })
    const snap = snapshotAt(s, 1010)
    expect(snap.population).toBe(100 + growthRateFor(1, 0) * 10)
    expect(snap.population).toBe(140)
  })

  it('clamps the recovered population at the cap', () => {
    const s = state({ population: 4999, housingLevels: 0, lastTickAt: 0 })
    expect(snapshotAt(s, 100).population).toBe(BASE_POPULATION_CAP)
  })

  it('floors the recovered population at zero', () => {
    const s = state({ population: -50, housingLevels: 0, lastTickAt: 0 })
    expect(snapshotAt(s, 10).population).toBe(0)
  })

  it('clamps to the cap for a huge gap', () => {
    const s = state({ population: 0, housingLevels: 0, lastTickAt: 1 })
    expect(snapshotAt(s, 1e15).population).toBe(BASE_POPULATION_CAP)
  })

  it('grows at the base rate with zero housing', () => {
    const s = state({ population: 0, housingLevels: 0, lastTickAt: 0 })
    expect(snapshotAt(s, 10).population).toBe(BASE_GROWTH_PER_SEC * 10)
  })

  it('throws when at is earlier than lastTickAt', () => {
    const s = state()
    expect(() => snapshotAt(s, s.lastTickAt - 1)).toThrow(RangeError)
  })

  it('throws for a non-finite timestamp', () => {
    const s = state()
    expect(() => snapshotAt(s, Number.NaN)).toThrow(RangeError)
    expect(() => snapshotAt(s, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('reports cap, growthPerSec and at in the snapshot', () => {
    const s = state({ housingLevels: 2, hydroponicsLevels: 1, lastTickAt: 1000 })
    const snap = snapshotAt(s, 1010)
    expect(snap.cap).toBe(populationCap(2))
    expect(snap.growthPerSec).toBe(growthRateFor(2, 1))
    expect(snap.at).toBe(1010)
  })
})

describe('applyGrowth', () => {
  it('is immutable and returns a new state object', () => {
    const s = state()
    const next = applyGrowth(s, 1010)
    expect(next).not.toBe(s)
    expect(s.population).toBe(100)
    expect(s.lastTickAt).toBe(1000)
  })

  it('advances population and lastTickAt to at', () => {
    const next = applyGrowth(state(), 1010)
    expect(next.population).toBe(140)
    expect(next.lastTickAt).toBe(1010)
  })

  it('accumulates when called sequentially', () => {
    const first = applyGrowth(state(), 1010)
    const second = applyGrowth(first, 1020)
    expect(first.population).toBe(140)
    expect(second.population).toBe(140 + 4 * 10)
    expect(second.lastTickAt).toBe(1020)
  })
})

describe('applyWarLoss', () => {
  it('leaves population unchanged for a zero fraction', () => {
    const next = applyWarLoss(state({ population: 1000 }), 0, 1100)
    expect(next.population).toBe(1000)
  })

  it('reduces population to zero for a fraction of 1', () => {
    const next = applyWarLoss(state({ population: 1000 }), 1, 1100)
    expect(next.population).toBe(0)
  })

  it('applies a 25% loss as 75% of the population', () => {
    const next = applyWarLoss(state({ population: 1000 }), 0.25, 1100)
    expect(next.population).toBe(750)
  })

  it('floors the result at zero', () => {
    const next = applyWarLoss(state({ population: 1 }), 1, 1100)
    expect(next.population).toBe(0)
  })

  it('is immutable and advances lastTickAt to at', () => {
    const s = state({ population: 1000, lastTickAt: 1000 })
    const next = applyWarLoss(s, 0.5, 1200)
    expect(next).not.toBe(s)
    expect(s.population).toBe(1000)
    expect(s.lastTickAt).toBe(1000)
    expect(next.population).toBe(500)
    expect(next.lastTickAt).toBe(1200)
  })

  it('throws for an out-of-range fraction', () => {
    const s = state()
    expect(() => applyWarLoss(s, -0.1, 1100)).toThrow(RangeError)
    expect(() => applyWarLoss(s, 1.1, 1100)).toThrow(RangeError)
    expect(() => applyWarLoss(s, Number.NaN, 1100)).toThrow(RangeError)
    expect(() => applyWarLoss(s, Number.POSITIVE_INFINITY, 1100)).toThrow(RangeError)
  })

  it('throws when at is earlier than lastTickAt', () => {
    const s = state()
    expect(() => applyWarLoss(s, 0.5, s.lastTickAt - 1)).toThrow(RangeError)
  })
})

describe('populationInvariants', () => {
  it('reports ok for a valid state', () => {
    expect(populationInvariants(state())).toEqual({ ok: true, problems: [] })
  })

  it('catches a negative population', () => {
    const result = populationInvariants(state({ population: -1 }))
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('population must be non-negative')
  })

  it('catches a non-finite population', () => {
    const result = populationInvariants(state({ population: Number.NaN }))
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('population must be finite')
  })

  it('catches a population above the cap', () => {
    const s = state({ housingLevels: 0, population: BASE_POPULATION_CAP + 1 })
    const result = populationInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('population exceeds cap')
  })

  it('catches invalid housing and hydroponics levels', () => {
    const housing = populationInvariants(state({ housingLevels: -1 }))
    expect(housing.problems).toContain('housingLevels must be a non-negative integer')
    const fractional = populationInvariants(state({ hydroponicsLevels: 0.5 }))
    expect(fractional.problems).toContain('hydroponicsLevels must be a non-negative integer')
  })

  it('catches a non-positive or non-finite lastTickAt', () => {
    const zero = populationInvariants(state({ lastTickAt: 0 }))
    expect(zero.problems).toContain('lastTickAt must be a finite number greater than 0')
    const nan = populationInvariants(state({ lastTickAt: Number.NaN }))
    expect(nan.problems).toContain('lastTickAt must be a finite number greater than 0')
  })

  it('collects multiple problems at once', () => {
    const result = populationInvariants(
      state({ population: -5, housingLevels: -1, lastTickAt: Number.NaN }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(3)
  })
})

describe('determinism', () => {
  it('produces identical outputs for identical inputs', () => {
    const s = state({ population: 500, housingLevels: 2, hydroponicsLevels: 1, lastTickAt: 5000 })
    expect(snapshotAt(s, 6000)).toEqual(snapshotAt(s, 6000))
    expect(applyGrowth(s, 6000)).toEqual(applyGrowth(s, 6000))
    expect(applyWarLoss(s, 0.25, 6000)).toEqual(applyWarLoss(s, 0.25, 6000))
    expect(populationCapFor(4, 1.5)).toBe(populationCapFor(4, 1.5))
    expect(growthRateFor(3, 2)).toBe(growthRateFor(3, 2))
  })
})
