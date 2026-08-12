import { describe, expect, it } from 'vitest'
import { structureCost } from '../src/sim/core/economy'
import { STRUCTURES, STRUCTURE_IDS } from '../src/sim/structures/data'
import { nextBuildCost } from '../src/sim/structures/effects'
import {
  buildCost,
  canBuild,
  structureSummary,
  upgradeCost,
  validateGrid,
} from '../src/sim/structures/framework'
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

  it('is deterministic across a wide level sweep for every structure', () => {
    for (const id of STRUCTURE_IDS) {
      for (const level of [0, 1, 2, 5, 10, 25, 100, 500]) {
        expect(buildCost(id, level), `${id}@${level}`).toBe(buildCost(id, level))
        expect(Number.isFinite(buildCost(id, level)), `${id}@${level}`).toBe(true)
      }
    }
  })

  it('throws RangeError for negative and fractional levels (via the locked structureCost)', () => {
    expect(() => buildCost('oreMine', -1)).toThrow(RangeError)
    expect(() => buildCost('oreMine', 1.5)).toThrow(RangeError)
    expect(() => buildCost('oreMine', Number.NaN)).toThrow(RangeError)
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

  it('throws RangeError for negative and fractional current levels', () => {
    expect(() => upgradeCost('oreMine', -1)).toThrow(RangeError)
    expect(() => upgradeCost('oreMine', 2.5)).toThrow(RangeError)
    expect(() => upgradeCost('oreMine', Number.NaN)).toThrow(RangeError)
  })

  it('throws RangeError for an unknown id', () => {
    expect(() => upgradeCost('nukePlant' as StructureId, 1)).toThrow(RangeError)
  })
})

