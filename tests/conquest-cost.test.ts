import { describe, expect, it } from 'vitest'
import {
  CONQUEST_BASE_CREDITS,
  CONQUEST_BASE_FLEET,
  CONQUEST_BASE_POPULATION,
  CONQUEST_COST_CONSTANTS,
  CONQUEST_ESCALATION_CAP,
  EMPIRE_ESCALATION_PER_CONQUEST,
  baseConquestCost,
  conquestCostFor,
  conquestCostSummary,
  empireEscalation,
} from '../src/sim/combat/conquest-cost'
import type { ConquestCost } from '../src/sim/combat/conquest-cost'

function costFor(overrides: Partial<{ targetId: string; tier: number; attackerConquests: number }> = {}): ConquestCost {
  return conquestCostFor({
    targetId: 'g-667-c',
    tier: 4,
    attackerConquests: 3,
    ...overrides,
  })
}

describe('conquest-cost constants — the balance-harness pins (P10)', () => {
  it('the base curve constants are pinned to the draft values', () => {
    expect(CONQUEST_BASE_POPULATION).toBe(2000)
    expect(CONQUEST_BASE_FLEET).toBe(1000)
    expect(CONQUEST_BASE_CREDITS).toBe(50_000)
  })

  it('the escalation knobs are pinned (0.1 per conquest, capped at 2.0)', () => {
    expect(EMPIRE_ESCALATION_PER_CONQUEST).toBe(0.1)
    expect(CONQUEST_ESCALATION_CAP).toBe(2.0)
  })

  it('the deep-frozen constant table mirrors the exported values', () => {
    expect(CONQUEST_COST_CONSTANTS).toEqual({
      basePopulation: CONQUEST_BASE_POPULATION,
      baseFleet: CONQUEST_BASE_FLEET,
      baseCredits: CONQUEST_BASE_CREDITS,
      perConquest: EMPIRE_ESCALATION_PER_CONQUEST,
      cap: CONQUEST_ESCALATION_CAP,
    })
  })
})

describe('baseConquestCost — the DESIGN base curve (2,000 × tier / 1,000 × tier / 50,000 × tier)', () => {
  it('hand-computed T4 → 8,000 population / 4,000 fleet / 200,000 credits', () => {
    expect(baseConquestCost(4)).toEqual({
      population: 8_000,
      fleet: 4_000,
      credits: 200_000,
    })
  })

  it('T1 → 2,000 population / 1,000 fleet / 50,000 credits', () => {
    expect(baseConquestCost(1)).toEqual({
      population: 2_000,
      fleet: 1_000,
      credits: 50_000,
    })
  })

  it('T2 → 4,000 / 2,000 / 100,000 and T3 → 6,000 / 3,000 / 150,000', () => {
    expect(baseConquestCost(2)).toEqual({ population: 4_000, fleet: 2_000, credits: 100_000 })
    expect(baseConquestCost(3)).toEqual({ population: 6_000, fleet: 3_000, credits: 150_000 })
  })

  it('top catalogue tier T5 → 10,000 / 5,000 / 250,000', () => {
    expect(baseConquestCost(5)).toEqual({
      population: 10_000,
      fleet: 5_000,
      credits: 250_000,
    })
  })

  it('is deterministic — identical inputs produce deep-equal costs', () => {
    expect(baseConquestCost(4)).toEqual(baseConquestCost(4))
  })
})

describe('baseConquestCost — validation', () => {
  it('tier 0 throws (the catalogue has no tier below 1)', () => {
    expect(() => baseConquestCost(0)).toThrow(RangeError)
  })

  it('negative, fractional, NaN and infinite tiers throw RangeError', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => baseConquestCost(bad), `tier ${bad}`).toThrow(RangeError)
    }
  })
})

