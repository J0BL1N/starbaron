import { describe, expect, it } from 'vitest'
import { BASE_INCOME_PER_TIER, baselinePassiveIncome } from '../src/sim/core/economy'
import { effectiveLevel } from '../src/sim/planets/levels'
import { quirkById } from '../src/sim/planets/quirks'
import type { QuirkId } from '../src/sim/planets/types'
import { STRUCTURES, STRUCTURE_IDS } from '../src/sim/structures/data'
import {
  ORE_ALLOYS_PER_MIN,
  SHIPYARD_INCOME_PER_MIN,
  TRADE_HUB_INCOME_MULTIPLIER_PER_LEVEL,
  structureEffect,
} from '../src/sim/structures/effects'
import {
  planetEfficiency,
  productionSummaryFor,
  structureRates,
} from '../src/sim/structures/production'
import type { StructureId } from '../src/sim/structures/types'

function fullGrid(
  levels: ReadonlyArray<readonly [StructureId, number]>,
): Record<StructureId, number> {
  const grid = {} as Record<StructureId, number>
  for (const id of STRUCTURE_IDS) grid[id] = 0
  for (const [id, level] of levels) grid[id] = level
  return grid
}

function row(
  summary: ReturnType<typeof productionSummaryFor>,
  structure: StructureId,
) {
  const found = summary.perStructure.find((entry) => entry.structure === structure)
  if (found === undefined) {
    throw new Error(`missing row for ${structure}`)
  }
  return found
}