describe('canBuild ladder (no prerequisite rung — DESIGN locks no numeric prerequisites)', () => {
  it('unknown structure wins the ladder even with a full grid and rich wallet', () => {
    expect(canBuild('nukePlant' as StructureId, fullGrid(), wallet(1e9, 1e9))).toEqual({
      ok: false,
      reason: 'unknown-structure',
    })
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

  it('formerly prereq-gated structures build from level 0 with funds only (no prereq gate)', () => {
    expect(canBuild('shipyard', emptyStructureLevels(), wallet(5_000, 0))).toEqual({
      ok: true,
    })
    expect(canBuild('defenseTurret', emptyStructureLevels(), wallet(2_000, 1_000))).toEqual({
      ok: true,
    })
    expect(
      canBuild('shipyard', emptyStructureLevels(), wallet(4_999, 0)),
    ).toEqual({ ok: false, reason: 'insufficient-credits' })
  })

  it('the failure ladder contains exactly unknown-structure / insufficient-credits / insufficient-alloys', () => {
    const seen = new Set<string>()
    for (const id of STRUCTURE_IDS) {
      const rich = canBuild(id, emptyStructureLevels(), wallet(1e9, 1e9))
      expect(rich.ok).toBe(true)
      const poorCredits = canBuild(id, emptyStructureLevels(), wallet(0, 1e9))
      if (!poorCredits.ok) seen.add(poorCredits.reason)
      const poorAlloys = canBuild(id, emptyStructureLevels(), wallet(1e9, 0))
      if (!poorAlloys.ok) seen.add(poorAlloys.reason)
    }
    expect(canBuild('nukePlant' as StructureId, emptyStructureLevels(), wallet(1e9, 1e9))).toEqual(
      { ok: false, reason: 'unknown-structure' },
    )
    expect(seen).toEqual(new Set(['insufficient-credits', 'insufficient-alloys']))
  })

  it('builds at arbitrarily high levels are eligible whenever funds suffice (no max level)', () => {
    const highGrid = gridWith({ housing: 1_000, oreMine: 1_000 })
    const costAt1000 = buildCost('housing', 1_000)
    expect(costAt1000).toBeCloseTo(300 * 1.15 ** 1_000, 8)
    expect(canBuild('housing', highGrid, wallet(costAt1000, 0))).toEqual({ ok: true })
    expect(canBuild('housing', highGrid, wallet(0, 0))).toEqual({
      ok: false,
      reason: 'insufficient-credits',
    })
  })

  it('every structure is buildable on an empty grid with sufficient funds (no prereq gates)', () => {
    for (const id of STRUCTURE_IDS) {
      const result = canBuild(id, emptyStructureLevels(), wallet(1e9, 1e9))
      expect(result, id).toEqual({ ok: true })
    }
  })

  it('the alloy rung applies only to structures that carry an alloyCost', () => {
    expect(canBuild('oreMine', emptyStructureLevels(), wallet(1e9, 0))).toEqual({ ok: true })
    expect(canBuild('tradeHub', emptyStructureLevels(), wallet(1e9, 0))).toEqual({ ok: true })
    expect(canBuild('defenseTurret', emptyStructureLevels(), wallet(1e9, 0))).toEqual({
      ok: false,
      reason: 'insufficient-alloys',
    })
    expect(
      canBuild('defenseTurret', emptyStructureLevels(), wallet(1e9, 1_000)),
    ).toEqual({ ok: true })
  })
})

describe('validateGrid (levels are finite non-negative integers — NO max level)', () => {
  it('accepts the full all-zero grid', () => {
    expect(validateGrid(emptyStructureLevels())).toEqual({ ok: true, problems: [] })
  })

  it('accepts STARTER_STRUCTURES', () => {
    expect(validateGrid(STARTER_STRUCTURES)).toEqual({ ok: true, problems: [] })
  })

  it('accepts arbitrarily high finite levels (levels are UNLIMITED per DESIGN)', () => {
    for (const level of [100, 1_000, 10_000, 1_000_000]) {
      expect(validateGrid(gridWith({ housing: level, oreMine: level }))).toEqual({
        ok: true,
        problems: [],
      })
    }
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
      { name: 'NaN level', grid: gridWith({ housing: Number.NaN }) },
      { name: 'Infinity level', grid: gridWith({ housing: Number.POSITIVE_INFINITY }) },
      {
        name: 'unknown key',
        grid: { ...emptyStructureLevels(), nukePlant: 1 } as StructureGrid,
      },
    ]
    for (const t of tampered) {
      const result = validateGrid(t.grid)
      expect(result.ok, t.name).toBe(false)
      expect(result.problems.length, t.name).toBeGreaterThan(0)
    }
  })

  it('rejects only non-finite or non-integer levels — large finite integers pass', () => {
    expect(validateGrid(gridWith({ housing: Number.MAX_SAFE_INTEGER })).ok).toBe(true)
    expect(validateGrid(gridWith({ housing: 0 })).ok).toBe(true)
    expect(validateGrid(gridWith({ housing: 1.5 })).ok).toBe(false)
    expect(validateGrid(gridWith({ housing: Number.NaN })).ok).toBe(false)
    expect(validateGrid(gridWith({ housing: Number.POSITIVE_INFINITY })).ok).toBe(false)
    expect(validateGrid(gridWith({ housing: -1 })).ok).toBe(false)
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

  it('accepts distinct valid integer levels on every structure', () => {
    const grid = gridWith({
      oreMine: 1,
      tradeHub: 2,
      housing: 3,
      hydroponics: 4,
      barracks: 5,
      shipyard: 6,
      defenseTurret: 7,
    })
    expect(validateGrid(grid)).toEqual({ ok: true, problems: [] })
  })
})

describe('structureSummary', () => {
  it('returns the exact shape for oreMine (no prerequisites field)', () => {
    expect(structureSummary('oreMine')).toEqual({
      id: 'oreMine',
      name: 'Ore Mine',
      category: 'Economy',
      baseCost: 500,
      buildTimeSeconds: 30,
    })
  })

  it('exposes exactly the five documented fields (no prerequisites anywhere)', () => {
    for (const id of STRUCTURE_IDS) {
      expect(Object.keys(structureSummary(id)).sort()).toEqual([
        'baseCost',
        'buildTimeSeconds',
        'category',
        'id',
        'name',
      ])
    }
  })

  it('matches STRUCTURES data for all 7 ids', () => {
    for (const id of STRUCTURE_IDS) {
      const summary = structureSummary(id)
      expect(summary.name).toBe(STRUCTURES[id].name)
      expect(summary.category).toBe(STRUCTURES[id].category)
      expect(summary.baseCost).toBe(STRUCTURES[id].baseCost)
      expect(summary.buildTimeSeconds).toBe(STRUCTURES[id].buildTimeSec)
    }
  })

  it('throws RangeError for an unknown id', () => {
    expect(() => structureSummary('nukePlant' as StructureId)).toThrow(RangeError)
  })

  it('is deterministic: identical input yields deep-equal summaries', () => {
    for (const id of STRUCTURE_IDS) {
      expect(structureSummary(id)).toEqual(structureSummary(id))
    }
  })
})
