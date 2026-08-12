import { describe, expect, it } from 'vitest'
import {
  BASE_GROWTH_PER_SEC,
  BASE_POPULATION_CAP,
  populationCap,
  populationGrowthPerSec,
} from '../src/sim/core/population'
import { applyGrowth, populationCapFor } from '../src/sim/core/population-model'
import type { PopulationState } from '../src/sim/core/population-model'
import { structureCost } from '../src/sim/core/economy'
import { upgradeCost } from '../src/sim/structures/framework'
import {
  housingCap,
  housingCapBonus,
  housingGrowthBonus,
  housingSnapshot,
  housingUiState,
  housingUpgradeCost,
  offlineHousingOutcome,
} from '../src/sim/structures/housing'
import type {
  HousingSnapshot,
  HousingUiState,
} from '../src/sim/structures/housing'

function state(overrides: Partial<PopulationState> = {}): PopulationState {
  return {
    population: 100,
    housingLevels: 1,
    hydroponicsLevels: 0,
    lastTickAt: 1000,
    ...overrides,
  }
}

const SWEEP_LEVELS = [0, 1, 3, 7, 10, 25, 100]

describe('housingCapBonus', () => {
  it('returns 0 at level 0 and hand-computed offsets at 3 and 10', () => {
    expect(housingCapBonus(0)).toBe(0)
    expect(housingCapBonus(3)).toBe(3_000)
    expect(housingCapBonus(10)).toBe(10_000)
  })

  it('wraps the locked formula populationCap(level) - BASE_POPULATION_CAP exactly', () => {
    for (const level of SWEEP_LEVELS) {
      expect(housingCapBonus(level), `level ${level}`).toBe(
        populationCap(level) - BASE_POPULATION_CAP,
      )
    }
    expect(housingCapBonus(100)).toBe(100_000)
  })

  it('throws RangeError for a negative level', () => {
    expect(() => housingCapBonus(-1)).toThrow(RangeError)
  })

  it('throws RangeError for a non-integer or NaN level', () => {
    expect(() => housingCapBonus(1.5)).toThrow(RangeError)
    expect(() => housingCapBonus(Number.NaN)).toThrow(RangeError)
  })
})

describe('housingGrowthBonus', () => {
  it('returns 0 at level 0 and HOUSING_GROWTH_PER_LEVEL × level otherwise', () => {
    expect(housingGrowthBonus(0)).toBe(0)
    expect(housingGrowthBonus(3)).toBe(6)
    expect(housingGrowthBonus(10)).toBe(20)
    expect(housingGrowthBonus(100)).toBe(200)
  })

  it('matches the locked populationGrowthPerSec housing term exactly', () => {
    for (const level of SWEEP_LEVELS) {
      expect(housingGrowthBonus(level), `level ${level}`).toBe(
        populationGrowthPerSec(level) - BASE_GROWTH_PER_SEC,
      )
    }
  })

  it('throws RangeError for a negative level', () => {
    expect(() => housingGrowthBonus(-1)).toThrow(RangeError)
  })

  it('throws RangeError for a non-integer or NaN level', () => {
    expect(() => housingGrowthBonus(2.5)).toThrow(RangeError)
    expect(() => housingGrowthBonus(Number.NaN)).toThrow(RangeError)
  })
})