describe('structureRates mirrors effects.ts exactly', () => {
  it('ore mine Lv 3 → 5x3/60 = 0.25 alloys per sec, zero credits', () => {
    expect(structureRates('oreMine', 3)).toEqual({
      creditsPerSec: 0,
      alloysPerSec: (ORE_ALLOYS_PER_MIN * 3) / 60,
    })
  })

  it('ore mine alloys equal the locked structureEffect alloys for levels 0..20', () => {
    for (const level of [0, 1, 2, 3, 5, 10, 12, 15, 20]) {
      const effect = structureEffect('oreMine', level)
      const rates = structureRates('oreMine', level)
      expect(effect.kind).toBe('alloys')
      expect(rates.alloysPerSec, `oreMine@${level}`).toBeCloseTo(
        (effect.kind === 'alloys' ? effect.alloysPerSec : 0),
        12,
      )
    }
  })

  it('trade hub Lv 2 → 0.1x2 multiplier on the tier baseline: 10 x 0.1 x 2 = 2 credits/s', () => {
    const rates = structureRates('tradeHub', 2)
    expect(rates.creditsPerSec).toBeCloseTo(
      BASE_INCOME_PER_TIER * TRADE_HUB_INCOME_MULTIPLIER_PER_LEVEL * 2,
      12,
    )
    expect(rates.creditsPerSec).toBeCloseTo(2, 12)
  })

  it('trade hub credits equal reference baseline x (locked multiplier - 1) for levels 0..10', () => {
    for (const level of [0, 1, 2, 5, 10]) {
      const effect = structureEffect('tradeHub', level)
      expect(effect.kind).toBe('incomeMultiplier')
      const expected =
        BASE_INCOME_PER_TIER *
        (effect.kind === 'incomeMultiplier' ? effect.multiplier - 1 : 0)
      expect(structureRates('tradeHub', level).creditsPerSec, `tradeHub@${level}`).toBeCloseTo(
        expected,
        12,
      )
    }
  })

  it('shipyard Lv 3 → SHIPYARD_INCOME_PER_MIN/60 x 3 = 2.5 credits/s', () => {
    const rates = structureRates('shipyard', 3)
    expect(rates.creditsPerSec).toBe((SHIPYARD_INCOME_PER_MIN * 3) / 60)
    expect(rates.creditsPerSec).toBe(2.5)
  })

  it('shipyard credits equal the locked shipbuildingIncomePerSec for levels 0..10', () => {
    for (const level of [0, 1, 3, 5, 10]) {
      const effect = structureEffect('shipyard', level)
      expect(effect.kind).toBe('shipyard')
      const expected = effect.kind === 'shipyard' ? effect.shipbuildingIncomePerSec : 0
      expect(structureRates('shipyard', level).creditsPerSec, `shipyard@${level}`).toBe(
        expected,
      )
    }
  })

  it('non-production structures yield zero rates at any level', () => {
    for (const id of ['housing', 'hydroponics', 'barracks', 'defenseTurret'] as const) {
      for (const level of [0, 1, 2, 5, 10]) {
        expect(structureRates(id, level), `${id}@${level}`).toEqual({
          creditsPerSec: 0,
          alloysPerSec: 0,
        })
      }
    }
  })

  it('Lv 0 structures yield zero production (trade hub adds no multiplier increment at Lv 0)', () => {
    expect(structureRates('oreMine', 0)).toEqual({ creditsPerSec: 0, alloysPerSec: 0 })
    expect(structureRates('shipyard', 0)).toEqual({ creditsPerSec: 0, alloysPerSec: 0 })
    expect(structureRates('tradeHub', 0)).toEqual({ creditsPerSec: 0, alloysPerSec: 0 })
  })

  it('diminishing returns above level 10: ore mine Lv 12 → effective 11 alloys', () => {
    expect(effectiveLevel(12)).toBe(11)
    expect(structureRates('oreMine', 12).alloysPerSec).toBeCloseTo(
      (ORE_ALLOYS_PER_MIN / 60) * effectiveLevel(12),
      12,
    )
    expect(structureRates('oreMine', 12).alloysPerSec).toBeCloseTo(
      (5 * 11) / 60,
      12,
    )
  })

  it('diminishing returns above level 10: trade hub Lv 12 → increment 0.1 x effectiveLevel 11', () => {
    expect(effectiveLevel(12)).toBe(11)
    const expected =
      BASE_INCOME_PER_TIER * TRADE_HUB_INCOME_MULTIPLIER_PER_LEVEL * 11
    expect(structureRates('tradeHub', 12).creditsPerSec).toBeCloseTo(expected, 12)
    expect(structureRates('tradeHub', 12).creditsPerSec).toBeCloseTo(11, 12)
  })

  it('validation: unknown structure throws RangeError', () => {
    expect(() => structureRates('wormholeGate' as StructureId, 1)).toThrow(RangeError)
  })

  it('validation: negative, fractional and NaN levels throw RangeError', () => {
    for (const level of [-1, 1.5, Number.NaN]) {
      expect(() => structureRates('oreMine', level), `level=${level}`).toThrow(
        RangeError,
      )
    }
  })

  it('structureRates is deterministic for every structure and level', () => {
    for (const id of STRUCTURE_IDS) {
      for (const level of [0, 1, 3, 10, 15]) {
        expect(structureRates(id, level), `${id}@${level}`).toEqual(
          structureRates(id, level),
        )
      }
    }
  })
})

