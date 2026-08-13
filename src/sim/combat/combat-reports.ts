/**
 * COMBAT REPORTS (P7-T09) — the battle report: winner/loser, ship losses and
 * the full post-battle summary players see (attack + defense + casualties +
 * capture + cost + ship losses). This is a PURE REPORT PROJECTION over the
 * T03 resolution outcome, the T05 casualty ledger and the two build-time
 * fleet sizes — nothing here recomputes a battle, applies a cost or performs
 * a handover (cost application is T06's caller, capture is T07).
 *
 * PURE module — deterministic, no time-source reads (`resolvedAt` is an INPUT
 * on the outcome; `at` is a caller-supplied epoch-ms INPUT), no nondeterministic
 * APIs, no module-level mutable state (the text tables below are deep-frozen),
 * strictly typed.
 *
 * DESIGN decisions (documented — pinned):
 * - **Winner / loser:** victory → the ATTACKER wins, the DEFENDER loses;
 *   defeat → the DEFENDER wins, the ATTACKER loses; stalemate → no winner and
 *   no loser (winner '', loser null — the defenders hold).
 * - **Ship losses (PINNED model):** the attacker fleet loses `defeat` → the
 *   whole fleet (attackerFleetSize — a repelled force loses its escort fleet,
 *   mirroring the T05 ledger's fleetLost) else floor(attackerFleetSize ×
 *   (1 − survivingTroops / committedTroops)) — the SAME casualty ratio as the
 *   committed troops (a victory that costs 30% of the landing force costs 30%
 *   of the fleet). committedTroops = ledger.attacker.troopsCommitted (the T05
 *   ledger is the single source). The ratio is bounded [0,1] by the ledger
 *   invariants (survivors never exceed the committed force), so a floored
 *   attacker loss is never more than the fleet size — the [0, fleetSize] bound
 *   is ENFORCED AT BUILD TIME where the fleet sizes are inputs, then carried
 *   on the report as plain counts. The defender fleet loses `victory` → the
 *   whole fleet (defenderFleetSize — the planet falls, its ships are lost with
 *   it) else 0 (the defenders hold and their ships survive intact — documented
 *   choice, mirroring the T05 garrison-loss mapping).
 * - **reportId:** `fnv1a(`${battleId}|${resolvedAt}`).toString(16)` — built
 *   from the battle's OWN resolvedAt (the T03 outcome is the single source),
 *   so the id is stable per battle regardless of when the report is rendered.
 * - **resolvedAt:** the report carries the OUTCOME's resolvedAt (the battle
 *   resolution time). `at` is the report-build time: validated positive and
 *   never BEFORE resolution (`at < resolvedAt` throws Error — a report cannot
 *   exist before the battle resolves).
 * - **defenderId:** NOT present on the T03 outcome or the T05 ledger (the
 *   outcome names attacker + target only), so it is a REQUIRED build input —
 *   the caller supplies the target's owner at battle time (the T07 capture
 *   convention).
 * - **sections.summary:** the deterministic formatted CLAUSE (the text after
 *   the headline) computed at BUILD time from the full inputs — the fleet
 *   sizes are build-time inputs not carried on the report, so reportText
 *   composes the stored clause rather than re-deriving it. Victory: '2,000
 *   troops lost, 850 defenders fell, fleet losses 120/300'; defeat: 'all
 *   5,000 troops lost, fleet destroyed'; stalemate: '' (the whole line reads
 *   'STALEMATE — defenders hold').
 * - **Text:** reportText composes the pinned one-line summary per result
 *   (COMBAT_REPORT_TEXT holds the word + headline). Numbers use a plain
 *   thousands separator (no environment-sensitive formatting — deterministic
 *   everywhere).
 *
 * Validation (each throws RangeError unless noted): outcome shape (result in
 * the frozen union with a CONSISTENT victory flag, non-empty ids, resolvedAt
 * positive finite, survivingTroops / defenderCasualties non-negative
 * integers); the T05 ledger via its locked invariants; CROSS-SOURCE
 * consistency (the ledger and the outcome must describe the SAME battle:
 * attackerId / targetId / battleId / resolvedAt / result / survivors /
 * defender losses all agree); defenderId non-empty; attacker and defender
 * fleet sizes non-negative integers; `at` positive finite and not before
 * resolution (Error otherwise). reportText validates the report's invariants
 * first (RangeError otherwise).
 */

import { fnv1a } from '../planets/hash'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'
import type { BattleOutcome, BattleResult } from './resolution'
import type { CasualtyLedger } from './casualties'
import { casualtyLedgerInvariants } from './casualties'

