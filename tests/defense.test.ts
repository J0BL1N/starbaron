import { describe, expect, it } from 'vitest'
import {
  DEFENSE_BREAKDOWN_KEYS,
  defenseStateFor,
  defenseSummary,
  GARRISON_DEFENSE_PER_UNIT,
  readiness,
  READINESS_VULNERABLE_THRESHOLD,
} from '../src/sim/combat/defense'
import type { DefenseState } from '../src/sim/combat/defense'
import { effectiveLevel } from '../src/sim/planets/levels'
import {
  defensePower,
  MILITIA_DEFENSE_PER_POPULATION,
  TURRET_DEFENSE_POWER_PER_LEVEL,
} from '../src/sim/structures/effects'

describe('P7-T04 constants — locked DP delegation inputs and draft knobs', () => {
  it('pins GARRISON_DEFENSE_PER_UNIT = 0.1 and the vulnerable threshold = 0.5', () => {
    expect(GARRISON_DEFENSE_PER_UNIT).toBe(0.1)
    expect(READINESS_VULNERABLE_THRESHOLD).toBe(0.5)
  })

  it('reuses the LOCKED turret const from effects.ts (500)', () => {
    expect(TURRET_DEFENSE_POWER_PER_LEVEL).toBe(500)
    expect(MILITIA_DEFENSE_PER_POPULATION).toBe(0.15)
  })
})

describe('defenseStateFor — locked delegation + composition decision', () => {
  it('delegates to the locked defensePower and adds garrison × GARRISON_DEFENSE_PER_UNIT', () => {
    const state = defenseStateFor({
      planetName: 'Proxima Centauri b',
      turretLevels: 3,
      population: 10_000,
      garrison: 5_000,
    })
    expect(state.defensePower).toBe(
      defensePower(3, 10_000) + 5_000 * GARRISON_DEFENSE_PER_UNIT,
    )
    expect(state.defensePower).toBe(3_500)
  })

  it('hand-computes the spec composition: 3 turrets + 10k pop + 5k garrison', () => {
    const state = defenseStateFor({
      planetName: 'Proxima Centauri b',
      turretLevels: 3,
      population: 10_000,
      garrison: 5_000,
    })
    expect(state).toEqual({
      planetName: 'Proxima Centauri b',
      turretLevels: 3,
      population: 10_000,
      garrison: 5_000,
      defensePower: 3_500,
      breakdown: { turretPower: 1_500, militiaPower: 1_500, garrisonPower: 500 },
    })
  })

  it.each([
    { t: 0, p: 0, g: 0 },
    { t: 3, p: 10_000, g: 5_000 },
    { t: 15, p: 10_000, g: 2_500 },
    { t: 21, p: 0, g: 1_000 },
  ])('breakdown sums to defensePower (t $t, p $p, g $g)', ({ t, p, g }) => {
    const state = defenseStateFor({ planetName: 'P', turretLevels: t, population: p, garrison: g })
    const sum =
      state.breakdown.turretPower +
      state.breakdown.militiaPower +
      state.breakdown.garrisonPower
    expect(sum).toBeCloseTo(state.defensePower, 12)
    expect(state.breakdown.turretPower).toBeGreaterThanOrEqual(0)
    expect(state.breakdown.militiaPower).toBeGreaterThanOrEqual(0)
    expect(state.breakdown.garrisonPower).toBeGreaterThanOrEqual(0)
  })

  it('militiaPower is the militia remainder — never double-counted', () => {
    const state = defenseStateFor({
      planetName: 'P',
      turretLevels: 3,
      population: 10_000,
      garrison: 0,
    })
    expect(state.breakdown.turretPower).toBe(1_500)
    expect(state.breakdown.militiaPower).toBe(
      MILITIA_DEFENSE_PER_POPULATION * 10_000,
    )
    expect(state.breakdown.militiaPower).toBe(
      defensePower(3, 10_000) - state.breakdown.turretPower,
    )
  })

  it('turretPower mirrors the locked turret term with effectiveLevel (half-after-10)', () => {
    const state = defenseStateFor({
      planetName: 'P',
      turretLevels: 15,
      population: 10_000,
      garrison: 0,
    })
    expect(effectiveLevel(15)).toBe(12.5)
    expect(state.breakdown.turretPower).toBe(
      TURRET_DEFENSE_POWER_PER_LEVEL * effectiveLevel(15),
    )
    expect(state.breakdown.turretPower).toBe(6_250)
    expect(state.breakdown.militiaPower).toBe(1_500)
    expect(state.defensePower).toBe(7_750)
  })

  it('all-zero input yields an all-zero state', () => {
    const state = defenseStateFor({
      planetName: 'P',
      turretLevels: 0,
      population: 0,
      garrison: 0,
    })
    expect(state).toEqual({
      planetName: 'P',
      turretLevels: 0,
      population: 0,
      garrison: 0,
      defensePower: 0,
      breakdown: { turretPower: 0, militiaPower: 0, garrisonPower: 0 },
    })
  })

  it('garrison-only when turrets and population are zero; locked-only when garrison is zero', () => {
    const garrisonOnly = defenseStateFor({
      planetName: 'P',
      turretLevels: 0,
      population: 0,
      garrison: 5_000,
    })
    expect(garrisonOnly.defensePower).toBe(500)
    expect(garrisonOnly.breakdown.garrisonPower).toBe(500)

    const lockedOnly = defenseStateFor({
      planetName: 'P',
      turretLevels: 3,
      population: 10_000,
      garrison: 0,
    })
    expect(lockedOnly.defensePower).toBe(defensePower(3, 10_000))
    expect(lockedOnly.breakdown.garrisonPower).toBe(0)
  })

  it('is deterministic — identical inputs yield identical states', () => {
    const input = {
      planetName: 'P',
      turretLevels: 4,
      population: 8_000,
      garrison: 2_000,
    }
    expect(defenseStateFor(input)).toEqual(defenseStateFor(input))
  })
})