describe('housingCap', () => {
  it('multiplies the locked populationCap by the tier multiplier', () => {
    expect(housingCap(0, 1)).toBe(BASE_POPULATION_CAP)
    expect(housingCap(3, 1.4)).toBe(11_200)
    expect(housingCap(10, 1)).toBe(populationCap(10))
    expect(housingCap(100, 1.4)).toBe(147_000)
  })

  it('equals the existing locked populationCapFor for identical inputs', () => {
    for (const level of SWEEP_LEVELS) {
      for (const multiplier of [1, 1.4]) {
        expect(housingCap(level, multiplier), `level ${level} mult ${multiplier}`).toBe(
          populationCapFor(level, multiplier),
        )
      }
    }
  })

  it('throws RangeError for a non-positive or non-finite multiplier', () => {
    expect(() => housingCap(0, 0)).toThrow(RangeError)
    expect(() => housingCap(0, -2)).toThrow(RangeError)
    expect(() => housingCap(0, Number.NaN)).toThrow(RangeError)
    expect(() => housingCap(0, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('throws RangeError for a bad level', () => {
    expect(() => housingCap(-1, 1)).toThrow(RangeError)
    expect(() => housingCap(1.5, 1)).toThrow(RangeError)
  })
})

describe('housingUpgradeCost', () => {
  it('delegates to the locked framework upgradeCost curve', () => {
    for (const level of SWEEP_LEVELS) {
      expect(housingUpgradeCost(level), `level ${level}`).toBe(
        upgradeCost('housing', level),
      )
      expect(housingUpgradeCost(level), `level ${level}`).toBe(
        structureCost(300, level),
      )
    }
  })

  it('returns the base cost at level 0 and scales by 1.15^level', () => {
    expect(housingUpgradeCost(0)).toBe(300)
    expect(housingUpgradeCost(3)).toBeCloseTo(300 * 1.15 ** 3, 10)
  })

  it('throws RangeError for a negative or non-integer level', () => {
    expect(() => housingUpgradeCost(-1)).toThrow(RangeError)
    expect(() => housingUpgradeCost(1.5)).toThrow(RangeError)
  })
})

describe('housingSnapshot', () => {
  it('returns the exact HousingSnapshot shape with hand-computed values', () => {
    const snapshot: HousingSnapshot = housingSnapshot(3, 1.4, 12_345)
    expect(snapshot).toEqual({
      level: 3,
      capBonus: 3_000,
      growthBonus: 6,
      nextUpgradeCost: 300 * 1.15 ** 3,
      at: 12_345,
    })
  })

  it('matches the individual function outputs and echoes at', () => {
    const snapshot = housingSnapshot(10, 1, 9_999)
    expect(snapshot.level).toBe(10)
    expect(snapshot.capBonus).toBe(housingCapBonus(10))
    expect(snapshot.growthBonus).toBe(housingGrowthBonus(10))
    expect(snapshot.nextUpgradeCost).toBe(housingUpgradeCost(10))
    expect(snapshot.at).toBe(9_999)
  })

  it('returns a fresh object each call and is deterministic', () => {
    const a = housingSnapshot(3, 1.4, 500)
    const b = housingSnapshot(3, 1.4, 500)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('throws RangeError for an invalid timestamp (0, negative, NaN, Infinity)', () => {
    expect(() => housingSnapshot(0, 1, 0)).toThrow(RangeError)
    expect(() => housingSnapshot(0, 1, -5)).toThrow(RangeError)
    expect(() => housingSnapshot(0, 1, Number.NaN)).toThrow(RangeError)
    expect(() => housingSnapshot(0, 1, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('throws RangeError for an invalid multiplier or level', () => {
    expect(() => housingSnapshot(0, 0, 100)).toThrow(RangeError)
    expect(() => housingSnapshot(-1, 1, 100)).toThrow(RangeError)
  })
})

describe('offlineHousingOutcome', () => {
  it('equals applyGrowth for identical inputs and flows housing levels through', () => {
    const s = state({ population: 0, housingLevels: 3, hydroponicsLevels: 1, lastTickAt: 1000 })
    expect(offlineHousingOutcome(s, 1010)).toEqual(applyGrowth(s, 1010))
    expect(offlineHousingOutcome(s, 1010).population).toBe(
      populationGrowthPerSec(3, 1) * 10,
    )
  })

  it('advances lastTickAt and clamps population at the housing cap', () => {
    const s = state({ population: 4_999, housingLevels: 0, lastTickAt: 0 })
    const next = offlineHousingOutcome(s, 100)
    expect(next.population).toBe(BASE_POPULATION_CAP)
    expect(next.lastTickAt).toBe(100)
  })

  it('is immutable and deterministic', () => {
    const s = state()
    const before = { ...s }
    const next = offlineHousingOutcome(s, 1010)
    expect(next).not.toBe(s)
    expect(s).toEqual(before)
    expect(offlineHousingOutcome(s, 1010)).toEqual(offlineHousingOutcome(s, 1010))
  })

  it('throws RangeError when at is earlier than lastTickAt', () => {
    expect(() => offlineHousingOutcome(state(), 999)).toThrow(RangeError)
  })

  it('throws RangeError for a non-finite or non-positive at', () => {
    const s = state()
    expect(() => offlineHousingOutcome(s, Number.NaN)).toThrow(RangeError)
    expect(() => offlineHousingOutcome(s, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => offlineHousingOutcome(s, 0)).toThrow(RangeError)
  })
})

describe('housingUiState', () => {
  it('returns the exact UI shape with fields matching the underlying functions', () => {
    const ui: HousingUiState = housingUiState(3, 1)
    expect(ui.level).toBe(3)
    expect(ui.capBonus).toBe(housingCapBonus(3))
    expect(ui.growthBonus).toBe(housingGrowthBonus(3))
    expect(ui.nextUpgradeCost).toBe(housingUpgradeCost(3))
    expect(typeof ui.display).toBe('string')
  })

  it('builds deterministic display strings (no locale APIs)', () => {
    expect(housingUiState(3, 1).display).toBe('+3,000 pop cap · +6/s')
    expect(housingUiState(0, 1).display).toBe('+0 pop cap · +0/s')
    expect(housingUiState(100, 1).display).toBe('+100,000 pop cap · +200/s')
    expect(housingUiState(3, 1.4).display).toBe(housingUiState(3, 1.4).display)
  })

  it('throws RangeError for an invalid level or multiplier', () => {
    expect(() => housingUiState(-1, 1)).toThrow(RangeError)
    expect(() => housingUiState(1.5, 1)).toThrow(RangeError)
    expect(() => housingUiState(0, 0)).toThrow(RangeError)
  })
})