/** The CombatReport result union — the T03 BattleResult, deep-frozen. */
export const COMBAT_REPORT_RESULTS: readonly BattleResult[] = Object.freeze([
  'victory',
  'defeat',
  'stalemate',
])

/** The pinned word + headline for one report result. */
export interface ReportResultText {
  readonly word: string
  readonly headline: string
}

/**
 * The pinned report text per result, DEEP-frozen (each inner record frozen
 * too): word is the leading token, headline the phrase after the em dash.
 */
export const COMBAT_REPORT_TEXT: Readonly<Record<BattleResult, ReportResultText>> =
  Object.freeze({
    victory: Object.freeze({ word: 'VICTORY', headline: 'you took the planet' }),
    defeat: Object.freeze({ word: 'DEFEAT', headline: 'defenders held' }),
    stalemate: Object.freeze({ word: 'STALEMATE', headline: 'defenders hold' }),
  })

export interface CombatReport {
  reportId: string
  battleId: string
  attackerId: string
  defenderId: string
  targetId: string
  resolvedAt: number
  result: BattleResult
  sections: {
    winner: string
    loser: string | null
    shipLosses: {
      attacker: number
      defender: number
    }
    summary: string
  }
}

export interface BuildCombatReportInput {
  outcome: BattleOutcome
  ledger: CasualtyLedger
  defenderId: string
  attackerFleetSize: number
  defenderFleetSize: number
  at: number
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${field} must be a non-negative integer, got ${String(value)}`,
    )
  }
}

function assertOutcome(outcome: BattleOutcome): void {
  assertNonEmptyString(outcome.battleId, 'outcome.battleId')
  assertNonEmptyString(outcome.attackerId, 'outcome.attackerId')
  assertNonEmptyString(outcome.targetId, 'outcome.targetId')
  assertPositiveAt(outcome.resolvedAt)
  if (!(COMBAT_REPORT_RESULTS as readonly string[]).includes(outcome.result)) {
    throw new RangeError(
      `outcome.result must be 'victory'|'defeat'|'stalemate', got ${String(outcome.result)}`,
    )
  }
  if (outcome.victory !== (outcome.result === 'victory')) {
    throw new RangeError(
      `outcome.victory (${String(outcome.victory)}) disagrees with outcome.result '${outcome.result}'`,
    )
  }
  assertNonNegativeInteger(outcome.survivingTroops, 'outcome.survivingTroops')
  assertNonNegativeInteger(
    outcome.defenderCasualties,
    'outcome.defenderCasualties',
  )
}

function assertLedger(ledger: CasualtyLedger): void {
  const { ok, problems } = casualtyLedgerInvariants(ledger)
  if (!ok) {
    throw new RangeError(`malformed casualty ledger: ${problems[0]}`)
  }
}

/**
 * The ledger and the outcome must describe the SAME battle — a mismatched
 * pair would project a report whose loser, casualties and ship losses belong
 * to different engagements. Every identity field, the result, the attacker
 * survivors and the defender losses must agree.
 */
function assertConsistent(outcome: BattleOutcome, ledger: CasualtyLedger): void {
  const pairs: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['attackerId', outcome.attackerId, ledger.attackerId],
    ['targetId', outcome.targetId, ledger.targetId],
    ['battleId', outcome.battleId, ledger.battleId],
    ['resolvedAt', outcome.resolvedAt, ledger.resolvedAt],
    ['result', outcome.result, ledger.result],
    ['survivors', outcome.survivingTroops, ledger.attacker.survivors],
    [
      'defender losses',
      outcome.defenderCasualties,
      ledger.defender.populationLoss,
    ],
  ]
  for (const [field, expected, actual] of pairs) {
    if (actual !== expected) {
      throw new RangeError(
        `ledger ${field} (${String(actual)}) disagrees with the outcome ` +
          `${field} (${String(expected)}) — the ledger and the outcome must ` +
          'describe the same battle',
      )
    }
  }
}

function winnerFor(
  result: BattleResult,
  attackerId: string,
  defenderId: string,
): string {
  if (result === 'victory') {
    return attackerId
  }
  if (result === 'defeat') {
    return defenderId
  }
  return ''
}

function loserFor(
  result: BattleResult,
  attackerId: string,
  defenderId: string,
): string | null {
  if (result === 'victory') {
    return defenderId
  }
  if (result === 'defeat') {
    return attackerId
  }
  return null
}

/**
 * The PINNED attacker ship loss: defeat → the whole fleet (the repelled force
 * loses its escort fleet); else floor(attackerFleetSize × (1 − survivors /
 * committedTroops)) — the same casualty ratio as the committed troops. The
 * ratio is bounded [0,1] by the ledger invariants (survivors ≤ committed), so
 * the floored loss is never more than the fleet size.
 */
function attackerShipLoss(
  result: BattleResult,
  survivors: number,
  committedTroops: number,
  attackerFleetSize: number,
): number {
  if (result === 'defeat') {
    return attackerFleetSize
  }
  const ratio = 1 - survivors / committedTroops
  return Math.floor(attackerFleetSize * ratio)
}

/**
 * The PINNED defender ship loss: victory → the whole fleet (the planet falls,
 * its ships are lost with it); defeat / stalemate → 0 (the defenders hold and
 * their ships survive intact — documented choice).
 */
function defenderShipLoss(result: BattleResult, defenderFleetSize: number): number {
  return result === 'victory' ? defenderFleetSize : 0
}

/**
 * The deterministic formatted summary CLAUSE (the text after the headline).
 * Victory: '2,000 troops lost, 850 defenders fell, fleet losses 120/300' —
 * the attacker population loss, the defender population loss and the attacker
 * fleet loss over its fleet size. Defeat: 'all 5,000 troops lost, fleet
 * destroyed'. Stalemate: '' (the whole line reads 'STALEMATE — defenders
 * hold').
 */
function summaryFor(
  result: BattleResult,
  ledger: CasualtyLedger,
  attackerShips: number,
  attackerFleetSize: number,
): string {
  if (result === 'victory') {
    return (
      `${formatInteger(ledger.attacker.populationLoss)} troops lost, ` +
      `${formatInteger(ledger.defender.populationLoss)} defenders fell, ` +
      `fleet losses ${formatInteger(attackerShips)}/${formatInteger(attackerFleetSize)}`
    )
  }
  if (result === 'defeat') {
    return `all ${formatInteger(ledger.attacker.troopsCommitted)} troops lost, fleet destroyed`
  }
  return ''
}

/**
 * Builds the combat report (P7-T09) — a PURE projection of the T03 outcome,
 * the T05 ledger and the build-time fleet sizes. Validation order (each throws
 * RangeError unless noted): outcome shape → ledger invariants → cross-source
 * consistency → defenderId non-empty → fleet sizes non-negative integers →
 * `at` positive finite → `at` not before resolution (Error otherwise). The
 * input is never mutated; a fresh report is returned.
 */
export function buildCombatReport(input: BuildCombatReportInput): CombatReport {
  assertOutcome(input.outcome)
  assertLedger(input.ledger)
  assertConsistent(input.outcome, input.ledger)
  const defenderId = assertNonEmptyString(input.defenderId, 'defenderId')
  assertNonNegativeInteger(input.attackerFleetSize, 'attackerFleetSize')
  assertNonNegativeInteger(input.defenderFleetSize, 'defenderFleetSize')
  assertPositiveAt(input.at)
  if (input.at < input.outcome.resolvedAt) {
    throw new Error(
      `cannot report battle ${input.outcome.battleId}: report time ` +
        `${input.at} is before resolution ${input.outcome.resolvedAt}`,
    )
  }

  const attackerShips = attackerShipLoss(
    input.outcome.result,
    input.outcome.survivingTroops,
    input.ledger.attacker.troopsCommitted,
    input.attackerFleetSize,
  )
  const defenderShips = defenderShipLoss(
    input.outcome.result,
    input.defenderFleetSize,
  )

  return {
    reportId: fnv1a(
      `${input.outcome.battleId}|${input.outcome.resolvedAt}`,
    ).toString(16),
    battleId: input.outcome.battleId,
    attackerId: input.outcome.attackerId,
    defenderId,
    targetId: input.outcome.targetId,
    resolvedAt: input.outcome.resolvedAt,
    result: input.outcome.result,
    sections: {
      winner: winnerFor(input.outcome.result, input.outcome.attackerId, defenderId),
      loser: loserFor(input.outcome.result, input.outcome.attackerId, defenderId),
      shipLosses: { attacker: attackerShips, defender: defenderShips },
      summary: summaryFor(input.outcome.result, input.ledger, attackerShips, input.attackerFleetSize),
    },
  }
}

/**
 * Structural invariants of a CombatReport: reportId the deterministic formula
 * fnv1a(`${battleId}|${resolvedAt}`).toString(16); battleId / attackerId /
 * defenderId / targetId non-empty; resolvedAt positive finite; result in the
 * frozen union; winner/loser consistent with the result (victory → attacker /
 * defender, defeat → defender / attacker, stalemate → '' / null); shipLosses
 * non-negative integers (the [0, fleetSize] bound is enforced at build time —
 * the fleet sizes are build-time inputs, not carried on the report); summary
 * a non-empty clause on victory/defeat and '' on stalemate.
 */
export function reportInvariants(report: CombatReport): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  if (report.sections === null || typeof report.sections !== 'object') {
    problems.push(
      'sections must be an object carrying winner, loser, shipLosses and summary',
    )
    return { ok: false, problems }
  }

  const expectedReportId = fnv1a(`${report.battleId}|${report.resolvedAt}`).toString(16)
  if (report.reportId !== expectedReportId) {
    problems.push(
      `reportId must equal fnv1a(battleId|resolvedAt) = ${expectedReportId}, got ${String(report.reportId)}`,
    )
  }

  for (const field of ['battleId', 'attackerId', 'defenderId', 'targetId'] as const) {
    if (typeof report[field] !== 'string' || report[field].trim().length === 0) {
      problems.push(`${field} must be a non-empty string, got ${String(report[field])}`)
    }
  }

  if (!Number.isFinite(report.resolvedAt) || report.resolvedAt <= 0) {
    problems.push(`resolvedAt must be a finite number > 0, got ${report.resolvedAt}`)
  }

  if (!(COMBAT_REPORT_RESULTS as readonly string[]).includes(report.result)) {
    problems.push(
      `result must be 'victory'|'defeat'|'stalemate', got ${String(report.result)}`,
    )
  }

  if (report.result === 'victory') {
    if (report.sections.winner !== report.attackerId) {
      problems.push(
        `a victory must name the attacker ${report.attackerId} as winner, got ${String(report.sections.winner)}`,
      )
    }
    if (report.sections.loser !== report.defenderId) {
      problems.push(
        `a victory must name the defender ${report.defenderId} as loser, got ${String(report.sections.loser)}`,
      )
    }
  } else if (report.result === 'defeat') {
    if (report.sections.winner !== report.defenderId) {
      problems.push(
        `a defeat must name the defender ${report.defenderId} as winner, got ${String(report.sections.winner)}`,
      )
    }
    if (report.sections.loser !== report.attackerId) {
      problems.push(
        `a defeat must name the attacker ${report.attackerId} as loser, got ${String(report.sections.loser)}`,
      )
    }
  } else {
    if (report.sections.winner !== '') {
      problems.push(
        `a stalemate must have no winner (''), got ${String(report.sections.winner)}`,
      )
    }
    if (report.sections.loser !== null) {
      problems.push(
        `a stalemate must have no loser (null), got ${String(report.sections.loser)}`,
      )
    }
  }

  const shipLosses = report.sections.shipLosses
  if (shipLosses === null || typeof shipLosses !== 'object') {
    problems.push('sections.shipLosses must carry attacker and defender counts')
  } else {
    if (!Number.isInteger(shipLosses.attacker) || shipLosses.attacker < 0) {
      problems.push(
        `shipLosses.attacker must be a non-negative integer, got ${shipLosses.attacker}`,
      )
    }
    if (!Number.isInteger(shipLosses.defender) || shipLosses.defender < 0) {
      problems.push(
        `shipLosses.defender must be a non-negative integer, got ${shipLosses.defender}`,
      )
    }
  }

  if (report.result === 'stalemate') {
    if (report.sections.summary !== '') {
      problems.push(
        `a stalemate report must carry an empty summary, got ${JSON.stringify(report.sections.summary)}`,
      )
    }
  } else if (
    typeof report.sections.summary !== 'string' ||
    report.sections.summary.length === 0
  ) {
    problems.push('a victory/defeat report must carry a non-empty summary clause')
  }

  return { ok: problems.length === 0, problems }
}

function formatInteger(value: number): string {
  const digits = String(value)
  let out = ''
  let count = 0
  for (let i = digits.length - 1; i >= 0; i--) {
    out = digits[i] + out
    count++
    if (count % 3 === 0 && i > 0) {
      out = ',' + out
    }
  }
  return out
}

/**
 * The deterministic one-line battle report, e.g. `VICTORY — you took the
 * planet: 2,000 troops lost, 850 defenders fell, fleet losses 120/300` or
 * `DEFEAT — defenders held: all 5,000 troops lost, fleet destroyed` or
 * `STALEMATE — defenders hold`. The word + headline come from the pinned
 * COMBAT_REPORT_TEXT and the clause is the report's stored summary. Numbers
 * use a plain thousands separator (no environment-sensitive formatting —
 * deterministic everywhere). The report must satisfy its invariants
 * (RangeError otherwise).
 */
export function reportText(report: CombatReport): string {
  const { ok, problems } = reportInvariants(report)
  if (!ok) {
    throw new RangeError(`cannot render a malformed combat report: ${problems[0]}`)
  }
  const text = COMBAT_REPORT_TEXT[report.result]
  if (report.result === 'stalemate') {
    return `${text.word} — ${text.headline}`
  }
  return `${text.word} — ${text.headline}: ${report.sections.summary}`
}
