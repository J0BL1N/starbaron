import { describe, expect, it } from 'vitest'
import {
  CASUALTY_RESULTS,
  DEFENDER_GARRISON_LOSS_RATE,
  applyCasualties,
  attackerPopulationImpact,
  casualtyLedgerInvariants,
  casualtyReport,
} from '../src/sim/combat/casualties'
import type {
  ApplyCasualtiesInput,
  CasualtyLedger,
} from '../src/sim/combat/casualties'
import type { BattleOutcome } from '../src/sim/combat/resolution'

const AT = 1_700_000_000_000

// A hand-built BattleOutcome so delegation tests can prove the ledger mirrors
// the T03 output EXACTLY — including values no resolution formula would
// produce (proving there is no recompute here).
function outcome(overrides: Partial<BattleOutcome> = {}): BattleOutcome {
  return {
    battleId: 'battle-1',
    attackerId: 'attacker-1',
    targetId: 'target-1',
    resolvedAt: AT,
    attackPower: 15_000,
    defensePower: 10_000,
    victory: true,
    survivingTroops: 3_500,
    defenderCasualties: 4_000,
    result: 'victory',
    ...overrides,
  }
}

function applyInput(
  overrides: Partial<ApplyCasualtiesInput> = {},
): ApplyCasualtiesInput {
  return {
    outcome: outcome(),
    committedTroops: 5_000,
    defenderPopulationBefore: 40_000,
    defenderGarrisonBefore: 2_000,
    ...overrides,
  }
}

describe('applyCasualties — delegation to the T03 outcome (never recomputed)', () => {
  it('survivors are EXACTLY outcome.survivingTroops (victory worked example: 3,500)', () => {
    const ledger = applyCasualties(applyInput())
    expect(ledger.attacker.survivors).toBe(3_500)
    expect(ledger.attacker.survivors).toBe(ledger.attacker.troopsCommitted - 1_500)
  })

  it('defender populationLoss is EXACTLY outcome.defenderCasualties (victory: 4,000)', () => {
    const ledger = applyCasualties(applyInput())
    expect(ledger.defender.populationLoss).toBe(4_000)
  })

  it('delegation survives a NON-derivable survivingTroops value (1,234 is mirrored, not recomputed)', () => {
    const ledger = applyCasualties(
      applyInput({ outcome: outcome({ survivingTroops: 1_234 }) }),
    )
    expect(ledger.attacker.survivors).toBe(1_234)
    expect(ledger.attacker.populationLoss).toBe(5_000 - 1_234)
  })

  it('delegation survives a NON-derivable defenderCasualties value (999 is mirrored, not recomputed)', () => {
    const ledger = applyCasualties(
      applyInput({ outcome: outcome({ defenderCasualties: 999 }) }),
    )
    expect(ledger.defender.populationLoss).toBe(999)
  })
})

describe('applyCasualties — attacker population impact (committed troops are spent)', () => {
  it('victory: 5,000 committed, 3,500 survivors → 1,500 population loss (only the dead)', () => {
    const ledger = applyCasualties(applyInput())
    expect(ledger.attacker.populationLoss).toBe(1_500)
    expect(ledger.attacker.populationLoss).toBe(5_000 - 3_500)
  })

  it('defeat: all committed troops are lost → populationLoss equals committedTroops', () => {
    const ledger = applyCasualties(
      applyInput({ outcome: outcome({ survivingTroops: 0, result: 'defeat', victory: false }) }),
    )
    expect(ledger.attacker.populationLoss).toBe(5_000)
  })

  it('stalemate: the withdrawn force returns → populationLoss = committed − survivors', () => {
    const ledger = applyCasualties(
      applyInput({ outcome: outcome({ survivingTroops: 2_500, result: 'stalemate', victory: false }) }),
    )
    expect(ledger.attacker.populationLoss).toBe(2_500)
    expect(ledger.attacker.survivors).toBe(2_500)
  })

  it('populationLoss = committedTroops − survivors for arbitrary values', () => {
    const ledger = applyCasualties(
      applyInput({ committedTroops: 8_000, outcome: outcome({ survivingTroops: 1_234 }) }),
    )
    expect(ledger.attacker.populationLoss).toBe(6_766)
  })
})

