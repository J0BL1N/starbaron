import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import type { PlanetCatalogueEntry, PlanetTier } from '../src/sim/data/planets'
import {
  baselinePassiveIncome,
  BASE_INCOME_PER_TIER,
} from '../src/sim/core/economy'
import { structureEffect } from '../src/sim/structures/effects'
import { STRUCTURE_IDS } from '../src/sim/structures/data'
import type { StructureId } from '../src/sim/structures/types'
import {
  effectiveLevel,
  EFFECTIVE_LEVEL_CAP,
  DIMINISHING_RETURNS_FACTOR,
  TIER_POP_CAP_MULTIPLIER,
  makePlanet,
} from '../src/sim/planets'

const TIERS: PlanetTier[] = [1, 2, 3, 4, 5]

function sampleEntry(tier: PlanetTier): PlanetCatalogueEntry {
  const entry = PLANETS.find((p) => p.tier === tier)
  expect(entry).toBeDefined()
  return entry as PlanetCatalogueEntry
}

describe('P2-T02-B makePlanet derived stats', () => {
  it('baseline income is 10 x tier for every tier (DESIGN §4d)', () => {
    for (const tier of TIERS) {
      const planet = makePlanet(sampleEntry(tier))
      expect(planet.baselineIncomePerSec).toBe(BASE_INCOME_PER_TIER * tier)
      expect(planet.baselineIncomePerSec).toBe(baselinePassiveIncome(tier))
      expect(planet.tier).toBe(tier)
    }
  })

  it('pop-cap multiplier matches the locked T1-T5 table (1.0/1.2/1.4/1.7/2.0)', () => {
    expect(TIER_POP_CAP_MULTIPLIER).toEqual({
      1: 1.0,
      2: 1.2,
      3: 1.4,
      4: 1.7,
      5: 2.0,
    })
    for (const tier of TIERS) {
      const planet = makePlanet(sampleEntry(tier))
      expect(planet.populationCapMultiplier).toBe(TIER_POP_CAP_MULTIPLIER[tier])
    }
  })

  it('embeds an immutable copy of the catalogue entry and mirrors its tier', () => {
    const entry = PLANETS[0]
    const planet = makePlanet(entry)
    expect(planet.entry).toEqual(entry)
    expect(planet.entry).not.toBe(entry)
    expect(planet.entry.name).toBe(entry.name)
    expect(planet.tier).toBe(entry.tier)
  })

  it('mutating the returned entry does not corrupt the shared catalogue', () => {
    const source = PLANETS[1]
    const originalName = source.name
    const planet = makePlanet(source)
    expect(planet.entry).toEqual(source)
    planet.entry.name = 'MUTATED-BY-TEST'
    expect(source.name).toBe(originalName)
    expect(PLANETS[1].name).toBe(originalName)
    expect(planet.generate().description.length).toBeGreaterThan(10)
  })

  it('generate() returns a deterministic PlanetIdentity for the same entry', () => {
    const planet = makePlanet(sampleEntry(3))
    expect(planet.generate()).toEqual(planet.generate())
    expect(planet.generate().visual.surfacePalette.length).toBeGreaterThanOrEqual(2)
    expect(planet.generate().description.length).toBeGreaterThan(10)
  })
})

describe('P2-T02-B effectiveLevel diminishing returns (DESIGN §4d line 88)', () => {
  it('is fully effective up to level 10', () => {
    for (const level of [0, 1, 2, 5, 10]) {
      expect(effectiveLevel(level)).toBe(level)
    }
  })

  it('counts levels beyond 10 as half (boundary at 10/11)', () => {
    expect(effectiveLevel(10)).toBe(10)
    expect(effectiveLevel(11)).toBe(10.5)
    expect(effectiveLevel(12)).toBe(11)
    expect(effectiveLevel(20)).toBe(15)
  })

  it('matches min(level,10) + max(0,level-10)*0.5 exactly', () => {
    for (const level of [0, 1, 5, 10, 11, 15, 100, 1_000]) {
      const expected = Math.min(level, 10) + Math.max(0, level - 10) * 0.5
      expect(effectiveLevel(level)).toBe(expected)
    }
  })

  it('exposes the cap and factor constants', () => {
    expect(EFFECTIVE_LEVEL_CAP).toBe(10)
    expect(DIMINISHING_RETURNS_FACTOR).toBe(0.5)
  })

  it('throws for negative or fractional levels', () => {
    expect(() => effectiveLevel(-1)).toThrow(RangeError)
    expect(() => effectiveLevel(1.5)).toThrow(RangeError)
    expect(() => effectiveLevel(Number.NaN)).toThrow(RangeError)
    expect(() => effectiveLevel(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('P2-T02-B effectiveLevel consumed by structure effects', () => {
  it('structureEffect at level 10 vs 11 halves the marginal effect', () => {
    const at10 = structureEffect('oreMine', 10)
    const at11 = structureEffect('oreMine', 11)
    if (at10.kind !== 'alloys' || at11.kind !== 'alloys') {
      throw new Error('expected alloys effect')
    }
    const delta = at11.alloysPerSec - at10.alloysPerSec
    expect(delta).toBeCloseTo((5 / 60) * 0.5, 12)
  })

  it('level 20 oreMine output equals 5/60 * effectiveLevel(20)', () => {
    const at20 = structureEffect('oreMine', 20)
    if (at20.kind !== 'alloys') {
      throw new Error('expected alloys effect')
    }
    expect(at20.alloysPerSec).toBeCloseTo((5 / 60) * effectiveLevel(20), 12)
    expect(effectiveLevel(20)).toBe(15)
  })

  it('all 7 structures consume effectiveLevel at level 100', () => {
    const eff = effectiveLevel(100)
    expect(eff).toBe(55)
    for (const id of STRUCTURE_IDS as readonly StructureId[]) {
      const effect = structureEffect(id, 100)
      for (const [key, value] of Object.entries(effect)) {
        if (key === 'kind') continue
        expect(Number.isFinite(value), `${id}.${key}`).toBe(true)
        expect(Number.isNaN(value), `${id}.${key}`).toBe(false)
      }
    }
  })
})
