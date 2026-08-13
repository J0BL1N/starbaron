import { describe, expect, it } from 'vitest'
import {
  BATTLE_CASUALTY_RATE,
  BATTLE_RESULTS,
  DEFENDER_CASUALTY_RATE,
  DEFENDER_CASUALTY_RATE_VICTORY,
  STALEMATE_SURVIVOR_RATE,
  battlePowers,
  battleReport,
  resolveBattle,
} from '../src/sim/combat/resolution'
import type { BattleOutcome, ResolveBattleInput } from '../src/sim/combat/resolution'
import { fnv1a } from '../src/sim/planets/hash'
import { attackPower as lockedAttackPower } from '../src/sim/player/estimator'
import { defensePower as lockedDefensePower } from '../src/sim/structures/effects'
import type { PlayerState } from '../src/sim/player/types'
import { CONQUEST_PROTECTED_MESSAGE } from '../src/sim/combat/home-immunity'

const AT = 1_700_000_000_000

// DESIGN worked example: 8 turrets + 40,000 pop = 10,000 DP; 5,000 troops ×
// tier 2 = 10,000 AP (the stalemate boundary); tier 3 = 15,000 (victory);
// tier 1 = 5,000 (defeat).
const TURRETS = 8
const POP = 40_000

/** A target owner whose home world is a different, protected world. */
function player(ownerId: string, homeName: string): PlayerState {
  return {
    playerId: ownerId,
    homePlanet: {
      name: homeName,
      entry: { name: homeName, hostname: `${homeName} Host`, systemCount: 1, tier: 1 },
      tier: 1,
      baselineIncomePerSec: 10,
      populationCapMultiplier: 1,
      claimedAt: AT,
      isHome: true,
      unconquerable: true,
      population: 0,
      garrison: 0,
      fleet: 0,
    },
    colonies: [],
    wallet: { credits: 0, alloys: 0 },
    structureLevels: {},
    lastTickAt: AT,
  }
}

function resolveInput(
  overrides: Partial<ResolveBattleInput> = {},
): ResolveBattleInput {
  return {
    attackerId: 'attacker-1',
    targetId: 'target-1',
    troops: 5000,
    shipyardTier: 2,
    turretLevels: TURRETS,
    population: POP,
    resolvedAt: AT,
    targetOwner: null,
    ...overrides,
  }
}

describe('battlePowers — the locked AP/DP math (DESIGN §5a)', () => {
  it('hand-computed: 5,000 troops × tier 2 = 10,000 attack power', () => {
    expect(battlePowers({ troops: 5000, shipyardTier: 2, turretLevels: TURRETS, population: POP })).toEqual({
      attackPower: 10_000,
      defensePower: 10_000,
    })
  })

  it('defense power matches the DESIGN worked example (8 turrets + 40k pop = 10,000 DP)', () => {
    const { defensePower } = battlePowers({
      troops: 5000,
      shipyardTier: 2,
      turretLevels: TURRETS,
      population: POP,
    })
    expect(defensePower).toBe(10_000)
    expect(defensePower).toBe(lockedDefensePower(TURRETS, POP))
  })

  it('delegates attack power to the locked estimator helper (effectiveLevel AP)', () => {
    const input = { troops: 5000, shipyardTier: 2, turretLevels: TURRETS, population: POP }
    expect(battlePowers(input).attackPower).toBe(lockedAttackPower(input.troops, input.shipyardTier))
  })

  it('the shipyard tier contributes its effective level (tier 11 → 10.5×)', () => {
    const ap = battlePowers({ troops: 5000, shipyardTier: 11, turretLevels: 0, population: 0 }).attackPower
    expect(ap).toBe(5000 * 10.5)
    expect(ap).toBe(52_500)
  })

  it('a zero shipyard tier yields zero attack power; zero turrets + zero pop yield zero DP', () => {
    const powers = battlePowers({ troops: 5000, shipyardTier: 0, turretLevels: 0, population: 0 })
    expect(powers.attackPower).toBe(0)
    expect(powers.defensePower).toBe(0)
  })

  it('turret-only and militia-only DP compose additively', () => {
    const turretOnly = battlePowers({ troops: 100, shipyardTier: 1, turretLevels: 2, population: 0 }).defensePower
    expect(turretOnly).toBe(1000)
    const militiaOnly = battlePowers({ troops: 100, shipyardTier: 1, turretLevels: 0, population: 1000 }).defensePower
    expect(militiaOnly).toBe(150)
  })

  it('is deterministic and does not mutate its input', () => {
    const input = { troops: 5000, shipyardTier: 2, turretLevels: TURRETS, population: POP }
    const before = { ...input }
    expect(battlePowers(input)).toEqual(battlePowers(input))
    expect(input).toEqual(before)
  })

  it('validates through the locked helpers: bad troops / tier / turrets / population throw RangeError', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => battlePowers({ troops: bad, shipyardTier: 2, turretLevels: 0, population: 0 }),
        `troops ${bad}`,
      ).toThrow(RangeError)
    }
    for (const bad of [-1, 101, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => battlePowers({ troops: 500, shipyardTier: bad, turretLevels: 0, population: 0 }),
        `tier ${bad}`,
      ).toThrow(RangeError)
    }
    for (const bad of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => battlePowers({ troops: 500, shipyardTier: 1, turretLevels: bad, population: 0 }),
        `turrets ${bad}`,
      ).toThrow(RangeError)
    }
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => battlePowers({ troops: 500, shipyardTier: 1, turretLevels: 0, population: bad }),
        `population ${bad}`,
      ).toThrow(RangeError)
    }
  })
})

