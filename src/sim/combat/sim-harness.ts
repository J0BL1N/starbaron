/**
 * COMBAT SIMULATION HARNESS (P7-T10) — scenario generation + deterministic
 * replay: run scripted battle scenarios through the LOCKED combat chain
 * (attack → resolve → casualties → capture) and replay them
 * deterministically. The combat twin of the P3-T10 balance harness
 * (src/sim/balance/harness.ts), mirroring its conventions: deterministic
 * simulation, report rows, exported check helpers.
 *
 * PURE module — no nondeterministic APIs, no module-level mutable state, no
 * time-source reads (`at` is an INPUT; timestamps are never read from the
 * host). Strictly typed.
 *
 * THE CHAIN IS DELEGATED — never re-derived (the locked modules are the
 * single source of every number):
 *   - launchCost    = attackLaunchCost(fleetSize, distancePc).credits
 *                     (P7-T01 → the estimator's locked `200 + fleet × 0.2 +
 *                     distancePc × 10`).
 *   - travelSeconds = travelDuration(distancePc, speedPcPerSec) — the
 *                     movement module's DURATION unit: SECONDS (arrivalAt =
 *                     departureAt + duration × 1000 in movement.ts /
 *                     attack-orders.ts). `at` stays an epoch-ms INPUT, the
 *                     same convention as launchAt / resolvedAt; the harness
 *                     does NOT multiply by 1000 — the movement module owns
 *                     the seconds-to-ms conversion.
 *   - outcome       = resolveBattle({ troops, shipyardTier, turretLevels,
 *                     population, resolvedAt: at }) (P7-T03 — powers, result,
 *                     survivors and defender casualties all from the locked
 *                     resolver; the attackerId/targetId are derived
 *                     deterministically from the scenarioId).
 *   - ledger        = applyCasualties({ outcome, committedTroops: troops,
 *                     defenderPopulationBefore: population,
 *                     defenderGarrisonBefore: garrison }) (P7-T05).
 *   - cost          = conquestCostFor({ targetId, tier, attackerConquests })
 *                     on VICTORY ONLY — a defeat or stalemate pays no
 *                     conquest cost (null) (P7-T06).
 *   - captured      = outcome.result === 'victory' — the T03 classification
 *                     drives the handover; the ownership transfer itself is
 *                     P7-T07's contract and is NOT applied here.
 *
 * REPORT — the deterministic one-liner in the capture/combat-report text
 * style: `VICTORY · 1,300 cr launch · 12h travel · 1,500 troops lost`. The
 * outcome word, the launch cost (plain thousands separator when whole, plain
 * String() when fractional), the travel duration (rounded seconds / minutes /
 * hours — no environment-sensitive formatting), and the attacker population
 * loss from the T05 ledger.
 *
 * scenarioTable emits one row per scenario, sorted by scenarioId with a
 * plain byte-wise comparison (no environment-sensitive collation).
 * replayCheck compares two runs leaf-by-leaf — every leaf of ScenarioResult
 * in a fixed documented order — and names the first diverging path; the
 * deterministic replay gate.
 *
 * VALIDATION — the full input envelope is validated up front (each throws
 * RangeError) so a malformed scenario fails with a descriptive error before
 * the chain runs: scenarioId / name non-empty (validate.ts); `at` positive
 * finite (assertPositiveAt); troops positive finite; shipyardTier an integer
 * in 0..100; fleetSize (both sides), garrison, turretLevels and conquests
 * non-negative integers; defender tier an integer >= 1; population and
 * distancePc finite non-negative; speedPcPerSec finite > 0. The bounds mirror
 * the locked helpers' own constraints (estimator.attackPower,
 * effects.defensePower, casualties.ts, conquest-cost.ts) — the MATH is never
 * re-derived, only the envelope is checked.
 */

import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'
import { attackLaunchCost } from './attack-orders'
import { resolveBattle } from './resolution'
import type { BattleOutcome } from './resolution'
import { applyCasualties } from './casualties'
import type { CasualtyLedger } from './casualties'
import { conquestCostFor } from './conquest-cost'
import type { ConquestCost } from './conquest-cost'
import { travelDuration } from '../fleet/movement'

/** The full input envelope of one scripted battle scenario. */
export interface BattleScenario {
  scenarioId: string
  name: string
  attacker: {
    troops: number
    shipyardTier: number
    fleetSize: number
    conquests: number
  }
  defender: {
    turretLevels: number
    population: number
    garrison: number
    fleetSize: number
    tier: number
  }
  distancePc: number
  speedPcPerSec: number
  at: number
}

/** The deterministic result of running one battle scenario through the chain. */
export interface ScenarioResult {
  scenarioId: string
  outcome: BattleOutcome
  ledger: CasualtyLedger
  cost: ConquestCost | null
  captured: boolean
  travelSeconds: number
  launchCost: number
  report: string
}

