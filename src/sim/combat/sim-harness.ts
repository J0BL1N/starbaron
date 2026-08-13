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
 *   - launch        = launchAttack({ attackerId, fleetId, targetRef,
 *                     troopsCommitted: troops, fleetSize, distancePc,
 *                     launchAt: at − travel×1000, speedPcPerSec, wallet,
 *                     targetOwner }) (P7-T01 → the estimator's locked
 *                     `200 + fleet × 0.2 + distancePc × 10`; the T08
 *                     home-immunity guard runs inside against the scenario's
 *                     REAL target player — a protected home world throws the
 *                     guard Error, so a protected-home scenario fails here).
 *   - travelSeconds = travelDuration(distancePc, speedPcPerSec) — the
 *                     movement module's DURATION unit: SECONDS (arrivalAt =
 *                     departureAt + duration × 1000 in movement.ts /
 *                     attack-orders.ts). `at` stays an epoch-ms INPUT and is
 *                     the resolution moment: the fleet launches exactly one
 *                     travel leg before it (launchAt = at − travelSeconds ×
 *                     1000) and arrives at `at` — arrival and resolution
 *                     coincide, deterministically.
 *   - outcome       = resolveBattle({ attackerId, targetId: target.bodyId,
 *                     troops, shipyardTier, turretLevels, population,
 *                     resolvedAt: at, targetOwner }) (P7-T03 — powers,
 *                     result, survivors and defender casualties all from the
 *                     locked resolver; the T08 home-immunity guard runs
 *                     inside).
 *   - ledger        = applyCasualties({ outcome, committedTroops: troops,
 *                     defenderPopulationBefore: population,
 *                     defenderGarrisonBefore: garrison }) (P7-T05).
 *   - cost          = conquestCostFor({ targetId, tier: target.tier,
 *                     attackerConquests }) on VICTORY ONLY — a defeat or
 *                     stalemate pays no conquest cost (null) (P7-T06).
 *   - capture       = capturePlanet({ attackerId, defenderId:
 *                     target.ownerId, targetId, outcome, cost, casualties:
 *                     ledger, structureSurvival, capturedAt: at, universe,
 *                     targetOwnership, targetCurrent, previousHistory }) on
 *                     VICTORY ONLY — the REAL T07 handover (the scenario's
 *                     targetOwnership / targetCurrent / targetHistory are
 *                     REQUIRED inputs, delegated UNCHANGED to the locked
 *                     transfer — never fabricated by the harness). captured =
 *                     capture.outcome === 'captured'; a defeat or stalemate
 *                     never captures (capturePlanet is not reached).
 *   - report        = buildCombatReport({ outcome, ledger, defenderId:
 *                     target.ownerId, attackerFleetSize, defenderFleetSize,
 *                     at }) (P7-T09 — winner/loser from the locked report).
 *
 * SUMMARY — the deterministic one-liner in the capture/combat-report text
 * style: `VICTORY · 1,300 cr launch · 12h travel · 1,500 troops lost`. The
 * outcome word, the launch cost (plain thousands separator when whole, plain
 * String() when fractional), the travel duration (rounded seconds / minutes /
 * hours — no environment-sensitive formatting), and the attacker population
 * loss from the T05 ledger.
 *
 * The scenario target fixture (TARGET) is a canonical body id (world/identity
 * parseCanonicalId-valid, the capture-fixture convention); a non-canonical
 * target id is rejected up front in assertScenario (RangeError).
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
 * distancePc finite non-negative; speedPcPerSec finite > 0. The REAL target
 * records are REQUIRED and validated too: the targetPlayer shape (non-empty
 * playerId and a homePlanet with a non-empty name), the targetOwnership
 * binding (its bodyId/ownerId must match the target — the capture binding
 * check), the targetCurrent settlement envelope (finite non-negative
 * population, garrison and structure levels) and targetHistory an array. The
 * bounds mirror the locked helpers' own constraints (estimator.attackPower,
 * effects.defensePower, casualties.ts, conquest-cost.ts) — the MATH is never
 * re-derived, only the envelope is checked.
 */

