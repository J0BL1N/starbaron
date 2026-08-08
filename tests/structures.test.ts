import { describe, expect, it } from 'vitest'
import { structureCost } from '../src/sim/core/economy'
import {
  STRUCTURES,
  STRUCTURE_IDS,
  isStructureId,
} from '../src/sim/structures/data'
import {
  nextBuildCost,
  structureEffect,
  defensePower,
} from '../src/sim/structures/effects'
import { StructureCategory } from '../src/sim/structures/types'
import type { StructureEffect } from '../src/sim/structures/types'

function asKind<K extends StructureEffect['kind']>(
  effect: StructureEffect,
  kind: K,
): Extract<StructureEffect, { kind: K }> {
  expect(effect.kind).toBe(kind)
  return effect as Extract<StructureEffect, { kind: K }>
}

describe('structure records', () => {
  it('defines exactly the 7 audited structures', () => {
    expect(STRUCTURE_IDS).toHaveLength(7)
    expect([...STRUCTURE_IDS].sort()).toEqual(Object.keys(STRUCTURES).sort())
  })

  it('exposes the four categories', () => {
    expect(StructureCategory.Economy).toBe('Economy')
    expect(StructureCategory.Population).toBe('Population')
    expect(StructureCategory.Military).toBe('Military')
    expect(StructureCategory.Defense).toBe('Defense')
  })

  it('oreMine: Economy, 500 cr, 30s', () => {
    expect(STRUCTURES.oreMine).toMatchObject({
      id: 'oreMine',
      name: 'Ore Mine',
      category: StructureCategory.Economy,
      baseCost: 500,
      buildTimeSec: 30,
    })
    expect(STRUCTURES.oreMine.alloyCost).toBeUndefined()
  })

  it('tradeHub: Economy, 2,000 cr, 2min', () => {
    expect(STRUCTURES.tradeHub).toMatchObject({
      id: 'tradeHub',
      name: 'Trade Hub',
      category: StructureCategory.Economy,
      baseCost: 2_000,
      buildTimeSec: 120,
    })
    expect(STRUCTURES.tradeHub.alloyCost).toBeUndefined()
  })

  it('housing: Population, 300 cr, 20s', () => {
    expect(STRUCTURES.housing).toMatchObject({
      id: 'housing',
      name: 'Housing',
      category: StructureCategory.Population,
      baseCost: 300,
      buildTimeSec: 20,
    })
    expect(STRUCTURES.housing.alloyCost).toBeUndefined()
  })

  it('hydroponics: Population, 800 cr, 45s', () => {
    expect(STRUCTURES.hydroponics).toMatchObject({
      id: 'hydroponics',
      name: 'Hydroponics',
      category: StructureCategory.Population,
      baseCost: 800,
      buildTimeSec: 45,
    })
    expect(STRUCTURES.hydroponics.alloyCost).toBeUndefined()
  })

  it('barracks: Military, 1,500 cr, 1min', () => {
    expect(STRUCTURES.barracks).toMatchObject({
      id: 'barracks',
      name: 'Barracks',
      category: StructureCategory.Military,
      baseCost: 1_500,
      buildTimeSec: 60,
    })
    expect(STRUCTURES.barracks.alloyCost).toBeUndefined()
  })

  it('shipyard: Military, 5,000 cr, 5min', () => {
    expect(STRUCTURES.shipyard).toMatchObject({
      id: 'shipyard',
      name: 'Shipyard',
      category: StructureCategory.Military,
      baseCost: 5_000,
      buildTimeSec: 300,
    })
    expect(STRUCTURES.shipyard.alloyCost).toBeUndefined()
  })

  it('defenseTurret: Defense, 2,000 cr + 1,000 alloys, 3min', () => {
    expect(STRUCTURES.defenseTurret).toMatchObject({
      id: 'defenseTurret',
      name: 'Defense Turret',
      category: StructureCategory.Defense,
      baseCost: 2_000,
      alloyCost: 1_000,
      buildTimeSec: 180,
    })
  })
})