describe('applyCasualties — fleetLost semantics', () => {
  it('defeat → fleetLost true (a repelled force loses its escort fleet)', () => {
    const ledger = applyCasualties(
      applyInput({ outcome: outcome({ survivingTroops: 0, result: 'defeat', victory: false }) }),
    )
    expect(ledger.attacker.fleetLost).toBe(true)
  })

  it('victory → fleetLost false (the fleet survives the conquest — documented choice)', () => {
    expect(applyCasualties(applyInput()).attacker.fleetLost).toBe(false)
  })

  it('stalemate → fleetLost false (the attackers withdraw and the fleet retreats intact)', () => {
    const ledger = applyCasualties(
      applyInput({ outcome: outcome({ survivingTroops: 2_500, result: 'stalemate', victory: false }) }),
    )
    expect(ledger.attacker.fleetLost).toBe(false)
  })
})

describe('applyCasualties — defender garrison losses (PINNED mapping)', () => {
  it('victory → the garrison is destroyed in the fall: garrisonLoss = garrisonBefore (all)', () => {
    const ledger = applyCasualties(
      applyInput({ outcome: outcome({ result: 'victory', victory: true }) }),
    )
    expect(ledger.defender.garrisonLoss).toBe(2_000)
    expect(ledger.defender.garrisonLoss).toBe(2_000)
  })

  it('defeat → the defender holds: garrisonLoss = floor(garrisonBefore × 0.2)', () => {
    const ledger = applyCasualties(
      applyInput({
        defenderGarrisonBefore: 2_000,
        outcome: outcome({ survivingTroops: 0, result: 'defeat', victory: false }),
      }),
    )
    expect(ledger.defender.garrisonLoss).toBe(400)
    expect(ledger.defender.garrisonLoss).toBe(
      Math.floor(2_000 * DEFENDER_GARRISON_LOSS_RATE),
    )
  })

  it('stalemate → garrisonLoss = 0 (the assault withdraws; the garrison holds intact)', () => {
    const ledger = applyCasualties(
      applyInput({ outcome: outcome({ survivingTroops: 2_500, result: 'stalemate', victory: false }) }),
    )
    expect(ledger.defender.garrisonLoss).toBe(0)
  })

  it('defeat floors a non-divisible garrison (123 → floor(24.6) = 24)', () => {
    const ledger = applyCasualties(
      applyInput({
        defenderGarrisonBefore: 123,
        outcome: outcome({ survivingTroops: 0, result: 'defeat', victory: false }),
      }),
    )
    expect(ledger.defender.garrisonLoss).toBe(24)
  })

  it('a zero garrison stays zero in every outcome', () => {
    for (const result of CASUALTY_RESULTS) {
      const ledger = applyCasualties(
        applyInput({
          defenderGarrisonBefore: 0,
          outcome: outcome({
            survivingTroops: result === 'victory' ? 3_500 : result === 'stalemate' ? 2_500 : 0,
            defenderCasualties: result === 'defeat' ? 8_000 : result === 'victory' ? 4_000 : 0,
            result,
            victory: result === 'victory',
          }),
        }),
      )
      expect(ledger.defender.garrisonLoss, result).toBe(0)
    }
  })
})