describe('resolveBattle — victory / stalemate / defeat classification', () => {
  it('victory when attack power exceeds defense power (15,000 > 10,000)', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 3 }))
    expect(outcome.result).toBe('victory')
    expect(outcome.victory).toBe(true)
    expect(outcome.attackPower).toBe(15_000)
    expect(outcome.defensePower).toBe(10_000)
  })

  it('defeat when attack power is below defense power (5,000 < 10,000)', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 1 }))
    expect(outcome.result).toBe('defeat')
    expect(outcome.victory).toBe(false)
    expect(outcome.attackPower).toBe(5_000)
    expect(outcome.defensePower).toBe(10_000)
  })

  it('stalemate when attack power EQUALS defense power (10,000 == 10,000) — defenders hold', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 2 }))
    expect(outcome.result).toBe('stalemate')
    expect(outcome.victory).toBe(false)
    expect(outcome.attackPower).toBe(10_000)
    expect(outcome.defensePower).toBe(10_000)
  })

  it('the zero/zero edge is a stalemate (equality holds at zero power)', () => {
    const outcome = resolveBattle(
      resolveInput({ shipyardTier: 0, turretLevels: 0, population: 0 }),
    )
    expect(outcome.attackPower).toBe(0)
    expect(outcome.defensePower).toBe(0)
    expect(outcome.result).toBe('stalemate')
  })

  it('victory is the result flag for every outcome (result ↔ victory agreement)', () => {
    expect(resolveBattle(resolveInput({ shipyardTier: 3 })).victory).toBe(true)
    expect(resolveBattle(resolveInput({ shipyardTier: 2 })).victory).toBe(false)
    expect(resolveBattle(resolveInput({ shipyardTier: 1 })).victory).toBe(false)
  })
})

describe('resolveBattle — surviving troops', () => {
  it('victory: survivingTroops = floor(troops × (1 − 0.3)) = 3,500 of 5,000', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 3 }))
    expect(outcome.survivingTroops).toBe(Math.floor(5000 * (1 - BATTLE_CASUALTY_RATE)))
    expect(outcome.survivingTroops).toBe(3_500)
  })

  it('defeat: all committed troops are lost (surviving 0)', () => {
    expect(resolveBattle(resolveInput({ shipyardTier: 1 })).survivingTroops).toBe(0)
  })

  it('stalemate: attackers withdraw with floor(troops × 0.5) = 2,500 of 5,000', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 2 }))
    expect(outcome.survivingTroops).toBe(Math.floor(5000 * STALEMATE_SURVIVOR_RATE))
    expect(outcome.survivingTroops).toBe(2_500)
  })

  it('casualtyRate overrides the victory loss (0.5 → 2,500; 0 → 5,000; 1 → 0)', () => {
    expect(resolveBattle(resolveInput({ shipyardTier: 3, casualtyRate: 0.5 })).survivingTroops).toBe(2_500)
    expect(resolveBattle(resolveInput({ shipyardTier: 3, casualtyRate: 0 })).survivingTroops).toBe(5_000)
    expect(resolveBattle(resolveInput({ shipyardTier: 3, casualtyRate: 1 })).survivingTroops).toBe(0)
  })

  it('victory survivors floor a non-divisible troop count (5,001 → 3,500)', () => {
    const outcome = resolveBattle(resolveInput({ troops: 5001, shipyardTier: 3 }))
    expect(outcome.survivingTroops).toBe(3_500)
  })

  it('stalemate survivors floor a non-divisible troop count (5,001 → 2,500)', () => {
    // DP raised to match the raised AP: 5001 × 2 = 10,002 == 0.15 × 66,680.
    const outcome = resolveBattle(
      resolveInput({ troops: 5001, shipyardTier: 2, turretLevels: 0, population: 66_680 }),
    )
    expect(outcome.result).toBe('stalemate')
    expect(outcome.survivingTroops).toBe(2_500)
  })
})