describe('structureEffect formulas', () => {
  it('oreMine: (5/60) x level alloys per sec', () => {
    expect(structureEffect('oreMine', 0)).toEqual({ kind: 'alloys', alloysPerSec: 0 })
    expect(asKind(structureEffect('oreMine', 1), 'alloys').alloysPerSec).toBeCloseTo(5 / 60, 10)
    expect(asKind(structureEffect('oreMine', 3), 'alloys').alloysPerSec).toBeCloseTo(15 / 60, 10)
  })

  it('tradeHub: 1 + 0.10 x level income multiplier', () => {
    expect(asKind(structureEffect('tradeHub', 0), 'incomeMultiplier').multiplier).toBe(1)
    expect(asKind(structureEffect('tradeHub', 1), 'incomeMultiplier').multiplier).toBeCloseTo(1.1, 10)
    expect(asKind(structureEffect('tradeHub', 3), 'incomeMultiplier').multiplier).toBeCloseTo(1.3, 10)
  })

  it('housing: +1,000 x level pop cap, +2 x level growth per sec', () => {
    expect(structureEffect('housing', 0)).toEqual({
      kind: 'population',
      popCapBonus: 0,
      popGrowthBonusPerSec: 0,
    })
    const e1 = asKind(structureEffect('housing', 1), 'population')
    expect(e1.popCapBonus).toBe(1_000)
    expect(e1.popGrowthBonusPerSec).toBe(2)
    const e3 = asKind(structureEffect('housing', 3), 'population')
    expect(e3.popCapBonus).toBe(3_000)
    expect(e3.popGrowthBonusPerSec).toBe(6)
  })

  it('hydroponics: 1 + 0.50 x level growth multiplier', () => {
    expect(asKind(structureEffect('hydroponics', 0), 'growthMultiplier').multiplier).toBe(1)
    expect(asKind(structureEffect('hydroponics', 1), 'growthMultiplier').multiplier).toBeCloseTo(1.5, 10)
    expect(asKind(structureEffect('hydroponics', 3), 'growthMultiplier').multiplier).toBeCloseTo(2.5, 10)
  })

  it('barracks: 10 x level conversion + 5,000 x level garrison cap', () => {
    expect(structureEffect('barracks', 0)).toEqual({
      kind: 'barracks',
      soldierConversionPerSec: 0,
      garrisonCap: 0,
    })
    const e1 = asKind(structureEffect('barracks', 1), 'barracks')
    expect(e1.soldierConversionPerSec).toBe(10)
    expect(e1.garrisonCap).toBe(5_000)
    const e3 = asKind(structureEffect('barracks', 3), 'barracks')
    expect(e3.soldierConversionPerSec).toBe(30)
    expect(e3.garrisonCap).toBe(15_000)
  })

  it('shipyard: 1,000 x level fleet cap + (50/60) x level credits per sec', () => {
    expect(structureEffect('shipyard', 0)).toEqual({
      kind: 'shipyard',
      fleetCap: 0,
      shipbuildingIncomePerSec: 0,
    })
    const e1 = asKind(structureEffect('shipyard', 1), 'shipyard')
    expect(e1.fleetCap).toBe(1_000)
    expect(e1.shipbuildingIncomePerSec).toBeCloseTo(50 / 60, 10)
    const e3 = asKind(structureEffect('shipyard', 3), 'shipyard')
    expect(e3.fleetCap).toBe(3_000)
    expect(e3.shipbuildingIncomePerSec).toBeCloseTo(150 / 60, 10)
  })

  it('defenseTurret: 500 x level defense power', () => {
    expect(structureEffect('defenseTurret', 0)).toEqual({ kind: 'defense', defensePower: 0 })
    expect(asKind(structureEffect('defenseTurret', 1), 'defense').defensePower).toBe(500)
    expect(asKind(structureEffect('defenseTurret', 3), 'defense').defensePower).toBe(1_500)
  })
})

