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
 * replayCheck compares two runs field-by-field and names the first diverging
 * path — the deterministic replay gate.
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
 * DETERMINISTIC REPLAY: compares two scenario runs field-by-field — the
 * outcome powers and survivors, the ledger losses on both sides, the conquest
 * cost totals (and its presence), the captured flag, the report, the travel
 * seconds and the launch cost. firstDifference is the first diverging field
 * path ('outcome.attackPower' style); identical is true only when every field
 * agrees. Neither input is mutated.
 */
export function replayCheck(
  recorded: ScenarioResult,
  rerun: ScenarioResult,
): ReplayComparison {
  const scalarFields: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['scenarioId', recorded.scenarioId, rerun.scenarioId],
    ['outcome.attackPower', recorded.outcome.attackPower, rerun.outcome.attackPower],
    ['outcome.defensePower', recorded.outcome.defensePower, rerun.outcome.defensePower],
    ['outcome.survivingTroops', recorded.outcome.survivingTroops, rerun.outcome.survivingTroops],
    ['outcome.defenderCasualties', recorded.outcome.defenderCasualties, rerun.outcome.defenderCasualties],
    ['outcome.result', recorded.outcome.result, rerun.outcome.result],
    ['ledger.attacker.troopsCommitted', recorded.ledger.attacker.troopsCommitted, rerun.ledger.attacker.troopsCommitted],
    ['ledger.attacker.populationLoss', recorded.ledger.attacker.populationLoss, rerun.ledger.attacker.populationLoss],
    ['ledger.attacker.survivors', recorded.ledger.attacker.survivors, rerun.ledger.attacker.survivors],
    ['ledger.attacker.fleetLost', recorded.ledger.attacker.fleetLost, rerun.ledger.attacker.fleetLost],
    ['ledger.defender.populationLoss', recorded.ledger.defender.populationLoss, rerun.ledger.defender.populationLoss],
    ['ledger.defender.garrisonLoss', recorded.ledger.defender.garrisonLoss, rerun.ledger.defender.garrisonLoss],
    ['captured', recorded.captured, rerun.captured],
    ['report', recorded.report, rerun.report],
    ['travelSeconds', recorded.travelSeconds, rerun.travelSeconds],
    ['launchCost', recorded.launchCost, rerun.launchCost],
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
    if (costA.total.population !== costB.total.population) {
      return { identical: false, firstDifference: 'cost.total.population' }
    }
    if (costA.total.fleet !== costB.total.fleet) {
      return { identical: false, firstDifference: 'cost.total.fleet' }
    }
    if (costA.total.credits !== costB.total.credits) {
      return { identical: false, firstDifference: 'cost.total.credits' }
    }
  }

  return { identical: true, firstDifference: null }
}