describe('applyCasualties — ledger identity & invariants', () => {
  it('the ledger carries the outcome identity (attackerId, targetId, battleId, resolvedAt)', () => {
    const ledger = applyCasualties(applyInput())
    expect(ledger.attackerId).toBe('attacker-1')
    expect(ledger.targetId).toBe('target-1')
    expect(ledger.battleId).toBe('battle-1')
    expect(ledger.resolvedAt).toBe(AT)
    expect(ledger.result).toBe('victory')
  })

  it('throws when defenderCasualties exceed defenderPopulationBefore (population never negative)', () => {
    expect(() =>
      applyCasualties(
        applyInput({
          defenderPopulationBefore: 5_000,
          outcome: outcome({ defenderCasualties: 10_000 }),
        }),
      ),
    ).toThrow(RangeError)
  })

  it('throws when survivors exceed committedTroops (cannot return more than committed)', () => {
    expect(() =>
      applyCasualties(
        applyInput({ committedTroops: 3_000, outcome: outcome({ survivingTroops: 5_000 }) }),
      ),
    ).toThrow(RangeError)
  })

  it('accepts the boundary: zero survivors, zero defender losses, zero garrison', () => {
    const ledger = applyCasualties(
      applyInput({
        outcome: outcome({
          survivingTroops: 0,
          defenderCasualties: 0,
          result: 'defeat',
          victory: false,
        }),
      }),
    )
    expect(ledger.attacker.populationLoss).toBe(5_000)
    expect(ledger.defender.populationLoss).toBe(0)
    expect(ledger.defender.garrisonLoss).toBe(Math.floor(2_000 * 0.2))
  })
})