describe('empireEscalation — the anti-spam curve (×1 + 0.1 per conquest)', () => {
  it('0 conquests → ×1.0 and reason "none"', () => {
    expect(empireEscalation(0)).toEqual({ multiplier: 1, reason: 'none' })
  })

  it('1 conquest → ×1.1, reason "recent conquest #1"', () => {
    expect(empireEscalation(1).multiplier).toBeCloseTo(1.1, 10)
    expect(empireEscalation(1).reason).toBe('recent conquest #1')
  })

  it('3 conquests → ×1.3, reason "recent conquest #3" (hand-computed)', () => {
    expect(empireEscalation(3).multiplier).toBeCloseTo(1.3, 10)
    expect(empireEscalation(3).reason).toBe('recent conquest #3')
  })

  it('5 conquests → ×1.5; 9 conquests → ×1.9', () => {
    expect(empireEscalation(5).multiplier).toBeCloseTo(1.5, 10)
    expect(empireEscalation(9).multiplier).toBeCloseTo(1.9, 10)
  })

  it('is deterministic — identical inputs produce identical escalation', () => {
    expect(empireEscalation(3)).toEqual(empireEscalation(3))
  })
})

describe('empireEscalation — the cap (not spammable, never a lockout)', () => {
  it('10 conquests is the first cap hit → exactly ×2.0', () => {
    expect(empireEscalation(10).multiplier).toBe(2)
  })

  it('15 conquests stays at ×2.0 (capped) while the reason still reflects the count', () => {
    expect(empireEscalation(15).multiplier).toBe(2)
    expect(empireEscalation(15).reason).toBe('recent conquest #15')
  })

  it('a huge conquest count never exceeds the cap', () => {
    expect(empireEscalation(100).multiplier).toBe(2)
  })
})

describe('empireEscalation — validation', () => {
  it('negative, fractional, NaN and infinite conquest counts throw RangeError', () => {
    for (const bad of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => empireEscalation(bad), `attackerConquests ${bad}`).toThrow(RangeError)
    }
  })
})

describe('conquestCostFor — total = base × multiplier (each component floored)', () => {
  it('T4 with 0 conquests: totals equal the base (×1.0, no escalation)', () => {
    const cost = costFor({ attackerConquests: 0 })
    expect(cost.total).toEqual(cost.base)
    expect(cost.escalation).toEqual({ multiplier: 1, reason: 'none' })
  })

  it('T4 with 3 conquests: 10,400 population · 5,200 fleet · 260,000 credits (hand-computed)', () => {
    const cost = costFor({ attackerConquests: 3 })
    expect(cost.total).toEqual({ population: 10_400, fleet: 5_200, credits: 260_000 })
  })

  it('T1 at the cap (15 conquests): ×2.0 → 4,000 / 2,000 / 100,000', () => {
    const cost = costFor({ tier: 1, attackerConquests: 15 })
    expect(cost.escalation.multiplier).toBe(2)
    expect(cost.total).toEqual({ population: 4_000, fleet: 2_000, credits: 100_000 })
  })

  it('T2 with 7 conquests: ×1.7 → 6,800 / 3,400 / 170,000', () => {
    const cost = costFor({ tier: 2, attackerConquests: 7 })
    expect(cost.total).toEqual({ population: 6_800, fleet: 3_400, credits: 170_000 })
  })

  it('every total component is exactly floor(base × multiplier)', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      for (const conquests of [0, 1, 3, 7, 10, 15]) {
        const cost = costFor({ tier, attackerConquests: conquests })
        expect(cost.total.population).toBe(Math.floor(cost.base.population * cost.escalation.multiplier))
        expect(cost.total.fleet).toBe(Math.floor(cost.base.fleet * cost.escalation.multiplier))
        expect(cost.total.credits).toBe(Math.floor(cost.base.credits * cost.escalation.multiplier))
      }
    }
  })
})