describe('resolveBattle — defender casualties', () => {
  it('victory: defenders lose floor(population × 0.1) = 4,000 (an attack that lands costs them)', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 3 }))
    expect(outcome.defenderCasualties).toBe(Math.floor(POP * DEFENDER_CASUALTY_RATE_VICTORY))
    expect(outcome.defenderCasualties).toBe(4_000)
  })

  it('defeat: defenders lose floor(population × 0.2) = 8,000 (repelled assaults still bleed them)', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 1 }))
    expect(outcome.defenderCasualties).toBe(Math.floor(POP * DEFENDER_CASUALTY_RATE))
    expect(outcome.defenderCasualties).toBe(8_000)
  })

  it('stalemate: defenders take no casualties (the attack withdraws; defenders hold)', () => {
    expect(resolveBattle(resolveInput({ shipyardTier: 2 })).defenderCasualties).toBe(0)
  })

  it('a zero-population defender takes no casualties in every outcome', () => {
    for (const tier of [3, 2, 1]) {
      expect(
        resolveBattle(resolveInput({ shipyardTier: tier, population: 0 })).defenderCasualties,
      ).toBe(0)
    }
  })
})

describe('resolveBattle — battleId determinism', () => {
  it('is the pinned fnv1a(attackerId|targetId|resolvedAt) hex hash', () => {
    const outcome = resolveBattle(resolveInput())
    expect(outcome.battleId).toBe(fnv1a('attacker-1|target-1|' + AT).toString(16))
    expect(outcome.battleId.length).toBeGreaterThan(0)
  })

  it('is deterministic across identical inputs', () => {
    expect(resolveBattle(resolveInput()).battleId).toBe(resolveBattle(resolveInput()).battleId)
  })

  it('changes when the attacker, target or resolvedAt changes', () => {
    const base = resolveBattle(resolveInput()).battleId
    expect(resolveBattle(resolveInput({ attackerId: 'attacker-2' })).battleId).not.toBe(base)
    expect(resolveBattle(resolveInput({ targetId: 'target-2' })).battleId).not.toBe(base)
    expect(resolveBattle(resolveInput({ resolvedAt: AT + 1 })).battleId).not.toBe(base)
  })
})

describe('battleReport — the deterministic one-line report', () => {
  it('victory report renders the surviving count, the committed count and defender losses', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 3 }))
    expect(battleReport(outcome, 5000)).toBe(
      'Victory: 3,500 of 5,000 troops survived · defenders lost 4,000',
    )
  })

  it('defeat report shows zero survivors', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 1 }))
    expect(battleReport(outcome, 5000)).toBe(
      'Defeat: 0 of 5,000 troops survived · defenders lost 8,000',
    )
  })

  it('stalemate report shows the withdrawn force and zero defender losses', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 2 }))
    expect(battleReport(outcome, 5000)).toBe(
      'Stalemate: 2,500 of 5,000 troops survived · defenders lost 0',
    )
  })

  it('drops the committed-troop clause when the count is omitted', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 3 }))
    expect(battleReport(outcome)).toBe('Victory: 3,500 troops survived · defenders lost 4,000')
  })

  it('formats large numbers with plain thousands separators (no region formatting)', () => {
    const big: BattleOutcome = {
      battleId: 'id',
      attackerId: 'a',
      targetId: 't',
      resolvedAt: AT,
      attackPower: 15_000_000,
      defensePower: 10_000_000,
      victory: true,
      survivingTroops: 1_234_567,
      defenderCasualties: 1_000_000,
      result: 'victory',
    }
    expect(battleReport(big, 2_000_000)).toBe(
      'Victory: 1,234,567 of 2,000,000 troops survived · defenders lost 1,000,000',
    )
  })

  it('is deterministic', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 3 }))
    expect(battleReport(outcome, 5000)).toBe(battleReport(outcome, 5000))
  })

  it('throws RangeError for a malformed committed-troop count', () => {
    const outcome = resolveBattle(resolveInput({ shipyardTier: 3 }))
    for (const bad of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => battleReport(outcome, bad), String(bad)).toThrow(RangeError)
    }
  })
})