describe('defenseStateFor — validation', () => {
  it.each([-1, 0.5])('rejects turretLevels %s', (turretLevels) => {
    expect(() =>
      defenseStateFor({ planetName: 'P', turretLevels, population: 1_000, garrison: 0 }),
    ).toThrow(RangeError)
  })

  it.each([Number.NaN, -1, Number.NEGATIVE_INFINITY])(
    'rejects population %s',
    (population) => {
      expect(() =>
        defenseStateFor({ planetName: 'P', turretLevels: 1, population, garrison: 0 }),
      ).toThrow(RangeError)
    },
  )

  it.each([Number.NaN, -1, Number.NEGATIVE_INFINITY])(
    'rejects garrison %s',
    (garrison) => {
      expect(() =>
        defenseStateFor({ planetName: 'P', turretLevels: 1, population: 1_000, garrison }),
      ).toThrow(RangeError)
    },
  )

  it.each(['', '   '])('rejects planetName %j', (planetName) => {
    expect(() =>
      defenseStateFor({ planetName, turretLevels: 0, population: 0, garrison: 0 }),
    ).toThrow(RangeError)
  })
})

describe('readiness — coverage math and the vulnerable threshold', () => {
  it('coverage 0.8 → defended with the spec message', () => {
    const state = readiness({ turretLevels: 3, population: 10_000, garrison: 8_000, fleet: 2_000 })
    expect(state.garrisonCoverage).toBeCloseTo(0.8, 12)
    expect(state.vulnerable).toBe(false)
    expect(state.message).toBe('Defended · 80% of military at home')
  })

  it('coverage 0.3 → VULNERABLE with the spec message', () => {
    const state = readiness({ turretLevels: 3, population: 10_000, garrison: 3_000, fleet: 7_000 })
    expect(state.garrisonCoverage).toBeCloseTo(0.3, 12)
    expect(state.vulnerable).toBe(true)
    expect(state.message).toBe('VULNERABLE · 30% at home')
  })

  it('all fleet away → coverage 0 and vulnerable', () => {
    const state = readiness({ turretLevels: 1, population: 1_000, garrison: 0, fleet: 5_000 })
    expect(state.garrisonCoverage).toBe(0)
    expect(state.vulnerable).toBe(true)
    expect(state.message).toBe('VULNERABLE · 0% at home')
  })

  it('all military at home → coverage 1 and defended', () => {
    const state = readiness({ turretLevels: 1, population: 1_000, garrison: 5_000, fleet: 0 })
    expect(state.garrisonCoverage).toBe(1)
    expect(state.vulnerable).toBe(false)
    expect(state.message).toBe('Defended · 100% of military at home')
  })

  it('empty military (0 garrison AND 0 fleet) → coverage 0, exposed', () => {
    const state = readiness({ turretLevels: 0, population: 0, garrison: 0, fleet: 0 })
    expect(state.garrisonCoverage).toBe(0)
    expect(state.vulnerable).toBe(true)
    expect(state.message).toBe('VULNERABLE · 0% at home')
  })

  it('exactly half at home (0.5) is NOT vulnerable — strictly below the threshold', () => {
    const state = readiness({ turretLevels: 0, population: 0, garrison: 5_000, fleet: 5_000 })
    expect(state.garrisonCoverage).toBe(0.5)
    expect(state.vulnerable).toBe(false)
    expect(state.message).toBe('Defended · 50% of military at home')
  })

  it('just below the threshold (0.4999) is vulnerable and rounds to 50%', () => {
    const state = readiness({ turretLevels: 0, population: 0, garrison: 4_999, fleet: 5_001 })
    expect(state.garrisonCoverage).toBeCloseTo(0.4999, 12)
    expect(state.vulnerable).toBe(true)
    expect(state.message).toBe('VULNERABLE · 50% at home')
  })

  it('message percentage rounds to the nearest integer (0.456 → 46%)', () => {
    const state = readiness({ turretLevels: 0, population: 0, garrison: 456, fleet: 544 })
    expect(state.garrisonCoverage).toBeCloseTo(0.456, 12)
    expect(state.vulnerable).toBe(true)
    expect(state.message).toBe('VULNERABLE · 46% at home')
  })

  it.each([
    [8_000, 2_000, 0.8],
    [5_000, 0, 1],
    [0, 5_000, 0],
    [1, 1, 0.5],
    [999, 1, 0.999],
  ])('coverage for garrison %s / fleet %s is clamped into [0,1]', (garrison, fleet, expected) => {
    const state = readiness({ turretLevels: 0, population: 0, garrison, fleet })
    expect(state.garrisonCoverage).toBeCloseTo(expected, 12)
    expect(state.garrisonCoverage).toBeGreaterThanOrEqual(0)
    expect(state.garrisonCoverage).toBeLessThanOrEqual(1)
  })

  it('is deterministic — identical inputs yield identical readiness', () => {
    const input = { turretLevels: 2, population: 5_000, garrison: 3_000, fleet: 3_000 }
    expect(readiness(input)).toEqual(readiness(input))
  })
})

