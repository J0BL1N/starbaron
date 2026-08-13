import { describe, expect, it } from 'vitest'
import {
  COMBAT_REPORT_RESULTS,
  COMBAT_REPORT_TEXT,
  buildCombatReport,
  reportInvariants,
  reportText,
} from '../src/sim/combat/combat-reports'
import type {
  BuildCombatReportInput,
  CombatReport,
} from '../src/sim/combat/combat-reports'
import type { BattleOutcome } from '../src/sim/combat/resolution'
import type { CasualtyLedger } from '../src/sim/combat/casualties'
import { applyCasualties } from '../src/sim/combat/casualties'
import { fnv1a } from '../src/sim/planets/hash'

const AT = 1_700_000_000_000
const ATTACKER_FLEET = 300
const DEFENDER_FLEET = 100

// A hand-built BattleOutcome (the T03 source) so the projection proves it
// mirrors the outcome EXACTLY — including values no resolution formula would
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

// A real T05 ledger via applyCasualties — the report consumes the same
// projection path a caller would build (T03 outcome → T05 ledger → report).
function ledgerFor(out: BattleOutcome, committedTroops = 5_000): CasualtyLedger {
  return applyCasualties({
    outcome: out,
    committedTroops,
    defenderPopulationBefore: 40_000,
    defenderGarrisonBefore: 2_000,
  })
}

function defeatOutcome(): BattleOutcome {
  return outcome({
    survivingTroops: 0,
    defenderCasualties: 8_000,
    result: 'defeat',
    victory: false,
  })
}

function stalemateOutcome(): BattleOutcome {
  return outcome({
    survivingTroops: 2_500,
    defenderCasualties: 0,
    result: 'stalemate',
    victory: false,
  })
}

function reportInput(
  overrides: Partial<BuildCombatReportInput> = {},
): BuildCombatReportInput {
  const out = outcome()
  return {
    outcome: out,
    ledger: ledgerFor(out),
    defenderId: 'defender-1',
    attackerFleetSize: ATTACKER_FLEET,
    defenderFleetSize: DEFENDER_FLEET,
    at: AT + 1_000,
    ...overrides,
  }
}

function build(overrides: Partial<BuildCombatReportInput> = {}): CombatReport {
  return buildCombatReport(reportInput(overrides))
}

function defeatReport(): CombatReport {
  const out = defeatOutcome()
  return build({ outcome: out, ledger: ledgerFor(out) })
}

function stalemateReport(): CombatReport {
  const out = stalemateOutcome()
  return build({ outcome: out, ledger: ledgerFor(out) })
}

describe('buildCombatReport — winner/loser mapping per result', () => {
  it('victory → the attacker is the winner, the defender the loser', () => {
    const report = build()
    expect(report.sections.winner).toBe('attacker-1')
    expect(report.sections.loser).toBe('defender-1')
  })

  it('defeat → the defender is the winner, the attacker the loser', () => {
    const report = defeatReport()
    expect(report.sections.winner).toBe('defender-1')
    expect(report.sections.loser).toBe('attacker-1')
  })

  it('stalemate → no winner ("") and no loser (null) — the defenders hold', () => {
    const report = stalemateReport()
    expect(report.sections.winner).toBe('')
    expect(report.sections.loser).toBeNull()
  })
})

describe('buildCombatReport — ship losses (PINNED model)', () => {
  it('victory: 5,000 committed, 3,500 survivors → the attacker fleet loses 30% (300 → 90)', () => {
    const report = build()
    expect(report.sections.shipLosses.attacker).toBe(90)
    expect(report.sections.shipLosses.attacker).toBe(
      Math.floor(ATTACKER_FLEET * (1 - 3_500 / 5_000)),
    )
  })

  it('victory: the attacker ship loss floors a non-divisible ratio (survivors 1,234 → 225)', () => {
    const out = outcome({ survivingTroops: 1_234 })
    const report = build({ outcome: out, ledger: ledgerFor(out) })
    expect(report.sections.shipLosses.attacker).toBe(225)
  })

  it('victory → the whole defender fleet is lost (defenderFleetSize)', () => {
    expect(build().sections.shipLosses.defender).toBe(DEFENDER_FLEET)
  })

  it('defeat → the whole attacker fleet is lost (attackerFleetSize)', () => {
    expect(defeatReport().sections.shipLosses.attacker).toBe(ATTACKER_FLEET)
  })

  it('defeat → the defender fleet survives intact (0)', () => {
    expect(defeatReport().sections.shipLosses.defender).toBe(0)
  })

  it('stalemate → the attacker fleet follows the same ratio and the defender fleet survives (150 / 0)', () => {
    const report = stalemateReport()
    expect(report.sections.shipLosses.attacker).toBe(150)
    expect(report.sections.shipLosses.defender).toBe(0)
  })

  it('ship losses stay within [0, fleetSize] across survivor extremes (zero-loss → 0, all-lost → fleet)', () => {
    for (const survivors of [0, 1_000, 3_500, 5_000]) {
      const out = outcome({ survivingTroops: survivors })
      const report = build({ outcome: out, ledger: ledgerFor(out) })
      const lost = report.sections.shipLosses.attacker
      expect(lost).toBeGreaterThanOrEqual(0)
      expect(lost).toBeLessThanOrEqual(ATTACKER_FLEET)
      expect(report.sections.shipLosses.defender).toBeLessThanOrEqual(DEFENDER_FLEET)
    }
  })

  it('zero fleets stay zero in every result', () => {
    for (const out of [outcome(), defeatOutcome(), stalemateOutcome()]) {
      const report = build({
        outcome: out,
        ledger: ledgerFor(out),
        attackerFleetSize: 0,
        defenderFleetSize: 0,
      })
      expect(report.sections.shipLosses.attacker, out.result).toBe(0)
      expect(report.sections.shipLosses.defender, out.result).toBe(0)
    }
  })
})