import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'
import { attackLaunchCost, launchAttack } from './attack-orders'
import { resolveBattle } from './resolution'
import type { BattleOutcome } from './resolution'
import { applyCasualties } from './casualties'
import type { CasualtyLedger } from './casualties'
import { conquestCostFor } from './conquest-cost'
import type { ConquestCost } from './conquest-cost'
import { travelDuration } from '../fleet/movement'
import { capturePlanet } from './capture'
import type { CaptureSettlement } from './capture'
import { buildCombatReport } from './combat-reports'
import type { CombatReport } from './combat-reports'
import type { OwnershipEvent, OwnershipRecord } from '../player/ownership'
import { buildGalaxyRecord, registerSystem } from '../world/galaxy'
import { buildSystemRecord, registerBody } from '../world/system'
import { buildBodyRecord } from '../world/body'
import { galaxyId, parseCanonicalId, systemId } from '../world/identity'
import type { BodyId } from '../world/identity'
import type { UniverseState } from '../world/reconstruct'
import type { PlayerState, WalletState } from '../player/types'

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
  }
  target: {
    /** The canonical body id of the attacked world (parseCanonicalId-valid). */
    bodyId: string
    name: string
    tier: number
    ownerId: string
  }
  /**
   * The REAL target owner — read by the T08 home-immunity guard (launch and
   * resolution) and the source of the T07 ownership handover. Passed UNCHANGED
   * to the chain (never fabricated by the harness).
   */
  targetPlayer: PlayerState
  /**
   * The defender's STORED ownership record of the target — delegated UNCHANGED
   * to the T07 capture (the capture binding checks bodyId/ownerId match).
   */
  targetOwnership: OwnershipRecord
  /**
   * The REAL current settlement state of the target at conquest time — the T07
   * capture's targetCurrent (population, garrison and structure grid).
   */
  targetCurrent: CaptureSettlement
  /**
   * The REAL ownership history of the target at conquest time — the T07
   * capture's previousHistory audit trail.
   */
  targetHistory: OwnershipEvent[]
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
  /** The deterministic one-line summary (`VICTORY · 1,300 cr launch · …`). */
  summary: string
  /** The locked T09 combat report (winner/loser from report.sections). */
  report: CombatReport
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
  assertNonEmptyString(input.target.bodyId, 'target.bodyId')
  const parsedTarget = parseCanonicalId(input.target.bodyId)
  if (!parsedTarget.ok || parsedTarget.kind !== 'body') {
    throw new RangeError(
      `target.bodyId must be a valid body id, got ${JSON.stringify(input.target.bodyId)}`,
    )
  }
  assertNonEmptyString(input.target.name, 'target.name')
  assertIntegerAtLeast(input.target.tier, 1, 'target.tier')
  assertNonEmptyString(input.target.ownerId, 'target.ownerId')
  assertPlayerShape(input.targetPlayer)
  assertOwnershipBinding(input.targetOwnership, parsedTarget.id, input.target.ownerId)
  assertCurrentState(input.targetCurrent)
  assertHistoryArray(input.targetHistory)
  assertFiniteNonNegative(input.distancePc, 'distancePc')
  assertFinitePositive(input.speedPcPerSec, 'speedPcPerSec')
}

/**
 * The REAL target owner must be a usable PlayerState: a non-empty playerId
 * and a homePlanet carrying a non-empty name (the T08 guard reads
 * homePlanet.name to decide immunity). A protected-home scenario supplies a
 * player whose homePlanet.name IS the target — the guard then refuses the
 * battle, so this shape check never rejects a legitimate scenario.
 */
function assertPlayerShape(player: PlayerState): void {
  assertNonEmptyString(player.playerId, 'targetPlayer.playerId')
  if (
    typeof player.homePlanet !== 'object' ||
    player.homePlanet === null ||
    typeof player.homePlanet.name !== 'string' ||
    player.homePlanet.name.length === 0
  ) {
    throw new RangeError(
      'targetPlayer.homePlanet must carry a non-empty name',
    )
  }
}

/**
 * The capture binding check (mirrors capture.ts assertOwnershipMatches): the
 * stored record MUST name the capture target as its bodyId and the defender
 * as its ownerId — a mismatched record would forge the handover onto the
 * wrong body or name the wrong previous owner. Rejected up front, before the
 * chain runs.
 */
