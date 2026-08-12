import { describe, expect, it } from 'vitest'
import { structureCost } from '../src/sim/core/economy'
import { STRUCTURES, STRUCTURE_IDS } from '../src/sim/structures/data'
import { nextBuildCost } from '../src/sim/structures/effects'
import {
  buildCost,
  canBuild,
  maxLevelFor,
  PREREQUISITES,
  PREREQUISITE_SOURCE,
  prerequisitesMet,
  structureSummary,
  upgradeCost,
  validateGrid,
  MAX_LEVEL,
} from '../src/sim/structures/framework'
import type { Prerequisite } from '../src/sim/structures/framework'
import { emptyStructureLevels, STARTER_STRUCTURES } from '../src/sim/player/grid'
import type { StructureGrid } from '../src/sim/player/types'
import type { StructureId } from '../src/sim/structures/types'

function gridWith(overrides: Partial<Record<StructureId, number>>): StructureGrid {
  return { ...emptyStructureLevels(), ...overrides }
}

function wallet(credits: number, alloys: number) {
  return { credits, alloys }
}

function fullGrid(): StructureGrid {
  return gridWith({ housing: 1, barracks: 1, oreMine: 3 })
}

describe('PREREQUISITES', () => {
  it('documents its source as a draft (DESIGN locks the chain, not numbers)', () => {
    expect(PREREQUISITE_SOURCE).toBe('draft — T10 balancing input')
  })

  it('defenseTurret requires barracks >= 1', () => {
    expect(PREREQUISITES.defenseTurret).toEqual([
      { structure: 'barracks', minLevel: 1 },
    ])
  })

  it('shipyard requires oreMine >= 3', () => {
    expect(PREREQUISITES.shipyard).toEqual([{ structure: 'oreMine', minLevel: 3 }])
  })

  it('barracks requires housing >= 1', () => {
    expect(PREREQUISITES.barracks).toEqual([{ structure: 'housing', minLevel: 1 }])
  })

  it('covers every structure id; economy/population structures have none', () => {
    for (const id of STRUCTURE_IDS) {
      expect(PREREQUISITES[id], `${id}.prerequisites`).toBeDefined()
    }
    for (const id of ['oreMine', 'tradeHub', 'housing', 'hydroponics']) {
      expect(PREREQUISITES[id as StructureId]).toEqual([])
    }
  })

  it('is deeply frozen (immutability)', () => {
    expect(Object.isFrozen(PREREQUISITES)).toBe(true)
    for (const id of STRUCTURE_IDS) {
      expect(Object.isFrozen(PREREQUISITES[id]), `${id}.prerequisites`).toBe(true)
      for (const prerequisite of PREREQUISITES[id]) {
        expect(Object.isFrozen(prerequisite), `${id}.prerequisites[].minLevel`).toBe(true)
      }
    }
    expect(() =>
      (PREREQUISITES.defenseTurret as Prerequisite[]).push({
        structure: 'oreMine',
        minLevel: 9,
      }),
    ).toThrow(TypeError)
  })

  it('mutating a contained prerequisite object throws and leaves results unchanged', () => {
    const grid = gridWith({ housing: 0, barracks: 0, oreMine: 0 })
    const beforeMet = prerequisitesMet('defenseTurret', grid)
    const beforeCanBuild = canBuild('defenseTurret', grid, wallet(1e9, 1e9))

    expect(() => {
      PREREQUISITES.defenseTurret[0].minLevel = 0
    }).toThrow(TypeError)

    expect(PREREQUISITES.defenseTurret[0].minLevel).toBe(1)
    expect(prerequisitesMet('defenseTurret', grid)).toBe(beforeMet)
    expect(canBuild('defenseTurret', grid, wallet(1e9, 1e9))).toEqual(beforeCanBuild)
  })
})