describe('defensePower formula', () => {
  it('combines turret DP with the 0.15 militia term', () => {
    expect(defensePower(0, 0)).toBe(0)
    expect(defensePower(0, 1_000)).toBe(150)
    expect(defensePower(1, 1_000)).toBe(650)
    expect(defensePower(8, 40_000)).toBe(10_000)
  })

  it('throws for negative or fractional turret levels', () => {
    expect(() => defensePower(-1, 0)).toThrow(RangeError)
    expect(() => defensePower(1.5, 0)).toThrow(RangeError)
    expect(() => defensePower(Number.NaN, 0)).toThrow(RangeError)
  })

  it('throws for negative or non-finite population', () => {
    expect(() => defensePower(1, -1)).toThrow(RangeError)
    expect(() => defensePower(1, Number.NaN)).toThrow(RangeError)
    expect(() => defensePower(1, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('structureEffect level validation', () => {
  it('throws for negative levels', () => {
    for (const id of STRUCTURE_IDS) {
      expect(() => structureEffect(id, -1)).toThrow(RangeError)
    }
  })

  it('throws for fractional levels', () => {
    for (const id of STRUCTURE_IDS) {
      expect(() => structureEffect(id, 1.5)).toThrow(RangeError)
    }
  })

  it('throws for non-finite levels', () => {
    for (const id of STRUCTURE_IDS) {
      expect(() => structureEffect(id, Number.NaN)).toThrow(RangeError)
      expect(() => structureEffect(id, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    }
  })
})

describe('structure id validation', () => {
  it('isStructureId accepts the 7 ids and rejects everything else', () => {
    for (const id of STRUCTURE_IDS) {
      expect(isStructureId(id)).toBe(true)
    }
    expect(isStructureId('shieldGenerator')).toBe(false)
    expect(isStructureId('')).toBe(false)
    expect(isStructureId('toString')).toBe(false)
    expect(isStructureId(42)).toBe(false)
    expect(isStructureId(undefined)).toBe(false)
    expect(isStructureId(null)).toBe(false)
  })

  it('structureEffect throws RangeError for an unknown id', () => {
    const unknown = 'shieldGenerator' as unknown as 'oreMine'
    expect(() => structureEffect(unknown, 1)).toThrow(RangeError)
  })

  it('nextBuildCost throws RangeError for an unknown id', () => {
    const unknown = 'shieldGenerator' as unknown as 'oreMine'
    expect(() => nextBuildCost(unknown, 1)).toThrow(RangeError)
  })
})

describe('cost curve integration (structureCost reuse)', () => {
  it('nextBuildCost delegates to economy.structureCost', () => {
    expect(nextBuildCost('oreMine', 0)).toBe(structureCost(500, 0))
    expect(nextBuildCost('housing', 1)).toBe(structureCost(STRUCTURES.housing.baseCost, 1))
    expect(nextBuildCost('shipyard', 3)).toBe(structureCost(STRUCTURES.shipyard.baseCost, 3))
    expect(nextBuildCost('defenseTurret', 2)).toBe(structureCost(2_000, 2))
  })

  it('prices the first build at the table base cost', () => {
    expect(nextBuildCost('oreMine', 0)).toBe(500)
    expect(nextBuildCost('tradeHub', 0)).toBe(2_000)
    expect(nextBuildCost('housing', 0)).toBe(300)
    expect(nextBuildCost('hydroponics', 0)).toBe(800)
    expect(nextBuildCost('barracks', 0)).toBe(1_500)
    expect(nextBuildCost('shipyard', 0)).toBe(5_000)
    expect(nextBuildCost('defenseTurret', 0)).toBe(2_000)
  })

  it('applies the x1.15 growth per subsequent level', () => {
    expect(nextBuildCost('housing', 1)).toBeCloseTo(345, 10)
    expect(nextBuildCost('housing', 3)).toBeCloseTo(300 * 1.15 ** 3, 10)
    expect(nextBuildCost('oreMine', 2)).toBeCloseTo(500 * 1.15 ** 2, 10)
  })
})