describe('resolveBattle — validation', () => {
  it('throws RangeError for an empty attackerId or targetId', () => {
    expect(() => resolveBattle(resolveInput({ attackerId: '' }))).toThrow(RangeError)
    expect(() => resolveBattle(resolveInput({ targetId: '  ' }))).toThrow(RangeError)
  })

  it('throws RangeError for a non-positive or non-finite resolvedAt', () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveBattle(resolveInput({ resolvedAt: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
  })

  it('throws RangeError for an out-of-range casualtyRate', () => {
    for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveBattle(resolveInput({ casualtyRate: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
  })

  it('accepts the boundary casualtyRate values 0 and 1', () => {
    expect(resolveBattle(resolveInput({ shipyardTier: 3, casualtyRate: 0 })).result).toBe(
      'victory',
    )
    expect(resolveBattle(resolveInput({ shipyardTier: 3, casualtyRate: 1 })).result).toBe(
      'victory',
    )
  })
})

describe('resolveBattle — home-immunity guard (T08 wired)', () => {
  it('throws when a resolution touches the owner\'s protected home world', () => {
    const owner = player('owner-1', 'home-1')
    expect(() =>
      resolveBattle(resolveInput({ targetId: 'home-1', targetOwner: owner })),
    ).toThrow(Error)
    expect(() =>
      resolveBattle(resolveInput({ targetId: 'home-1', targetOwner: owner })),
    ).toThrow(CONQUEST_PROTECTED_MESSAGE)
  })

  it('resolves normally against an owned NON-home world (the owner\'s colony)', () => {
    const owner = player('owner-1', 'owner-home')
    const outcome = resolveBattle(
      resolveInput({ targetId: 'colony-9', targetOwner: owner }),
    )
    expect(outcome.targetId).toBe('colony-9')
    expect(outcome.result).toBe('stalemate')
  })

  it('resolves normally against an unowned target (targetOwner null)', () => {
    expect(resolveBattle(resolveInput({ targetOwner: null })).battleId).toBe(
      resolveBattle(resolveInput({ targetOwner: null })).battleId,
    )
  })
})

describe('purity — determinism, immutability and frozen tables', () => {
  it('resolveBattle is deterministic and never mutates its input', () => {
    const input = resolveInput()
    const before = { ...input }
    const a = resolveBattle(input)
    const b = resolveBattle(input)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(input).toEqual(before)
  })

  it('battlePowers and resolveBattle return fresh objects (no shared references)', () => {
    const powersA = battlePowers(resolveInput())
    const powersB = battlePowers(resolveInput())
    expect(powersA).toEqual(powersB)
    expect(powersA).not.toBe(powersB)
    const a = resolveBattle(resolveInput())
    const b = resolveBattle(resolveInput())
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('the BattleOutcome carries only primitive values (no object aliasing)', () => {
    const outcome = resolveBattle(resolveInput())
    for (const value of Object.values(outcome)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value)
    }
  })

  it('the module-level BATTLE_RESULTS lookup table is deep-frozen (runtime-immutable)', () => {
    expect(Object.isFrozen(BATTLE_RESULTS)).toBe(true)
    expect([...BATTLE_RESULTS]).toEqual(['victory', 'defeat', 'stalemate'])
    expect(() => {
      ;(BATTLE_RESULTS as unknown as string[]).push('moon')
    }).toThrow(TypeError)
  })

  it('the exported balance rates are pinned exactly', () => {
    expect(BATTLE_CASUALTY_RATE).toBe(0.3)
    expect(STALEMATE_SURVIVOR_RATE).toBe(0.5)
    expect(DEFENDER_CASUALTY_RATE).toBe(0.2)
    expect(DEFENDER_CASUALTY_RATE_VICTORY).toBe(0.1)
  })
})