describe('buildCost', () => {
  it('delegates to the LOCKED structureCost formula and is deterministic', () => {
    expect(buildCost('oreMine', 0)).toBe(structureCost(500, 0))
    expect(buildCost('oreMine', 0)).toBe(500)
    expect(buildCost('housing', 1)).toBe(structureCost(300, 1))
    expect(buildCost('shipyard', 3)).toBe(structureCost(5_000, 3))
    expect(buildCost('defenseTurret', 2)).toBe(structureCost(2_000, 2))
    expect(buildCost('oreMine', 7)).toBe(buildCost('oreMine', 7))
    expect(buildCost('oreMine', 7)).toBeCloseTo(500 * 1.15 ** 7, 10)
  })

  it('matches effects.nextBuildCost for all 7 ids across levels', () => {
    for (const id of STRUCTURE_IDS) {
      for (const level of [0, 1, 3, 10, 25]) {
        expect(buildCost(id, level), `${id}@${level}`).toBe(nextBuildCost(id, level))
      }
    }
  })

  it('throws RangeError for an unknown id', () => {
    expect(() => buildCost('nukePlant' as StructureId, 1)).toThrow(RangeError)
  })
})

describe('upgradeCost', () => {
  it('mirrors nextBuildCost exactly (currentLevel -> structureCost(base, current))', () => {
    for (const id of STRUCTURE_IDS) {
      for (const level of [0, 2, 9, 30]) {
        expect(upgradeCost(id, level), `${id}@${level}`).toBe(nextBuildCost(id, level))
        expect(upgradeCost(id, level), `${id}@${level}`).toBe(buildCost(id, level))
      }
    }
    expect(upgradeCost('housing', 1)).toBeCloseTo(300 * 1.15, 10)
    expect(upgradeCost('oreMine', 2)).toBeCloseTo(500 * 1.15 ** 2, 10)
  })

  it('throws RangeError for an unknown id', () => {
    expect(() => upgradeCost('nukePlant' as StructureId, 1)).toThrow(RangeError)
  })
})

describe('prerequisitesMet', () => {
  it('is always met for structures with no prerequisites, even on an all-zero grid', () => {
    const grid = emptyStructureLevels()
    for (const id of ['oreMine', 'tradeHub', 'housing', 'hydroponics']) {
      expect(prerequisitesMet(id as StructureId, grid), `${id}`).toBe(true)
    }
  })

  it('barracks: housing 0 -> false, housing exactly 1 -> true', () => {
    expect(prerequisitesMet('barracks', gridWith({ housing: 0 }))).toBe(false)
    expect(prerequisitesMet('barracks', gridWith({ housing: 1 }))).toBe(true)
  })

  it('shipyard: oreMine 2 -> false, oreMine exactly 3 -> true', () => {
    expect(prerequisitesMet('shipyard', gridWith({ oreMine: 2 }))).toBe(false)
    expect(prerequisitesMet('shipyard', gridWith({ oreMine: 3 }))).toBe(true)
  })

  it('defenseTurret: barracks 0 -> false, barracks exactly 1 -> true', () => {
    expect(prerequisitesMet('defenseTurret', gridWith({ barracks: 0 }))).toBe(false)
    expect(prerequisitesMet('defenseTurret', gridWith({ barracks: 1 }))).toBe(true)
  })
})

describe('canBuild ladder', () => {
  it('unknown structure wins the ladder even with a full grid and rich wallet', () => {
    expect(canBuild('nukePlant' as StructureId, fullGrid(), wallet(1e9, 1e9))).toEqual({
      ok: false,
      reason: 'unknown-structure',
    })
  })

  it('prerequisites gate before funds', () => {
    expect(
      canBuild('shipyard', gridWith({ oreMine: 2 }), wallet(1e9, 1e9)),
    ).toEqual({ ok: false, reason: 'prerequisites' })
  })

  it('credits are checked before alloys', () => {
    expect(
      canBuild('defenseTurret', gridWith({ barracks: 1 }), wallet(1_999, 10_000)),
    ).toEqual({ ok: false, reason: 'insufficient-credits' })
  })

  it('alloys are checked after credits pass', () => {
    expect(
      canBuild('defenseTurret', gridWith({ barracks: 1 }), wallet(10_000, 999)),
    ).toEqual({ ok: false, reason: 'insufficient-alloys' })
  })

  it('returns ok with exactly sufficient funds and does not mutate inputs', () => {
    const grid = gridWith({ barracks: 1 })
    const gridSnapshot = { ...grid }
    const purse = wallet(2_000, 1_000)
    expect(canBuild('defenseTurret', grid, purse)).toEqual({ ok: true })
    expect(grid).toEqual(gridSnapshot)
    expect(purse).toEqual({ credits: 2_000, alloys: 1_000 })
  })

  it('scales the credit cost with the current grid level', () => {
    const level3Grid = gridWith({ barracks: 1, defenseTurret: 3 })
    const costAtLevel3 = 2_000 * 1.15 ** 3
    expect(buildCost('defenseTurret', 3)).toBeCloseTo(costAtLevel3, 10)
    expect(
      canBuild('defenseTurret', level3Grid, wallet(Math.floor(costAtLevel3) - 1, 1_000)),
    ).toEqual({ ok: false, reason: 'insufficient-credits' })
    expect(canBuild('defenseTurret', level3Grid, wallet(Math.ceil(costAtLevel3), 1_000))).toEqual({
      ok: true,
    })
  })
})

