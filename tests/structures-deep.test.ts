import { describe, expect, it } from 'vitest'
import {
  baselinePassiveIncome,
  structureCost,
} from '../src/sim/core/economy'
import {
  BASE_POPULATION_CAP,
  populationCap,
  populationGrowthPerSec,
} from '../src/sim/core/population'
import { STRUCTURES, STRUCTURE_IDS } from '../src/sim/structures/data'
import { nextBuildCost, structureEffect } from '../src/sim/structures/effects'
import { StructureCategory } from '../src/sim/structures/types'
import type { StructureEffect, StructureId } from '../src/sim/structures/types'

function asKind<K extends StructureEffect['kind']>(
  effect: StructureEffect,
  kind: K,
): Extract<StructureEffect, { kind: K }> {
  expect(effect.kind).toBe(kind)
  return effect as Extract<StructureEffect, { kind: K }>
}

const CATEGORY_BY_ID: Record<StructureId, StructureCategory> = {
  oreMine: StructureCategory.Economy,
  tradeHub: StructureCategory.Economy,
  housing: StructureCategory.Population,
  hydroponics: StructureCategory.Population,
  barracks: StructureCategory.Military,
  shipyard: StructureCategory.Military,
  defenseTurret: StructureCategory.Defense,
}

function effectsAtLevel1(): Record<StructureId, StructureEffect> {
  return {
    oreMine: structureEffect('oreMine', 1),
    tradeHub: structureEffect('tradeHub', 1),
    housing: structureEffect('housing', 1),
    hydroponics: structureEffect('hydroponics', 1),
    barracks: structureEffect('barracks', 1),
    shipyard: structureEffect('shipyard', 1),
    defenseTurret: structureEffect('defenseTurret', 1),
  }
}

describe('P1-T02-C cost curve regression', () => {
  const LEVELS = [0, 1, 2, 5, 10]

  it('nextBuildCost matches baseCost x 1.15^level exactly for all 7 ids', () => {
    for (const id of STRUCTURE_IDS) {
      for (const level of LEVELS) {
        expect(nextBuildCost(id, level), `${id}@${level}`).toBeCloseTo(
          STRUCTURES[id].baseCost * 1.15 ** level,
          10,
        )
      }
    }
  })

  it('structureCost matches baseCost x 1.15^level directly for all 7 ids', () => {
    for (const id of STRUCTURE_IDS) {
      for (const level of LEVELS) {
        expect(structureCost(STRUCTURES[id].baseCost, level), `${id}@${level}`).toBeCloseTo(
          STRUCTURES[id].baseCost * 1.15 ** level,
          10,
        )
      }
    }
  })

  it('nextBuildCost is consistent with structureCost across all 7 ids', () => {
    for (const id of STRUCTURE_IDS) {
      for (const level of LEVELS) {
        expect(nextBuildCost(id, level)).toBe(
          structureCost(STRUCTURES[id].baseCost, level),
        )
      }
    }
  })
})

describe('P1-T02-C effect formula boundary cases', () => {
  it('housing: 0->1 and 1->2 transitions add exactly +1,000 cap / +2 growth', () => {
    const e0 = structureEffect('housing', 0)
    const e1 = asKind(structureEffect('housing', 1), 'population')
    const e2 = asKind(structureEffect('housing', 2), 'population')
    expect(e0).toEqual({ kind: 'population', popCapBonus: 0, popGrowthBonusPerSec: 0 })
    expect(e1.popCapBonus - asKind(e0, 'population').popCapBonus).toBe(1_000)
    expect(e1.popGrowthBonusPerSec - asKind(e0, 'population').popGrowthBonusPerSec).toBe(2)
    expect(e2.popCapBonus - e1.popCapBonus).toBe(1_000)
    expect(e2.popGrowthBonusPerSec - e1.popGrowthBonusPerSec).toBe(2)
  })

  it('oreMine: 0->1 and 1->2 transitions add exactly 5/60 alloys per sec', () => {
    const e1 = asKind(structureEffect('oreMine', 1), 'alloys')
    const e2 = asKind(structureEffect('oreMine', 2), 'alloys')
    expect(e1.alloysPerSec).toBeCloseTo(5 / 60, 12)
    expect(e2.alloysPerSec - e1.alloysPerSec).toBeCloseTo(5 / 60, 12)
  })

  it('large levels 100 and 1000 produce finite, non-NaN results for every id', () => {
    for (const id of STRUCTURE_IDS) {
      for (const level of [100, 1_000]) {
        const effect = structureEffect(id, level)
        for (const [key, value] of Object.entries(effect)) {
          if (key === 'kind') continue
          expect(Number.isFinite(value), `${id}@${level}.${key}`).toBe(true)
          expect(Number.isNaN(value), `${id}@${level}.${key}`).toBe(false)
        }
      }
    }
  })

  it('nextBuildCost at levels 100 and 1000 is finite, non-NaN, and positive for every id', () => {
    for (const id of STRUCTURE_IDS) {
      for (const level of [100, 1_000]) {
        const viaEffect = nextBuildCost(id, level)
        const viaCore = structureCost(STRUCTURES[id].baseCost, level)
        expect(Number.isFinite(viaEffect), `${id}@${level}.nextBuildCost`).toBe(true)
        expect(Number.isNaN(viaEffect), `${id}@${level}.nextBuildCost`).toBe(false)
        expect(viaEffect, `${id}@${level}.nextBuildCost`).toBeGreaterThan(0)
        expect(Number.isFinite(viaCore), `${id}@${level}.structureCost`).toBe(true)
        expect(Number.isNaN(viaCore), `${id}@${level}.structureCost`).toBe(false)
        expect(viaCore, `${id}@${level}.structureCost`).toBeGreaterThan(0)
        expect(viaEffect, `${id}@${level} consistency`).toBe(viaCore)
      }
    }
  })

  it('keeps exact integer precision at high levels', () => {
    const h1000 = asKind(structureEffect('housing', 1_000), 'population')
    expect(h1000.popCapBonus).toBe(1_000_000)
    expect(h1000.popGrowthBonusPerSec).toBe(2_000)
    const b1000 = asKind(structureEffect('barracks', 1_000), 'barracks')
    expect(b1000.soldierConversionPerSec).toBe(10_000)
    expect(b1000.garrisonCap).toBe(5_000_000)
    const s1000 = asKind(structureEffect('shipyard', 1_000), 'shipyard')
    expect(s1000.fleetCap).toBe(1_000_000)
    const d1000 = asKind(structureEffect('defenseTurret', 1_000), 'defense')
    expect(d1000.defensePower).toBe(500_000)
  })

  it('fractional fields stay proportional at high levels', () => {
    const o1000 = asKind(structureEffect('oreMine', 1_000), 'alloys')
    expect(o1000.alloysPerSec).toBeCloseTo(5_000 / 60, 8)
    const s1000 = asKind(structureEffect('shipyard', 1_000), 'shipyard')
    expect(s1000.shipbuildingIncomePerSec).toBeCloseTo(50_000 / 60, 8)
    const t1000 = asKind(structureEffect('tradeHub', 1_000), 'incomeMultiplier')
    expect(t1000.multiplier).toBe(101)
    const h1000 = asKind(structureEffect('hydroponics', 1_000), 'growthMultiplier')
    expect(h1000.multiplier).toBe(501)
  })
})