function assertOwnershipBinding(
  record: OwnershipRecord,
  bodyIdValue: BodyId,
  ownerId: string,
): void {
  if (record.bodyId !== bodyIdValue) {
    throw new RangeError(
      `targetOwnership.bodyId must be the capture target ${bodyIdValue}, got ${record.bodyId}`,
    )
  }
  if (record.ownerId !== ownerId) {
    throw new RangeError(
      `targetOwnership.ownerId must be the defender ${ownerId}, got ${record.ownerId}`,
    )
  }
}

/**
 * The REAL current settlement envelope (mirrors capture.ts assertTargetCurrent):
 * finite non-negative population, garrison and structure levels.
 */
function assertCurrentState(current: CaptureSettlement): void {
  if (!Number.isFinite(current.population) || current.population < 0) {
    throw new RangeError(
      `targetCurrent.population must be a finite non-negative number, got ${String(current.population)}`,
    )
  }
  if (!Number.isFinite(current.garrison) || current.garrison < 0) {
    throw new RangeError(
      `targetCurrent.garrison must be a finite non-negative number, got ${String(current.garrison)}`,
    )
  }
  for (const [structureId, level] of Object.entries(current.structures)) {
    if (!Number.isFinite(level) || level < 0) {
      throw new RangeError(
        `targetCurrent.structures.${structureId} must be a finite non-negative level, got ${String(level)}`,
      )
    }
  }
}