describe('maxLevelFor', () => {
  it('returns 100 for every structure (DESIGN is silent on a numeric cap)', () => {
    for (const id of STRUCTURE_IDS) {
      expect(maxLevelFor(id), `${id}`).toBe(MAX_LEVEL)
      expect(maxLevelFor(id), `${id}`).toBe(100)
    }
  })

  it('throws RangeError for an unknown id', () => {
    expect(() => maxLevelFor('nukePlant' as StructureId)).toThrow(RangeError)
  })
})

describe('validateGrid', () => {
  it('accepts the full all-zero grid', () => {
    expect(validateGrid(emptyStructureLevels())).toEqual({ ok: true, problems: [] })
  })

  it('accepts STARTER_STRUCTURES', () => {
    expect(validateGrid(STARTER_STRUCTURES)).toEqual({ ok: true, problems: [] })
  })

  it('accepts a grid at MAX_LEVEL', () => {
    expect(validateGrid(gridWith({ housing: MAX_LEVEL }))).toEqual({
      ok: true,
      problems: [],
    })
  })

  it('catches each tamper class', () => {
    const tampered: Array<{ name: string; grid: StructureGrid }> = [
      {
        name: 'missing key',
        grid: (() => {
          const g = emptyStructureLevels()
          delete (g as Record<string, number>).housing
          return g
        })(),
      },
      { name: 'negative level', grid: gridWith({ housing: -1 }) },
      { name: 'non-integer level', grid: gridWith({ housing: 1.5 }) },
      {
        name: 'unknown key',
        grid: { ...emptyStructureLevels(), nukePlant: 1 } as StructureGrid,
      },
      { name: 'over max', grid: gridWith({ housing: MAX_LEVEL + 1 }) },
    ]
    for (const t of tampered) {
      const result = validateGrid(t.grid)
      expect(result.ok, t.name).toBe(false)
      expect(result.problems.length, t.name).toBeGreaterThan(0)
    }
  })

  it('collects all problems together', () => {
    const grid = { ...emptyStructureLevels(), nukePlant: 1 } as StructureGrid
    grid.housing = -2
    delete (grid as Record<string, number>).shipyard
    const result = validateGrid(grid)
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(3)
    expect(result.problems.join(' | ')).toContain('missing structure key: shipyard')
    expect(result.problems.join(' | ')).toContain('invalid level for housing: -2')
    expect(result.problems.join(' | ')).toContain('unknown structure key: nukePlant')
  })

  it('flags only levels strictly above MAX_LEVEL', () => {
    expect(validateGrid(gridWith({ oreMine: MAX_LEVEL })).ok).toBe(true)
    expect(validateGrid(gridWith({ oreMine: MAX_LEVEL + 1 })).ok).toBe(false)
  })
})

describe('structureSummary', () => {
  it('returns the exact shape for oreMine', () => {
    expect(structureSummary('oreMine')).toEqual({
      id: 'oreMine',
      name: 'Ore Mine',
      category: 'Economy',
      baseCost: 500,
      buildTimeSeconds: 30,
      prerequisites: [],
    })
  })

  it('matches STRUCTURES data and PREREQUISITES for all 7 ids', () => {
    for (const id of STRUCTURE_IDS) {
      const summary = structureSummary(id)
      expect(summary.name).toBe(STRUCTURES[id].name)
      expect(summary.category).toBe(STRUCTURES[id].category)
      expect(summary.baseCost).toBe(STRUCTURES[id].baseCost)
      expect(summary.buildTimeSeconds).toBe(STRUCTURES[id].buildTimeSec)
      expect(summary.prerequisites).toBe(PREREQUISITES[id])
    }
  })

  it('throws RangeError for an unknown id', () => {
    expect(() => structureSummary('nukePlant' as StructureId)).toThrow(RangeError)
  })
})