describe('P1-T02-C category mapping', () => {
  it('maps every StructureId to the audited category', () => {
    for (const id of STRUCTURE_IDS) {
      expect(STRUCTURES[id].category, id).toBe(CATEGORY_BY_ID[id])
    }
  })

  it('covers all 7 ids with no extras in data.ts', () => {
    const dataIds = Object.keys(STRUCTURES)
    expect(dataIds).toHaveLength(7)
    expect([...dataIds].sort()).toEqual([...STRUCTURE_IDS].sort())
    expect(dataIds.every((id) => id in CATEGORY_BY_ID)).toBe(true)
  })
})

describe('P1-T02-C data integrity', () => {
  it('produces a valid effect variant for every id in data.ts (runtime exhaustiveness)', () => {
    const kinds = Object.values(effectsAtLevel1()).map((e) => e.kind)
    expect(new Set(kinds)).toEqual(
      new Set(['alloys', 'incomeMultiplier', 'population', 'growthMultiplier', 'barracks', 'shipyard', 'defense']),
    )
    for (const id of STRUCTURE_IDS) {
      expect(effectsAtLevel1()[id].kind, id).toBeTruthy()
    }
  })

  it('records distinct kinds per id (no two ids share an effect kind)', () => {
    const kinds = Object.values(effectsAtLevel1()).map((e) => e.kind)
    expect(new Set(kinds).size).toBe(7)
  })

  it('buildTimeSec > 0 and baseCost > 0 for all 7 structures', () => {
    for (const id of STRUCTURE_IDS) {
      expect(STRUCTURES[id].buildTimeSec, `${id}.buildTimeSec`).toBeGreaterThan(0)
      expect(STRUCTURES[id].baseCost, `${id}.baseCost`).toBeGreaterThan(0)
    }
  })
})

describe('P1-T02-C alloyCost', () => {
  it('only defenseTurret has alloyCost, exactly 1,000', () => {
    for (const id of STRUCTURE_IDS) {
      if (id === 'defenseTurret') {
        expect(STRUCTURES[id].alloyCost).toBe(1_000)
      } else {
        expect(STRUCTURES[id].alloyCost, `${id}.alloyCost`).toBeUndefined()
      }
    }
  })
})

describe('P1-T02-C integration with sim core', () => {
  it('housing popCapBonus matches populationCap(housingLevels) - base cap', () => {
    for (const level of [0, 1, 2, 5, 10, 100]) {
      const effect = asKind(structureEffect('housing', level), 'population')
      expect(effect.popCapBonus).toBe(populationCap(level) - BASE_POPULATION_CAP)
    }
  })

  it('housing popGrowthBonusPerSec matches populationGrowthPerSec delta', () => {
    for (const level of [0, 1, 2, 5, 10]) {
      const effect = asKind(structureEffect('housing', level), 'population')
      const delta = populationGrowthPerSec(level, 0) - populationGrowthPerSec(0, 0)
      expect(effect.popGrowthBonusPerSec).toBeCloseTo(delta, 12)
    }
  })

  it('hydroponics multiplier matches populationGrowthPerSec ratio', () => {
    for (const level of [0, 1, 2, 5, 10]) {
      const effect = asKind(structureEffect('hydroponics', level), 'growthMultiplier')
      const ratio = populationGrowthPerSec(0, level) / populationGrowthPerSec(0, 0)
      expect(effect.multiplier).toBeCloseTo(ratio, 12)
    }
  })

  it('tradeHub multiplier scales baselinePassiveIncome as designed', () => {
    for (const level of [0, 1, 2, 5]) {
      const effect = asKind(structureEffect('tradeHub', level), 'incomeMultiplier')
      expect(effect.multiplier).toBeCloseTo(1 + 0.1 * level, 12)
      const tier = 3
      expect(baselinePassiveIncome(tier) * effect.multiplier).toBeCloseTo(
        baselinePassiveIncome(tier) * (1 + 0.1 * level),
        12,
      )
    }
  })
})