/** The caller-supplied audit trail must be an array (mirrors capture.ts). */
function assertHistoryArray(history: OwnershipEvent[]): void {
  if (!Array.isArray(history)) {
    throw new RangeError('targetHistory must be an array of OwnershipEvent')
  }
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
 * The pinned structure-survival fraction the harness hands to the T07
 * capture on a victory (a deterministic draft input — the backend supplies
 * the real defender settlement in the full flow).
 */
const SCENARIO_STRUCTURE_SURVIVAL = 0.5

/**
 * The minimal world anchoring the scenario target (the capture-fixture
 * shape): one galaxy, one system and the target body, fully registered so
 * queryBody resolves it — the T07 capture's universe anchor.
 */
function universeForTarget(bodyIdValue: string): UniverseState {
  const parsed = parseCanonicalId(bodyIdValue)
  if (!parsed.ok || parsed.kind !== 'body') {
    throw new RangeError(
      `target.bodyId must be a valid body id, got ${JSON.stringify(bodyIdValue)}`,
    )
  }
  const galaxy = galaxyId(parsed.galaxySlug)
  const system = systemId(parsed.galaxySlug, parsed.systemSeed)
  const body = buildBodyRecord({
    system,
    type: parsed.bodyType,
    ordinal: parsed.ordinal,
  })
  let galaxyRecord = buildGalaxyRecord({ slug: parsed.galaxySlug, seed: parsed.galaxySlug })
  galaxyRecord = registerSystem(galaxyRecord, system)
  const systemRecord = registerBody(
    buildSystemRecord({ galaxy, slug: parsed.systemSeed }),
    body.id,
  )
  return { galaxy: galaxyRecord, systems: [systemRecord], bodies: [body] }
}

/**
 * Runs one battle scenario through the LOCKED combat chain (all delegated,
 * never re-derived — see the module docblock): the T01 launch (with the T08
 * home-immunity guard), the travel seconds, the T03 resolution, the T05
 * casualty ledger, the T06 conquest cost (victory only), the T07 real
 * capture handover (victory only) and the T09 combat report. `captured` is
 * the T07 capture outcome. The summary is the deterministic one-liner. The
 * input is never mutated; a fresh result is returned.
 */
export function runScenario(input: BattleScenario): ScenarioResult {
  assertScenario(input)
  const attackerId = `attacker:${input.scenarioId}`
  const fleetId = `fleet:${input.scenarioId}`
  const targetId = input.target.bodyId
  const owner = input.targetPlayer
  const travelSeconds = travelDuration(input.distancePc, input.speedPcPerSec)
  const launchAt = input.at - travelSeconds * 1000
  const launchCost = attackLaunchCost(
    input.attacker.fleetSize,
    input.distancePc,
  ).credits
  const wallet: WalletState = { credits: launchCost, alloys: 0 }

  const launch = launchAttack({
    attackerId,
    fleetId,
    targetRef: { kind: 'planet', id: targetId },
    troopsCommitted: input.attacker.troops,
    fleetSize: input.attacker.fleetSize,
    distancePc: input.distancePc,
    launchAt,
    speedPcPerSec: input.speedPcPerSec,
    wallet,
    targetOwner: owner,
  })
  const outcome = resolveBattle({
    attackerId: launch.order.attackerId,
    targetId,
    troops: launch.order.troopsCommitted,
    shipyardTier: input.attacker.shipyardTier,
    turretLevels: input.defender.turretLevels,
    population: input.defender.population,
    resolvedAt: input.at,
    targetOwner: owner,
  })
  const ledger = applyCasualties({
    outcome,
    committedTroops: launch.order.troopsCommitted,
    defenderPopulationBefore: input.defender.population,
    defenderGarrisonBefore: input.defender.garrison,
  })
  let cost: ConquestCost | null = null
  let captured = false
  if (outcome.result === 'victory') {
    const victoryCost = conquestCostFor({
      targetId,
      tier: input.target.tier,
      attackerConquests: input.attacker.conquests,
    })
    cost = victoryCost
    const capture = capturePlanet({
      attackerId,
      defenderId: input.target.ownerId,
      targetId,
      outcome,
      cost: victoryCost,
      casualties: ledger,
      structureSurvival: SCENARIO_STRUCTURE_SURVIVAL,
      capturedAt: input.at,
      universe: universeForTarget(targetId),
      targetOwnership: input.targetOwnership,
      targetCurrent: input.targetCurrent,
      previousHistory: input.targetHistory,
    })
    captured = capture.outcome === 'captured'
  }

  const report = buildCombatReport({
    outcome,
    ledger,
    defenderId: input.target.ownerId,
    attackerFleetSize: input.attacker.fleetSize,
    defenderFleetSize: input.defender.fleetSize,
    at: input.at,
  })

  return {
    scenarioId: input.scenarioId,
    outcome,
    ledger,
    cost,
    captured,
    travelSeconds,
    launchCost,
    summary: buildReport(outcome, ledger, launchCost, travelSeconds),
    report,
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
    (scenario) => `${scenario.scenarioId} → ${runScenario(scenario).summary}`,
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
 * launchCost; the summary; the T09 report's reportId, battleId, attackerId,
 * defenderId, targetId, resolvedAt, result, sections.winner, sections.loser,
 * sections.shipLosses (attacker, defender) and sections.summary; then the
 * conquest cost (victory only): its presence ('cost'), then targetId, tier,
 * base (population, fleet, credits), escalation (multiplier, reason) and total
 * (population, fleet, credits).
 */
export function replayCheck(
  recorded: ScenarioResult,
  rerun: ScenarioResult,
): ReplayComparison {
  const outcomeA = recorded.outcome
  const outcomeB = rerun.outcome
  const ledgerA = recorded.ledger
  const ledgerB = rerun.ledger
  const reportA = recorded.report
  const reportB = rerun.report
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
    ['summary', recorded.summary, rerun.summary],
    ['report.reportId', reportA.reportId, reportB.reportId],
    ['report.battleId', reportA.battleId, reportB.battleId],
    ['report.attackerId', reportA.attackerId, reportB.attackerId],
    ['report.defenderId', reportA.defenderId, reportB.defenderId],
    ['report.targetId', reportA.targetId, reportB.targetId],
    ['report.resolvedAt', reportA.resolvedAt, reportB.resolvedAt],
    ['report.result', reportA.result, reportB.result],
    ['report.sections.winner', reportA.sections.winner, reportB.sections.winner],
    ['report.sections.loser', reportA.sections.loser, reportB.sections.loser],
    ['report.sections.shipLosses.attacker', reportA.sections.shipLosses.attacker, reportB.sections.shipLosses.attacker],
    ['report.sections.shipLosses.defender', reportA.sections.shipLosses.defender, reportB.sections.shipLosses.defender],
    ['report.sections.summary', reportA.sections.summary, reportB.sections.summary],
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