describe('applyCasualties — determinism & immutability', () => {
  it('is deterministic across identical inputs and returns a fresh ledger', () => {
    const input = applyInput()
    const a = applyCasualties(input)
    const b = applyCasualties(input)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.attacker).not.toBe(b.attacker)
    expect(a.defender).not.toBe(b.defender)
  })

  it('never mutates its input', () => {
    const input = applyInput()
    const before = JSON.stringify(input)
    applyCasualties(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('applyCasualties — validation', () => {
  it('throws RangeError for a non-positive or non-integer committedTroops', () => {
    for (const bad of [0, -100, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => applyCasualties(applyInput({ committedTroops: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
  })

  it('throws RangeError for a negative or non-finite defenderPopulationBefore / defenderGarrisonBefore', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => applyCasualties(applyInput({ defenderPopulationBefore: bad })),
        `population ${bad}`,
      ).toThrow(RangeError)
      expect(
        () => applyCasualties(applyInput({ defenderGarrisonBefore: bad })),
        `garrison ${bad}`,
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError for a fractional defenderGarrisonBefore (garrisonLoss must stay an integer)', () => {
    for (const bad of [0.5, 2.5, 1.999]) {
      expect(
        () => applyCasualties(applyInput({ defenderGarrisonBefore: bad })),
        `garrison ${bad}`,
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError for a malformed outcome (result outside the union, bad survivors, bad resolvedAt)', () => {
    expect(() =>
      applyCasualties(applyInput({ outcome: outcome({ result: 'moon' as BattleOutcome['result'] }) })),
    ).toThrow(RangeError)
    expect(() => applyCasualties(applyInput({ outcome: outcome({ survivingTroops: -1 }) }))).toThrow(
      RangeError,
    )
    expect(() => applyCasualties(applyInput({ outcome: outcome({ resolvedAt: 0 }) }))).toThrow(
      RangeError,
    )
  })

  it('throws RangeError for an outcome missing identity strings', () => {
    expect(() => applyCasualties(applyInput({ outcome: outcome({ battleId: '' }) }))).toThrow(
      RangeError,
    )
    expect(() => applyCasualties(applyInput({ outcome: outcome({ attackerId: '  ' }) }))).toThrow(
      RangeError,
    )
  })
})

describe('attackerPopulationImpact', () => {
  it('totalPopulationLost = the dead (populationLoss); survivorsReturned = survivors', () => {
    const ledger = applyCasualties(applyInput())
    const impact = attackerPopulationImpact(ledger)
    expect(impact.totalPopulationLost).toBe(ledger.attacker.populationLoss)
    expect(impact.survivorsReturned).toBe(ledger.attacker.survivors)
  })

  it('victory: 1,500 dead + 3,500 returned home (survivors recover the attacker population)', () => {
    const impact = attackerPopulationImpact(applyCasualties(applyInput()))
    expect(impact.totalPopulationLost).toBe(1_500)
    expect(impact.survivorsReturned).toBe(3_500)
  })

  it('defeat: 5,000 dead + 0 returned home', () => {
    const impact = attackerPopulationImpact(
      applyCasualties(
        applyInput({ outcome: outcome({ survivingTroops: 0, result: 'defeat', victory: false }) }),
      ),
    )
    expect(impact.totalPopulationLost).toBe(5_000)
    expect(impact.survivorsReturned).toBe(0)
  })

  it('throws RangeError for a malformed ledger', () => {
    const bad: CasualtyLedger = {
      ...applyCasualties(applyInput()),
      attacker: { ...applyCasualties(applyInput()).attacker, populationLoss: -5 },
    }
    expect(() => attackerPopulationImpact(bad)).toThrow(RangeError)
  })
})

describe('casualtyReport', () => {
  it('renders the deterministic one-line format (DESIGN worked example)', () => {
    const ledger = applyCasualties(
      applyInput({
        committedTroops: 5_000,
        outcome: outcome({ survivingTroops: 3_000, defenderCasualties: 850 }),
      }),
    )
    expect(casualtyReport(ledger)).toBe(
      '2,000 troops lost · 3,000 returned home · defenders lost 850',
    )
  })

  it('formats large numbers with plain thousands separators (no region formatting)', () => {
    const ledger = applyCasualties(
      applyInput({
        committedTroops: 1_000_000,
        outcome: outcome({ survivingTroops: 234_567, defenderCasualties: 12_345 }),
      }),
    )
    expect(casualtyReport(ledger)).toBe(
      '765,433 troops lost · 234,567 returned home · defenders lost 12,345',
    )
  })

  it('renders the stalemate line (withdrawn force returns home, no defender losses)', () => {
    const ledger = applyCasualties(
      applyInput({
        committedTroops: 5_000,
        outcome: outcome({
          survivingTroops: 2_500,
          defenderCasualties: 0,
          result: 'stalemate',
          victory: false,
        }),
      }),
    )
    expect(casualtyReport(ledger)).toBe(
      '2,500 troops lost · 2,500 returned home · defenders lost 0',
    )
  })

  it('is deterministic', () => {
    const ledger = applyCasualties(applyInput())
    expect(casualtyReport(ledger)).toBe(casualtyReport(ledger))
  })
})

describe('purity — frozen tables, pinned rates & ledger invariants', () => {
  it('CASUALTY_RESULTS is deep-frozen with the union (mutation throws TypeError)', () => {
    expect(Object.isFrozen(CASUALTY_RESULTS)).toBe(true)
    expect([...CASUALTY_RESULTS]).toEqual(['victory', 'defeat', 'stalemate'])
    expect(() => {
      ;(CASUALTY_RESULTS as unknown as string[]).push('moon')
    }).toThrow(TypeError)
  })

  it('DEFENDER_GARRISON_LOSS_RATE is pinned at 0.2', () => {
    expect(DEFENDER_GARRISON_LOSS_RATE).toBe(0.2)
  })

  it('casualtyLedgerInvariants passes a fresh ledger and flags a corrupted one', () => {
    const ok = casualtyLedgerInvariants(applyCasualties(applyInput()))
    expect(ok.ok).toBe(true)
    expect(ok.problems).toEqual([])
    const bad: CasualtyLedger = {
      ...applyCasualties(applyInput()),
      defender: { ...applyCasualties(applyInput()).defender, garrisonLoss: -3 },
    }
    const flagged = casualtyLedgerInvariants(bad)
    expect(flagged.ok).toBe(false)
    expect(flagged.problems.length).toBeGreaterThan(0)
  })
})