describe('buildCombatReport — identity & timestamps', () => {
  it('reportId = fnv1a(`${battleId}|${resolvedAt}`).toString(16) and is stable per battle', () => {
    const report = build()
    expect(report.reportId).toBe(fnv1a(`battle-1|${AT}`).toString(16))
    const later = build({ at: AT + 999_000_000 })
    expect(later.reportId).toBe(report.reportId)
  })

  it('the report carries the battle identity and the outcome resolvedAt', () => {
    const report = build()
    expect(report.battleId).toBe('battle-1')
    expect(report.attackerId).toBe('attacker-1')
    expect(report.defenderId).toBe('defender-1')
    expect(report.targetId).toBe('target-1')
    expect(report.resolvedAt).toBe(AT)
    expect(report.result).toBe('victory')
  })

  it('`at` at the boundary (at === resolvedAt) builds; `at` before resolution throws Error', () => {
    expect(() => build({ at: AT })).not.toThrow()
    expect(() => build({ at: AT - 1 })).toThrow(Error)
  })
})

describe('buildCombatReport — validation', () => {
  it('throws RangeError for negative, fractional or non-finite fleet sizes', () => {
    for (const bad of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => build({ attackerFleetSize: bad }),
        `attacker ${bad}`,
      ).toThrow(RangeError)
      expect(
        () => build({ defenderFleetSize: bad }),
        `defender ${bad}`,
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError for a malformed outcome (bad result, inconsistent victory flag, bad resolvedAt)', () => {
    expect(() => build({ outcome: outcome({ result: 'moon' as BattleOutcome['result'] }) })).toThrow(
      RangeError,
    )
    expect(() =>
      build({ outcome: outcome({ result: 'defeat', victory: true }) }),
    ).toThrow(RangeError)
    expect(() => build({ outcome: outcome({ resolvedAt: 0 }) })).toThrow(RangeError)
    expect(() => build({ outcome: outcome({ battleId: '  ' }) })).toThrow(RangeError)
  })

  it('throws RangeError when the ledger and the outcome disagree (different battle)', () => {
    const mismatched = ledgerFor(outcome({ battleId: 'battle-2' }))
    expect(() => build({ ledger: mismatched })).toThrow(RangeError)
  })

  it('throws RangeError when the ledger result disagrees with the outcome result', () => {
    const out = outcome()
    const mismatched = ledgerFor(
      outcome({ result: 'defeat', victory: false, survivingTroops: 0 }),
    )
    expect(() => build({ outcome: out, ledger: mismatched })).toThrow(RangeError)
  })

  it('throws RangeError for an empty or blank defenderId', () => {
    expect(() => build({ defenderId: '' })).toThrow(RangeError)
    expect(() => build({ defenderId: '   ' })).toThrow(RangeError)
  })
})

describe('buildCombatReport — determinism & immutability', () => {
  it('is deterministic across identical inputs and returns fresh nested objects', () => {
    const a = build()
    const b = build()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.sections).not.toBe(b.sections)
    expect(a.sections.shipLosses).not.toBe(b.sections.shipLosses)
  })

  it('never mutates the outcome or the ledger inputs', () => {
    const input = reportInput()
    const before = JSON.stringify(input)
    build(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('reportText — the deterministic one-line summary', () => {
  it('victory: the DESIGN worked example — 2,000 troops lost, 850 defenders fell, fleet losses 120/300', () => {
    const out = outcome({ survivingTroops: 3_000, defenderCasualties: 850 })
    const report = build({ outcome: out, ledger: ledgerFor(out) })
    expect(reportText(report)).toBe(
      'VICTORY — you took the planet: 2,000 troops lost, 850 defenders fell, fleet losses 120/300',
    )
  })

  it('defeat: "DEFEAT — defenders held: all 5,000 troops lost, fleet destroyed"', () => {
    expect(reportText(defeatReport())).toBe(
      'DEFEAT — defenders held: all 5,000 troops lost, fleet destroyed',
    )
  })

  it('stalemate: "STALEMATE — defenders hold"', () => {
    expect(reportText(stalemateReport())).toBe('STALEMATE — defenders hold')
  })

  it('formats large numbers with plain thousands separators (no region formatting)', () => {
    const out = outcome({ survivingTroops: 234_567, defenderCasualties: 12_345 })
    const report = build({
      outcome: out,
      ledger: ledgerFor(out, 1_000_000),
      attackerFleetSize: 1_000_000,
    })
    expect(reportText(report)).toBe(
      'VICTORY — you took the planet: 765,433 troops lost, 12,345 defenders fell, fleet losses 765,433/1,000,000',
    )
  })

  it('throws RangeError for a malformed report', () => {
    const report = build()
    const corrupted: CombatReport = {
      ...report,
      sections: { ...report.sections, winner: 'someone-else' },
    }
    expect(() => reportText(corrupted)).toThrow(RangeError)
  })
})

describe('reportInvariants — structural checks', () => {
  it('passes a fresh report for every result (victory / defeat / stalemate)', () => {
    for (const report of [build(), defeatReport(), stalemateReport()]) {
      const { ok, problems } = reportInvariants(report)
      expect(ok, report.result).toBe(true)
      expect(problems, report.result).toEqual([])
    }
  })

  it('flags inconsistent winner/loser mappings per result', () => {
    const cases: CombatReport[] = [
      { ...build(), sections: { ...build().sections, winner: 'someone-else' } },
      { ...build(), sections: { ...build().sections, loser: null } },
      { ...defeatReport(), sections: { ...defeatReport().sections, winner: 'attacker-1' } },
      { ...stalemateReport(), sections: { ...stalemateReport().sections, winner: 'attacker-1' } },
      { ...stalemateReport(), sections: { ...stalemateReport().sections, loser: 'defender-1' } },
    ]
    for (const report of cases) {
      const { ok, problems } = reportInvariants(report)
      expect(ok).toBe(false)
      expect(problems.length).toBeGreaterThan(0)
    }
  })

  it('flags a negative or fractional ship loss', () => {
    for (const bad of [-1, 0.5]) {
      const report = build()
      const corrupted: CombatReport = {
        ...report,
        sections: {
          ...report.sections,
          shipLosses: { attacker: bad, defender: 0 },
        },
      }
      const { ok } = reportInvariants(corrupted)
      expect(ok, String(bad)).toBe(false)
    }
  })

  it('flags a corrupted reportId (determinism check)', () => {
    const report = { ...build(), reportId: 'deadbeef' }
    const { ok, problems } = reportInvariants(report)
    expect(ok).toBe(false)
    expect(problems.some((p) => p.startsWith('reportId'))).toBe(true)
  })

  it('flags a missing summary on victory/defeat and a non-empty summary on stalemate', () => {
    const emptySummary = { ...build(), sections: { ...build().sections, summary: '' } }
    expect(reportInvariants(emptySummary).ok).toBe(false)
    const staleSummary = {
      ...stalemateReport(),
      sections: { ...stalemateReport().sections, summary: 'defenders hold' },
    }
    expect(reportInvariants(staleSummary).ok).toBe(false)
  })
})

describe('purity — deep-frozen tables', () => {
  it('COMBAT_REPORT_RESULTS is deep-frozen with the union (mutation throws TypeError)', () => {
    expect(Object.isFrozen(COMBAT_REPORT_RESULTS)).toBe(true)
    expect([...COMBAT_REPORT_RESULTS]).toEqual(['victory', 'defeat', 'stalemate'])
    expect(() => {
      ;(COMBAT_REPORT_RESULTS as unknown as string[]).push('moon')
    }).toThrow(TypeError)
  })

  it('COMBAT_REPORT_TEXT is deep-frozen (the word/headline records are frozen too)', () => {
    expect(Object.isFrozen(COMBAT_REPORT_TEXT)).toBe(true)
    expect(Object.isFrozen(COMBAT_REPORT_TEXT.victory)).toBe(true)
    expect(Object.isFrozen(COMBAT_REPORT_TEXT.defeat)).toBe(true)
    expect(Object.isFrozen(COMBAT_REPORT_TEXT.stalemate)).toBe(true)
    expect(COMBAT_REPORT_TEXT.victory.word).toBe('VICTORY')
    expect(COMBAT_REPORT_TEXT.victory.headline).toBe('you took the planet')
  })
})