describe('readiness — validation', () => {
  it.each([
    ['garrison', -1],
    ['garrison', Number.NaN],
    ['fleet', -1],
    ['fleet', Number.NaN],
  ])('rejects %s %s', (field, value) => {
    const input = { turretLevels: 0, population: 0, garrison: 1_000, fleet: 1_000 }
    if (field === 'garrison') {
      input.garrison = value
    } else {
      input.fleet = value
    }
    expect(() => readiness(input)).toThrow(RangeError)
  })

  it.each([
    ['turretLevels', -1],
    ['turretLevels', 0.5],
    ['population', -1],
    ['population', Number.NaN],
  ])('rejects %s %s', (field, value) => {
    const input = { turretLevels: 0, population: 0, garrison: 1_000, fleet: 1_000 }
    if (field === 'turretLevels') {
      input.turretLevels = value
    } else {
      input.population = value
    }
    expect(() => readiness(input)).toThrow(RangeError)
  })
})

describe('defenseSummary — deterministic one-line defense state', () => {
  it('renders the exact spec format for a hand-built state', () => {
    const state: DefenseState = {
      planetName: 'P',
      turretLevels: 3,
      population: 0,
      garrison: 0,
      defensePower: 2_200,
      breakdown: { turretPower: 1_500, militiaPower: 200, garrisonPower: 500 },
    }
    expect(defenseSummary(state)).toBe(
      '3 turrets · 1.5K DP + 200 militia + 500 garrison = 2.2K DP',
    )
  })

  it('summarises a defenseStateFor result (3 turrets, 10k pop, 5k garrison)', () => {
    const state = defenseStateFor({
      planetName: 'P',
      turretLevels: 3,
      population: 10_000,
      garrison: 5_000,
    })
    expect(defenseSummary(state)).toBe(
      '3 turrets · 1.5K DP + 1.5K militia + 500 garrison = 3.5K DP',
    )
  })

  it('formats large values with suffixes (20 turrets, 40k pop, 10k garrison)', () => {
    const state = defenseStateFor({
      planetName: 'P',
      turretLevels: 20,
      population: 40_000,
      garrison: 10_000,
    })
    expect(defenseSummary(state)).toBe(
      '20 turrets · 7.5K DP + 6K militia + 1K garrison = 14.5K DP',
    )
  })

  it('renders an all-zero state as zeroes', () => {
    const state = defenseStateFor({
      planetName: 'P',
      turretLevels: 0,
      population: 0,
      garrison: 0,
    })
    expect(defenseSummary(state)).toBe(
      '0 turrets · 0 DP + 0 militia + 0 garrison = 0 DP',
    )
  })

  it('is deterministic for a fixed state', () => {
    const state = defenseStateFor({
      planetName: 'P',
      turretLevels: 6,
      population: 20_000,
      garrison: 4_000,
    })
    expect(defenseSummary(state)).toBe(defenseSummary(state))
  })
})

describe('module purity — deep-frozen lookup table', () => {
  it('DEFENSE_BREAKDOWN_KEYS is frozen with the canonical order', () => {
    expect(Object.isFrozen(DEFENSE_BREAKDOWN_KEYS)).toBe(true)
    expect([...DEFENSE_BREAKDOWN_KEYS]).toEqual([
      'turretPower',
      'militiaPower',
      'garrisonPower',
    ])
  })

  it('mutating the frozen table throws TypeError (runtime-immutable)', () => {
    expect(() => {
      ;(DEFENSE_BREAKDOWN_KEYS as unknown as string[]).push('colonistPower')
    }).toThrow(TypeError)
  })
})