describe('planetEfficiency matches the locked production modifiers', () => {
  it('with no quirks equals the tier factor (baselinePassiveIncome / BASE_INCOME_PER_TIER) for tiers 1..5', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      expect(planetEfficiency(tier, []), `tier=${tier}`).toBe(
        baselinePassiveIncome(tier) / BASE_INCOME_PER_TIER,
      )
    }
  })

  it('tier 1 → 1, tier 3 → 3, tier 5 → 5 with no quirks', () => {
    expect(planetEfficiency(1, [])).toBe(1)
    expect(planetEfficiency(3, [])).toBe(3)
    expect(planetEfficiency(5, [])).toBe(5)
  })

  it('binarySystem folds its multiplier in: tier 1/3/5 → 1.1 / 3.3 / 5.5', () => {
    const binary = quirkById('binarySystem').multiplier
    expect(planetEfficiency(1, ['binarySystem'])).toBeCloseTo(1 * binary, 12)
    expect(planetEfficiency(3, ['binarySystem'])).toBeCloseTo(3 * binary, 12)
    expect(planetEfficiency(5, ['binarySystem'])).toBeCloseTo(5 * binary, 12)
  })

  it('highGravity folds its multiplier in: tier 3 → 3.6', () => {
    const gravity = quirkById('highGravity').multiplier
    expect(planetEfficiency(3, ['highGravity'])).toBeCloseTo(3 * gravity, 12)
  })

  it('binarySystem + highGravity compose multiplicatively: tier 3 → 3 x 1.1 x 1.2 = 3.96', () => {
    const binary = quirkById('binarySystem').multiplier
    const gravity = quirkById('highGravity').multiplier
    expect(planetEfficiency(3, ['binarySystem', 'highGravity'])).toBeCloseTo(
      3 * binary * gravity,
      12,
    )
    expect(planetEfficiency(3, ['binarySystem', 'highGravity'])).toBeCloseTo(3.96, 12)
  })

  it('non-production quirks (denseCore, hotStar, coldStar, massiveWorld, gasGiant) leave efficiency unchanged', () => {
    expect(
      planetEfficiency(3, [
        'denseCore',
        'hotStar',
        'coldStar',
        'massiveWorld',
        'gasGiant',
      ]),
    ).toBe(3)
  })

  it('quirk order does not matter (deterministic composition)', () => {
    expect(planetEfficiency(3, ['highGravity', 'binarySystem'])).toBe(
      planetEfficiency(3, ['binarySystem', 'highGravity']),
    )
  })

  it('validation: out-of-range, fractional and NaN tiers throw RangeError', () => {
    for (const tier of [0, -1, 6, 2.5, Number.NaN]) {
      expect(() => planetEfficiency(tier, []), `tier=${tier}`).toThrow(RangeError)
    }
  })

  it('validation: unknown quirk id throws RangeError', () => {
    expect(() => planetEfficiency(1, ['superQuirk' as QuirkId])).toThrow(RangeError)
  })

  it('planetEfficiency is deterministic across repeated calls', () => {
    expect(planetEfficiency(3, ['binarySystem', 'highGravity'])).toBe(
      planetEfficiency(3, ['binarySystem', 'highGravity']),
    )
  })
})