/** The field-by-field comparison of two scenario runs (the replay gate). */
export interface ReplayComparison {
  identical: boolean
  firstDifference: string | null
}

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a finite number > 0, got ${value}`)
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} must be a finite non-negative number, got ${value}`,
    )
  }
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${field} must be an integer in [${minimum}, ${maximum}], got ${value}`,
    )
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${field} must be a non-negative integer, got ${value}`,
    )
  }
}

function assertIntegerAtLeast(
  value: number,
  minimum: number,
  field: string,
): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${field} must be an integer >= ${minimum}, got ${value}`)
  }
}

function assertScenario(input: BattleScenario): void {
  assertNonEmptyString(input.scenarioId, 'scenarioId')
  assertNonEmptyString(input.name, 'name')
  assertPositiveAt(input.at)
  assertFinitePositive(input.attacker.troops, 'attacker.troops')
  assertIntegerInRange(input.attacker.shipyardTier, 0, 100, 'attacker.shipyardTier')
  assertNonNegativeInteger(input.attacker.fleetSize, 'attacker.fleetSize')
  assertIntegerAtLeast(input.attacker.conquests, 0, 'attacker.conquests')
  assertNonNegativeInteger(input.defender.turretLevels, 'defender.turretLevels')
  assertFiniteNonNegative(input.defender.population, 'defender.population')
  assertNonNegativeInteger(input.defender.garrison, 'defender.garrison')
  assertNonNegativeInteger(input.defender.fleetSize, 'defender.fleetSize')
  assertIntegerAtLeast(input.defender.tier, 1, 'defender.tier')
  assertFiniteNonNegative(input.distancePc, 'distancePc')
  assertFinitePositive(input.speedPcPerSec, 'speedPcPerSec')
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

function formatCredits(value: number): string {
  return Number.isInteger(value) ? formatInteger(value) : String(value)
}

function formatTravel(travelSeconds: number): string {
  if (travelSeconds < 60) {
    return `${Math.round(travelSeconds)}s`
  }
  if (travelSeconds < 3600) {
    return `${Math.round(travelSeconds / 60)}m`
  }
  return `${Math.round(travelSeconds / 3600)}h`
}

function buildReport(
  outcome: BattleOutcome,
  ledger: CasualtyLedger,
  launchCost: number,
  travelSeconds: number,
): string {
  const word =
    outcome.result === 'victory'
      ? 'VICTORY'
      : outcome.result === 'defeat'
        ? 'DEFEAT'
        : 'STALEMATE'
  return (
    `${word} · ${formatCredits(launchCost)} cr launch · ` +
    `${formatTravel(travelSeconds)} travel · ` +
    `${formatInteger(ledger.attacker.populationLoss)} troops lost`
  )
}

/**
 * Runs one battle scenario through the LOCKED combat chain (all delegated,
 * never re-derived — see the module docblock): the launch cost, the travel
 * seconds (the movement module's duration unit), the T03 resolution, the T05
 * casualty ledger, the T06 conquest cost (victory only) and the captured
 * flag. The report is the deterministic one-liner. The input is never
 * mutated; a fresh result is returned.
 */
export function runScenario(input: BattleScenario): ScenarioResult {
  assertScenario(input)
  const attackerId = `attacker:${input.scenarioId}`
  const targetId = `target:${input.scenarioId}`
  const launchCost = attackLaunchCost(
    input.attacker.fleetSize,
    input.distancePc,
  ).credits
  const travelSeconds = travelDuration(input.distancePc, input.speedPcPerSec)
  const outcome = resolveBattle({
    attackerId,
    targetId,
    troops: input.attacker.troops,
    shipyardTier: input.attacker.shipyardTier,
    turretLevels: input.defender.turretLevels,
    population: input.defender.population,
    resolvedAt: input.at,
  })
  const ledger = applyCasualties({
    outcome,
    committedTroops: input.attacker.troops,
    defenderPopulationBefore: input.defender.population,
    defenderGarrisonBefore: input.defender.garrison,
  })
  const cost =
    outcome.result === 'victory'
      ? conquestCostFor({
          targetId,
          tier: input.defender.tier,
          attackerConquests: input.attacker.conquests,
        })
      : null
  const captured = outcome.result === 'victory'
  return {
    scenarioId: input.scenarioId,
    outcome,
    ledger,
    cost,
    captured,
    travelSeconds,
    launchCost,
    report: buildReport(outcome, ledger, launchCost, travelSeconds),
  }
}

function compareScenarioIds(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}

/**
 * The deterministic scenario table: one row per scenario (each the
 * `${scenarioId} → <report>` one-liner), sorted by scenarioId with a plain
 * byte-wise comparison (no environment-sensitive collation). The input array
 * is never mutated.
 */
export function scenarioTable(scenarios: readonly BattleScenario[]): string[] {
  const sorted = [...scenarios].sort((a, b) =>
    compareScenarioIds(a.scenarioId, b.scenarioId),
  )
  return sorted.map(
    (scenario) => `${scenario.scenarioId} → ${runScenario(scenario).report}`,
  )
}

/**
 * DETERMINISTIC REPLAY: compares two scenario runs leaf-by-leaf — every leaf
 * of ScenarioResult, in a FIXED DOCUMENTED ORDER. firstDifference is the first
 * diverging field path ('outcome.battleId' style); identical is true only when
 * every leaf agrees. Neither input is mutated.
 *
 * The comparison order is fixed top-to-bottom: scenarioId; the outcome's
 * battleId, attackerId, targetId, resolvedAt, attackPower, defensePower,
 * victory, survivingTroops, defenderCasualties and result; the ledger's
 * attackerId, targetId, battleId, resolvedAt, attacker totals
 * (troopsCommitted, survivors, populationLoss, fleetLost), defender losses
 * (populationLoss, garrisonLoss) and result; the captured flag; travelSeconds;
 * launchCost; the report; then the conquest cost (victory only): its presence
 * ('cost'), then targetId, tier, base (population, fleet, credits), escalation
 * (multiplier, reason) and total (population, fleet, credits).
 */
export function replayCheck(
  recorded: ScenarioResult,
  rerun: ScenarioResult,
): ReplayComparison {
  const outcomeA = recorded.outcome
  const outcomeB = rerun.outcome
  const ledgerA = recorded.ledger
  const ledgerB = rerun.ledger
  const scalarFields: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['scenarioId', recorded.scenarioId, rerun.scenarioId],
    ['outcome.battleId', outcomeA.battleId, outcomeB.battleId],
    ['outcome.attackerId', outcomeA.attackerId, outcomeB.attackerId],
    ['outcome.targetId', outcomeA.targetId, outcomeB.targetId],
    ['outcome.resolvedAt', outcomeA.resolvedAt, outcomeB.resolvedAt],
    ['outcome.attackPower', outcomeA.attackPower, outcomeB.attackPower],
    ['outcome.defensePower', outcomeA.defensePower, outcomeB.defensePower],
    ['outcome.victory', outcomeA.victory, outcomeB.victory],
    ['outcome.survivingTroops', outcomeA.survivingTroops, outcomeB.survivingTroops],
    ['outcome.defenderCasualties', outcomeA.defenderCasualties, outcomeB.defenderCasualties],
    ['outcome.result', outcomeA.result, outcomeB.result],
    ['ledger.attackerId', ledgerA.attackerId, ledgerB.attackerId],
    ['ledger.targetId', ledgerA.targetId, ledgerB.targetId],
    ['ledger.battleId', ledgerA.battleId, ledgerB.battleId],
    ['ledger.resolvedAt', ledgerA.resolvedAt, ledgerB.resolvedAt],
    ['ledger.attacker.troopsCommitted', ledgerA.attacker.troopsCommitted, ledgerB.attacker.troopsCommitted],
    ['ledger.attacker.survivors', ledgerA.attacker.survivors, ledgerB.attacker.survivors],
    ['ledger.attacker.populationLoss', ledgerA.attacker.populationLoss, ledgerB.attacker.populationLoss],
    ['ledger.attacker.fleetLost', ledgerA.attacker.fleetLost, ledgerB.attacker.fleetLost],
    ['ledger.defender.populationLoss', ledgerA.defender.populationLoss, ledgerB.defender.populationLoss],
    ['ledger.defender.garrisonLoss', ledgerA.defender.garrisonLoss, ledgerB.defender.garrisonLoss],
    ['ledger.result', ledgerA.result, ledgerB.result],
    ['captured', recorded.captured, rerun.captured],
    ['travelSeconds', recorded.travelSeconds, rerun.travelSeconds],
    ['launchCost', recorded.launchCost, rerun.launchCost],
    ['report', recorded.report, rerun.report],
  ]
  for (const [path, a, b] of scalarFields) {
    if (a !== b) {
      return { identical: false, firstDifference: path }
    }
  }

  const costA = recorded.cost
  const costB = rerun.cost
  if ((costA === null) !== (costB === null)) {
    return { identical: false, firstDifference: 'cost' }
  }
  if (costA !== null && costB !== null) {
    const costLeaves: ReadonlyArray<readonly [string, unknown, unknown]> = [
      ['cost.targetId', costA.targetId, costB.targetId],
      ['cost.tier', costA.tier, costB.tier],
      ['cost.base.population', costA.base.population, costB.base.population],
      ['cost.base.fleet', costA.base.fleet, costB.base.fleet],
      ['cost.base.credits', costA.base.credits, costB.base.credits],
      ['cost.escalation.multiplier', costA.escalation.multiplier, costB.escalation.multiplier],
      ['cost.escalation.reason', costA.escalation.reason, costB.escalation.reason],
      ['cost.total.population', costA.total.population, costB.total.population],
      ['cost.total.fleet', costA.total.fleet, costB.total.fleet],
      ['cost.total.credits', costA.total.credits, costB.total.credits],
    ]
    for (const [path, a, b] of costLeaves) {
      if (a !== b) {
        return { identical: false, firstDifference: path }
      }
    }
  }

  return { identical: true, firstDifference: null }
}