describe('conquestCostFor — identity and purity', () => {
  it('carries targetId through the record (trimmed by the shared validator)', () => {
    expect(costFor({ targetId: '  gliese-667-c  ' }).targetId).toBe('gliese-667-c')
  })

  it('records the catalogue tier and the escalation reason in the cost', () => {
    const cost = costFor({ tier: 5, attackerConquests: 3 })
    expect(cost.tier).toBe(5)
    expect(cost.escalation.reason).toBe('recent conquest #3')
  })

  it('is deterministic — identical inputs produce deep-equal costs', () => {
    const input = { targetId: 'g-667-c', tier: 4, attackerConquests: 3 }
    expect(conquestCostFor(input)).toEqual(conquestCostFor(input))
  })

  it('never mutates its input object', () => {
    const input = { targetId: 'g-667-c', tier: 4, attackerConquests: 3 }
    const before = { ...input }
    conquestCostFor(input)
    expect(input).toEqual(before)
  })
})

describe('conquestCostFor — validation', () => {
  it('an empty or whitespace targetId throws RangeError', () => {
    for (const bad of ['', '   ']) {
      expect(() => conquestCostFor({ targetId: bad, tier: 4, attackerConquests: 0 }), `targetId ${bad}`).toThrow(RangeError)
    }
  })

  it('an invalid tier throws RangeError (delegated to baseConquestCost)', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => conquestCostFor({ targetId: 'g-667-c', tier: bad, attackerConquests: 0 }), `tier ${bad}`).toThrow(RangeError)
    }
  })

  it('an invalid conquest count throws RangeError (delegated to empireEscalation)', () => {
    for (const bad of [-1, 2.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => conquestCostFor({ targetId: 'g-667-c', tier: 4, attackerConquests: bad }), `attackerConquests ${bad}`).toThrow(RangeError)
    }
  })
})

describe('conquestCostSummary — the deterministic one-liner', () => {
  it('the DESIGN example: T4 · ×1.3 → 10,400 population · 5,200 fleet · 260K cr', () => {
    expect(conquestCostSummary(costFor({ attackerConquests: 3 }))).toBe(
      'Conquest cost (T4 · ×1.3): 10,400 population · 5,200 fleet · 260K cr',
    )
  })

  it('T1 · ×1.0 → 2,000 population · 1,000 fleet · 50K cr', () => {
    expect(conquestCostSummary(costFor({ tier: 1, attackerConquests: 0 }))).toBe(
      'Conquest cost (T1 · ×1.0): 2,000 population · 1,000 fleet · 50K cr',
    )
  })

  it('T5 at the cap · ×2.0 → 20,000 population · 10,000 fleet · 500K cr (thousands separators)', () => {
    expect(conquestCostSummary(costFor({ tier: 5, attackerConquests: 15 }))).toBe(
      'Conquest cost (T5 · ×2.0): 20,000 population · 10,000 fleet · 500K cr',
    )
  })

  it('is deterministic — the same cost always renders the same string', () => {
    const cost = costFor({ attackerConquests: 3 })
    expect(conquestCostSummary(cost)).toBe(conquestCostSummary(cost))
  })
})

describe('conquestCostSummary — validation', () => {
  it('a malformed tier (below 1 or fractional) throws RangeError', () => {
    for (const tier of [0, 1.5]) {
      const bad = { ...costFor(), tier }
      expect(() => conquestCostSummary(bad), `tier ${tier}`).toThrow(RangeError)
    }
  })

  it('a non-finite multiplier throws RangeError', () => {
    const bad = costFor()
    bad.escalation.multiplier = Number.NaN
    expect(() => conquestCostSummary(bad)).toThrow(RangeError)
  })

  it('negative or fractional total components throw RangeError', () => {
    const negative = costFor()
    negative.total.credits = -1
    expect(() => conquestCostSummary(negative)).toThrow(RangeError)
    const fractional = costFor()
    fractional.total.population = 10_400.5
    expect(() => conquestCostSummary(fractional)).toThrow(RangeError)
  })
})