describe('productionSummaryFor', () => {
  it('empty grid → zero totals and seven zero per-structure rows sorted by id', () => {
    const summary = productionSummaryFor({ name: 'X-1', tier: 1, grid: fullGrid([]) })
    expect(summary.total).toEqual({ creditsPerSec: 0, alloysPerSec: 0 })
    expect(summary.perStructure).toHaveLength(STRUCTURE_IDS.length)
    for (const entry of summary.perStructure) {
      expect(entry.creditsPerSec).toBe(0)
      expect(entry.alloysPerSec).toBe(0)
    }
  })

  it('totals reconcile with the locked composition (tier-3 ore mine + trade hub + shipyard + quirks)', () => {
    const tier = 3
    const summary = productionSummaryFor({
      name: 'X-1',
      tier,
      quirks: ['highGravity', 'binarySystem'],
      grid: fullGrid([
        ['oreMine', 3],
        ['tradeHub', 2],
        ['shipyard', 4],
      ]),
    })
    const tradeEffect = structureEffect('tradeHub', 2)
    expect(tradeEffect.kind).toBe('incomeMultiplier')
    const shipEffect = structureEffect('shipyard', 4)
    expect(shipEffect.kind).toBe('shipyard')
    const binary = quirkById('binarySystem').multiplier
    const gravity = quirkById('highGravity').multiplier
    const expectedCredits =
      baselinePassiveIncome(tier) *
      TRADE_HUB_INCOME_MULTIPLIER_PER_LEVEL *
      2 *
      binary +
      (shipEffect.kind === 'shipyard' ? shipEffect.shipbuildingIncomePerSec : 0)
    const expectedAlloys = (ORE_ALLOYS_PER_MIN / 60) * 3 * gravity
    expect(summary.total.creditsPerSec).toBeCloseTo(expectedCredits, 10)
    expect(summary.total.alloysPerSec).toBeCloseTo(expectedAlloys, 12)
    expect(summary.total.alloysPerSec).toBeCloseTo(0.3, 12)
  })

  it('summary total + passive baseline x binarySystemFactor equals the locked full credit rate', () => {
    const tier = 3
    const summary = productionSummaryFor({
      name: 'X-1',
      tier,
      quirks: ['highGravity', 'binarySystem'],
      grid: fullGrid([
        ['oreMine', 3],
        ['tradeHub', 2],
        ['shipyard', 4],
      ]),
    })
    const tradeEffect = structureEffect('tradeHub', 2)
    expect(tradeEffect.kind).toBe('incomeMultiplier')
    const shipEffect = structureEffect('shipyard', 4)
    expect(shipEffect.kind).toBe('shipyard')
    const binary = quirkById('binarySystem').multiplier
    const lockedFullCredits =
      baselinePassiveIncome(tier) *
      (tradeEffect.kind === 'incomeMultiplier' ? tradeEffect.multiplier : 1) *
      binary +
      (shipEffect.kind === 'shipyard' ? shipEffect.shipbuildingIncomePerSec : 0)
    expect(
      summary.total.creditsPerSec +
        baselinePassiveIncome(tier) * binary,
    ).toBeCloseTo(lockedFullCredits, 10)
  })

  it('total equals the sum of per-structure entries (structural invariant)', () => {
    const summary = productionSummaryFor({
      name: 'X-1',
      tier: 4,
      quirks: ['binarySystem', 'highGravity'],
      grid: fullGrid([
        ['oreMine', 5],
        ['tradeHub', 3],
        ['shipyard', 2],
        ['housing', 4],
      ]),
    })
    const credits = summary.perStructure.reduce((sum, e) => sum + e.creditsPerSec, 0)
    const alloys = summary.perStructure.reduce((sum, e) => sum + e.alloysPerSec, 0)
    expect(summary.total.creditsPerSec).toBe(credits)
    expect(summary.total.alloysPerSec).toBe(alloys)
  })

  it('trade hub row equals baselinePassiveIncome(tier) x multiplier increment (with and without binarySystem)', () => {
    const tier = 4
    const tradeEffect = structureEffect('tradeHub', 2)
    expect(tradeEffect.kind).toBe('incomeMultiplier')
    const increment = TRADE_HUB_INCOME_MULTIPLIER_PER_LEVEL * 2

    const plain = productionSummaryFor({
      name: 'X-1',
      tier,
      grid: fullGrid([['tradeHub', 2]]),
    })
    expect(row(plain, 'tradeHub').creditsPerSec).toBeCloseTo(
      baselinePassiveIncome(tier) * increment,
      12,
    )
    expect(row(plain, 'tradeHub').creditsPerSec).toBeCloseTo(8, 12)

    const binary = productionSummaryFor({
      name: 'X-1',
      tier,
      quirks: ['binarySystem'],
      grid: fullGrid([['tradeHub', 2]]),
    })
    expect(row(binary, 'tradeHub').creditsPerSec).toBeCloseTo(
      baselinePassiveIncome(tier) * increment * quirkById('binarySystem').multiplier,
      12,
    )
  })

  it('binarySystem boosts only the trade hub row, not the ore mine row', () => {
    const plain = productionSummaryFor({
      name: 'X-1',
      tier: 1,
      grid: fullGrid([
        ['oreMine', 3],
        ['tradeHub', 2],
      ]),
    })
    const binary = productionSummaryFor({
      name: 'X-1',
      tier: 1,
      quirks: ['binarySystem'],
      grid: fullGrid([
        ['oreMine', 3],
        ['tradeHub', 2],
      ]),
    })
    expect(row(binary, 'oreMine').alloysPerSec).toBe(row(plain, 'oreMine').alloysPerSec)
    expect(row(binary, 'oreMine').alloysPerSec).toBeCloseTo(0.25, 12)
    expect(row(binary, 'tradeHub').creditsPerSec).toBeCloseTo(
      row(plain, 'tradeHub').creditsPerSec * quirkById('binarySystem').multiplier,
      12,
    )
  })

  it('highGravity boosts only the ore mine row, not the trade hub row', () => {
    const plain = productionSummaryFor({
      name: 'X-1',
      tier: 1,
      grid: fullGrid([
        ['oreMine', 3],
        ['tradeHub', 2],
      ]),
    })
    const gravity = productionSummaryFor({
      name: 'X-1',
      tier: 1,
      quirks: ['highGravity'],
      grid: fullGrid([
        ['oreMine', 3],
        ['tradeHub', 2],
      ]),
    })
    expect(row(gravity, 'tradeHub').creditsPerSec).toBe(row(plain, 'tradeHub').creditsPerSec)
    expect(row(gravity, 'oreMine').alloysPerSec).toBeCloseTo(
      row(plain, 'oreMine').alloysPerSec * quirkById('highGravity').multiplier,
      12,
    )
    expect(row(gravity, 'oreMine').alloysPerSec).toBeCloseTo(0.3, 12)
  })

  it('shipyard income is not tier-scaled (identical row at tier 1 and tier 5)', () => {
    const t1 = productionSummaryFor({
      name: 'A',
      tier: 1,
      grid: fullGrid([['shipyard', 2]]),
    })
    const t5 = productionSummaryFor({
      name: 'B',
      tier: 5,
      grid: fullGrid([['shipyard', 2]]),
    })
    expect(row(t1, 'shipyard').creditsPerSec).toBe(row(t5, 'shipyard').creditsPerSec)
    expect(row(t1, 'shipyard').creditsPerSec).toBeCloseTo(
      (SHIPYARD_INCOME_PER_MIN * 2) / 60,
      12,
    )
    expect(row(t1, 'shipyard').creditsPerSec).toBeCloseTo(1.6666666666666667, 12)
  })

  it('perStructure follows the canonical STRUCTURE_IDS roster order (no locale sorting)', () => {
    const summary = productionSummaryFor({
      name: 'X-1',
      tier: 3,
      grid: fullGrid([
        ['tradeHub', 2],
        ['oreMine', 3],
        ['barracks', 1],
      ]),
    })
    const ids = summary.perStructure.map((entry) => entry.structure)
    expect(ids).toEqual(STRUCTURE_IDS as unknown as StructureId[])
    expect(ids).toEqual([
      'oreMine',
      'tradeHub',
      'housing',
      'hydroponics',
      'barracks',
      'shipyard',
      'defenseTurret',
    ])
  })

  it('the roster order is invariant across grids, tiers and quirks (no locale ordering)', () => {
    const inputs: Array<Record<string, unknown>> = [
      { name: 'A', tier: 1, grid: fullGrid([]) },
      { name: 'B', tier: 5, grid: fullGrid([['shipyard', 9], ['defenseTurret', 4]]) },
      {
        name: 'C',
        tier: 3,
        quirks: ['binarySystem', 'highGravity'],
        grid: fullGrid([['oreMine', 1], ['tradeHub', 1], ['housing', 1]]),
      },
    ]
    for (const input of inputs) {
      const summary = productionSummaryFor(
        input as Parameters<typeof productionSummaryFor>[0],
      )
      expect(summary.perStructure.map((e) => e.structure)).toEqual([
        'oreMine',
        'tradeHub',
        'housing',
        'hydroponics',
        'barracks',
        'shipyard',
        'defenseTurret',
      ])
    }
  })

  it('keeps the roster order for a full grid at every tier', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      const summary = productionSummaryFor({
        name: `T${tier}`,
        tier,
        grid: fullGrid([
          ['oreMine', 5],
          ['tradeHub', 3],
          ['housing', 4],
          ['hydroponics', 2],
          ['barracks', 2],
          ['shipyard', 1],
          ['defenseTurret', 2],
        ]),
      })
      expect(summary.perStructure.map((e) => e.structure)).toEqual(
        STRUCTURE_IDS as unknown as StructureId[],
      )
    }
  })

  it('total always equals the sum of per-structure rows (full grid)', () => {
    const summary = productionSummaryFor({
      name: 'X-1',
      tier: 5,
      quirks: ['binarySystem', 'highGravity'],
      grid: fullGrid([
        ['oreMine', 7],
        ['tradeHub', 4],
        ['shipyard', 6],
        ['housing', 3],
        ['hydroponics', 1],
        ['barracks', 2],
        ['defenseTurret', 5],
      ]),
    })
    const credits = summary.perStructure.reduce((sum, e) => sum + e.creditsPerSec, 0)
    const alloys = summary.perStructure.reduce((sum, e) => sum + e.alloysPerSec, 0)
    expect(summary.total.creditsPerSec).toBe(credits)
    expect(summary.total.alloysPerSec).toBe(alloys)
    expect(summary.total.creditsPerSec).toBeGreaterThan(0)
    expect(summary.total.alloysPerSec).toBeGreaterThan(0)
  })

  it('descriptions come from data.ts STRUCTURES names', () => {
    const summary = productionSummaryFor({
      name: 'X-1',
      tier: 3,
      grid: fullGrid([
        ['oreMine', 3],
        ['tradeHub', 2],
      ]),
    })
    for (const entry of summary.perStructure) {
      expect(entry.description, entry.structure).toBe(STRUCTURES[entry.structure].name)
    }
  })

  it('determinism: identical inputs produce deep-equal outputs', () => {
    const input = {
      name: 'X-1',
      tier: 3,
      quirks: ['binarySystem', 'highGravity'] as const,
      grid: fullGrid([
        ['oreMine', 3],
        ['tradeHub', 2],
        ['shipyard', 4],
      ]),
    }
    expect(productionSummaryFor(input)).toEqual(productionSummaryFor(input))
    expect(productionSummaryFor(input)).toEqual(productionSummaryFor({ ...input }))
  })

  it('planet field echoes the input name and tier', () => {
    const summary = productionSummaryFor({
      name: 'Kepler-9 d',
      tier: 4,
      grid: fullGrid([]),
    })
    expect(summary.planet).toEqual({ name: 'Kepler-9 d', tier: 4 })
  })

  it('all-zero grid yields zero rates (trade hub at Lv 0 adds no increment)', () => {
    const summary = productionSummaryFor({
      name: 'X-1',
      tier: 2,
      grid: fullGrid([['tradeHub', 0]]),
    })
    expect(summary.total).toEqual({ creditsPerSec: 0, alloysPerSec: 0 })
    expect(row(summary, 'tradeHub').creditsPerSec).toBe(0)
  })

  it('validation: unknown structure key in the grid throws RangeError', () => {
    expect(() =>
      productionSummaryFor({
        name: 'X-1',
        tier: 1,
        grid: { oreMine: 1, wormholeGate: 5 } as unknown as Record<StructureId, number>,
      }),
    ).toThrow(RangeError)
  })

  it('validation: negative and fractional levels in the grid throw RangeError', () => {
    for (const level of [-1, 1.5]) {
      expect(() =>
        productionSummaryFor({
          name: 'X-1',
          tier: 1,
          grid: fullGrid([['oreMine', level]]),
        }),
        `level=${level}`,
      ).toThrow(RangeError)
    }
  })

  it('validation: bad tier throws RangeError', () => {
    expect(() =>
      productionSummaryFor({
        name: 'X-1',
        tier: 6,
        grid: fullGrid([['oreMine', 1]]),
      }),
    ).toThrow(RangeError)
  })

  it('validation: unknown quirk id throws RangeError', () => {
    expect(() =>
      productionSummaryFor({
        name: 'X-1',
        tier: 1,
        quirks: ['binarySystem', 'nope' as QuirkId],
        grid: fullGrid([['oreMine', 1]]),
      }),
    ).toThrow(RangeError)
  })
})
