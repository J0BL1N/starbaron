/**
 * PLANET CAPTURE (P7-T07) — the conquest handover: when a battle is won the
 * world CHANGES HANDS — ownership transfers to the attacker and the structure
 * grid suffers the P2-T07 consequences (turrets ALWAYS destroyed — DESIGN §5;
 * every other structure survives by the survival fraction). This module is
 * the APPLICATION of the T03 resolution, the T05 casualty ledger and the T06
 * conquest cost onto OWNERSHIP — the actual handover is DELEGATED to the
 * locked transfer (src/sim/player/transfer.ts) and NEVER re-implemented.
 *
 * Pure module: every function is a pure function of its arguments — no
 * nondeterministic APIs, no module-level mutable state (the only module-level
 * table is deep-frozen), no time-source reads (`capturedAt` is a
 * caller-supplied epoch-ms INPUT). Identical inputs always produce identical
 * (deep-equal) results. Strictly typed.
 *
 * OUTCOME SEMANTICS: the resolution (T03) classifies the battle; a victory
 * hands the world over (`outcome 'captured'`), a defeat or stalemate repels
 * the attackers (`outcome 'repelled'`). The conquest cost (T06) and the
 * casualty ledger (T05) are recorded in BOTH branches — the price was paid
 * whether the world fell or held. Only a victory carries a transfer.
 *
 * DELEGATION: on a victory, `capturePlanet` builds the P2-T07
 * conquestTransfer input from the capture inputs and the world state, then
 * hands the transfer to the locked function. The `record` is the
 * caller-supplied `targetOwnership` — the DEFENDER'S STORED ownership record
 * of the target — received UNCHANGED and delegated UNCHANGED (never
 * fabricated here), so a protected home world (isHome && unconquerable)
 * reaches the locked refusal path exactly as stored. The previous history is
 * empty: the caller persists the audit trail, mirroring the P2 convention
 * ("the pure model reports; the caller persists").
 *
 * SURVIVAL — THE APPLICATION OF T05 ONTO OWNERSHIP: the transfer's
 * structureSurvival is the capture input applied to the structure grid (the
 * one survival fraction this task exposes). The population and garrison
 * survival fractions are DERIVED from the T05 casualty ledger via
 * `survivalFor`: the new owner inherits what the battle did not consume —
 * survivors = settlement − defender losses — clamped into [0,1] so a loss
 * that exceeds the draft settlement simply wipes the survivors. The ledger,
 * never a re-derived formula, is the single source of those losses.
 *
 * SETTLEMENT DRAFT: the transfer machinery needs the world's current
 * population, garrison and structure grid. Those are CALLER-SIDE player
 * state, not world state — the backend supplies the real defender state in
 * the full flow. Until then this module derives a deterministic DRAFT
 * settlement from the target body id (`settlementFor`, a pinned seeded
 * convention, exported so callers and tests reproduce it exactly). The
 * derivation guarantees at least one housing level and one defense-turret
 * level, so the P2 turret-destruction contract is always observable.
 *
 * THE UNIVERSE: `universe` anchors the capture — the target id must parse as
 * a body and resolve to a real body in the given world (queryBody, P1-T08);
 * a target outside the world is rejected up front. The same validation runs
 * on a repelled branch, so every capture is anchored the same way.
 *
 * VALIDATION (each throws RangeError): attackerId / defenderId / targetId
 * non-empty; capturedAt positive finite (assertPositiveAt); outcome.result a
 * terminal battle result with a consistent victory flag; structureSurvival a
 * finite fraction in [0,1]; the casualty ledger satisfies its locked
 * invariants; the cost is well-formed (tier integer >= 1, finite
 * non-negative totals). A victory whose handover the locked transfer REJECTS
 * (protected or self-transfer) is an impossible capture — capturePlanet
 * throws Error (the home-world guard is P7-T08, which refuses such battles
 * before this module is reached).
 */

import { fnv1a } from '../planets/hash'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'
import { queryBody } from '../world/api'
import { parseCanonicalId } from '../world/identity'
import type { BodyId } from '../world/identity'
import type { UniverseState } from '../world/reconstruct'
import { STRUCTURE_IDS } from '../structures/data'
import { conquestTransfer } from '../player/transfer'
import type { OwnershipEvent, OwnershipRecord } from '../player/ownership'
import { BATTLE_RESULTS } from './resolution'
import type { BattleOutcome } from './resolution'
import { casualtyLedgerInvariants } from './casualties'
import type { CasualtyLedger } from './casualties'
import type { ConquestCost } from './conquest-cost'
import type { StructureGrid } from '../player/types'

export type CaptureOutcome = 'captured' | 'repelled'

/** The CaptureOutcome union as a deep-frozen lookup table (runtime-immutable). */
export const CAPTURE_OUTCOMES: readonly CaptureOutcome[] = Object.freeze([
  'captured',
  'repelled',
])

/**
 * BATTLE_DURATION_HOURS = 4 — the pinned battle window the summary renders
 * ('Captured in 4h battle'). Draft display knob: the async battle timer is
 * the resolver/backend's concern (DESIGN §5a travel is not a fixed length);
 * this constant is the capture summary's deterministic duration label.
 */
export const BATTLE_DURATION_HOURS = 4

/** The world's current settlement state as handed to the locked transfer. */
export interface CaptureSettlement {
  population: number
  garrison: number
  structures: StructureGrid
}

/**
 * The full capture record. `transfer` is the locked handover's OwnershipEvent
 * (the brief's "TransferEvent" — the event the P2-T07 conquestTransfer
 * produced); `survivingStructures` carries the delegate's survivor grid
 * separately, so the result contract's `transfer` stays the event while the
 * structure consequence (turrets destroyed, DESIGN §5) stays observable.
 * cost and casualties are present in both outcomes: the price was paid
 * whether the world fell or held.
 */
export interface CaptureResult {
  captureId: string
  attackerId: string
  defenderId: string
  targetId: string
  capturedAt: number
  outcome: CaptureOutcome
  transfer: OwnershipEvent | null
  survivingStructures: StructureGrid | null
  cost: ConquestCost | null
  casualties: CasualtyLedger | null
}

export interface CaptureInput {
  attackerId: string
  defenderId: string
  targetId: string
  outcome: BattleOutcome
  cost: ConquestCost
  casualties: CasualtyLedger
  structureSurvival: number
  capturedAt: number
  universe: UniverseState
  /**
   * The DEFENDER'S STORED ownership record of the target — delegated UNCHANGED
   * to the locked conquestTransfer (never fabricated here), so a protected
   * home world (isHome && unconquerable) reaches the locked refusal path
   * exactly as stored.
   */
  targetOwnership: OwnershipRecord
}

const SETTLEMENT_VERSION = 'capture-settlement-v1'
const STRUCTURE_LEVEL_BOUND = 6
const POPULATION_BASE = 1000
const POPULATION_VARIANCE = 9000
const GARRISON_BOUND = 5000

function assertStructureSurvival(value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      `structureSurvival must be a finite fraction in [0,1], got ${String(value)}`,
    )
  }
}

function assertOutcome(outcome: BattleOutcome): void {
  if (!(BATTLE_RESULTS as readonly string[]).includes(outcome.result)) {
    throw new RangeError(
      `outcome.result must be a terminal battle result 'victory'|'defeat'|'stalemate', got ${String(outcome.result)}`,
    )
  }
  if (outcome.victory !== (outcome.result === 'victory')) {
    throw new RangeError(
      `outcome.victory (${String(outcome.victory)}) disagrees with outcome.result '${outcome.result}'`,
    )
  }
}

function assertLedger(ledger: CasualtyLedger): void {
  const { ok, problems } = casualtyLedgerInvariants(ledger)
  if (!ok) {
    throw new RangeError(`malformed casualty ledger: ${problems[0]}`)
  }
}

function assertCost(cost: ConquestCost): void {
  assertNonEmptyString(cost.targetId, 'cost.targetId')
  if (!Number.isInteger(cost.tier) || cost.tier < 1) {
    throw new RangeError(`cost.tier must be an integer >= 1, got ${cost.tier}`)
  }
  if (!Number.isFinite(cost.escalation.multiplier)) {
    throw new RangeError(
      `cost.escalation.multiplier must be finite, got ${cost.escalation.multiplier}`,
    )
  }
  for (const key of ['population', 'fleet', 'credits'] as const) {
    const value = cost.total[key]
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(
        `cost.total.${key} must be a non-negative integer, got ${value}`,
      )
    }
  }
}

function resolveTargetBody(universe: UniverseState, targetId: string): BodyId {
  const parsed = parseCanonicalId(targetId)
  if (!parsed.ok || parsed.kind !== 'body') {
    throw new RangeError(
      `targetId must be a valid body id, got ${JSON.stringify(targetId)}`,
    )
  }
  if (queryBody(universe, parsed.id) === null) {
    throw new RangeError(
      `target body ${targetId} is not present in the given universe`,
    )
  }
  return parsed.id
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * The deterministic DRAFT settlement of a target body (P7-T07): population,
 * garrison and a full structure grid derived from the body id via fnv1a.
 * DRAFT — the backend supplies the real defender state in the full flow; this
 * convention keeps the capture pure and world-anchored until then. The
 * derivation guarantees housing >= 1 and defenseTurret >= 1 (so the P2
 * turret-destruction contract is always observable), every other structure is
 * 0..5, population is 1,000..9,999 and garrison 0..4,999. A fresh object is
 * returned on every call; nothing is shared. bodyId must be non-empty
 * (RangeError otherwise).
 */
export function settlementFor(bodyId: string): CaptureSettlement {
  assertNonEmptyString(bodyId, 'bodyId')
  const structures = {} as StructureGrid
  for (const structureId of STRUCTURE_IDS) {
    structures[structureId] =
      fnv1a(`${SETTLEMENT_VERSION}|${bodyId}|${structureId}`) % STRUCTURE_LEVEL_BOUND
  }
  structures.housing += 1
  structures.defenseTurret += 1
  const population =
    POPULATION_BASE +
    (fnv1a(`${SETTLEMENT_VERSION}|${bodyId}|population`) % POPULATION_VARIANCE)
  const garrison =
    fnv1a(`${SETTLEMENT_VERSION}|${bodyId}|garrison`) % GARRISON_BOUND
  return { population, garrison, structures }
}

/**
 * The population and garrison survival fractions of a conquest — THE
 * APPLICATION of the T05 casualty ledger onto the transfer machinery: the new
 * owner inherits what the battle did not consume. populationSurvival =
 * clamp01(1 − defender.populationLoss / settlement.population) and
 * garrisonSurvival likewise from defender.garrisonLoss — clamped into [0,1]
 * so a loss that exceeds the draft settlement wipes the survivors. A zero
 * settlement side survives untouched. The ledger, never a re-derived formula,
 * is the single source of the losses.
 */
export function survivalFor(
  settlement: CaptureSettlement,
  casualties: CasualtyLedger,
): { populationSurvival: number; garrisonSurvival: number } {
  assertLedger(casualties)
  const populationSurvival =
    settlement.population === 0
      ? 1
      : clampFraction(
          1 - casualties.defender.populationLoss / settlement.population,
        )
  const garrisonSurvival =
    settlement.garrison === 0
      ? 1
      : clampFraction(1 - casualties.defender.garrisonLoss / settlement.garrison)
  return { populationSurvival, garrisonSurvival }
}

/**
 * Capture a planet from a resolved battle (P7-T07). victory → the handover is
 * DELEGATED to the locked `conquestTransfer` (the attacker becomes the new
 * owner, the caller-supplied `targetOwnership` is delegated UNCHANGED, the
 * capture's structureSurvival and the T05-derived population/garrison
 * survival are applied, the world anchors on the universe's target body) and
 * the result is 'captured' with the transfer EVENT. defeat/stalemate →
 * 'repelled' with transfer null; the cost and the casualty ledger are still
 * recorded — the price was paid. captureId =
 * fnv1a(`${attackerId}|${targetId}|${capturedAt}`).toString(16), deterministic
 * (no time-source reads). The input is never mutated; a fresh result is
 * returned.
 */
export function capturePlanet(input: CaptureInput): CaptureResult {
  const attackerId = assertNonEmptyString(input.attackerId, 'attackerId')
  const defenderId = assertNonEmptyString(input.defenderId, 'defenderId')
  const targetId = assertNonEmptyString(input.targetId, 'targetId')
  assertPositiveAt(input.capturedAt)
  assertOutcome(input.outcome)
  assertStructureSurvival(input.structureSurvival)
  assertLedger(input.casualties)
  assertCost(input.cost)

  const bodyId = resolveTargetBody(input.universe, targetId)
  const capturedAt = input.capturedAt
  const captureId = fnv1a(`${attackerId}|${targetId}|${capturedAt}`).toString(16)

  if (input.outcome.result !== 'victory') {
    return {
      captureId,
      attackerId,
      defenderId,
      targetId,
      capturedAt,
      outcome: 'repelled',
      transfer: null,
      survivingStructures: null,
      cost: input.cost,
      casualties: input.casualties,
    }
  }

  const settlement = settlementFor(bodyId)
  const transfer = conquestTransfer({
    record: input.targetOwnership,
    toOwnerId: attackerId,
    at: capturedAt,
    survival: {
      populationSurvival: survivalFor(settlement, input.casualties).populationSurvival,
      structureSurvival: input.structureSurvival,
      garrisonSurvival: survivalFor(settlement, input.casualties).garrisonSurvival,
    },
    structures: settlement.structures,
    previousHistory: [],
    current: { population: settlement.population, garrison: settlement.garrison },
  })

  if ('ok' in transfer) {
    throw new Error(
      `victory on ${targetId} cannot be captured: the locked transfer rejected it ` +
        `(${transfer.reason})`,
    )
  }

  return {
    captureId,
    attackerId,
    defenderId,
    targetId,
    capturedAt,
    outcome: 'captured',
    transfer: transfer.event,
    survivingStructures: transfer.structures,
    cost: input.cost,
    casualties: input.casualties,
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

/**
 * Structural invariants of a CaptureResult: captureId the deterministic
 * formula fnv1a(`${attackerId}|${targetId}|${capturedAt}`).toString(16);
 * attackerId / defenderId / targetId non-empty; capturedAt positive finite;
 * outcome in the frozen union; cost and casualties PRESENT in both outcomes
 * (the price was paid on every attempt); captured ⇒ transfer non-null (the
 * OwnershipEvent naming the attacker as toOwnerId, method 'conquest', bodyId/
 * at anchored on the target/capturedAt) and survivingStructures non-null with
 * the defense turret ABSENT (DESIGN §5 — the delegate's contract); repelled
 * ⇒ transfer null and survivingStructures null.
 */
export function captureInvariants(result: CaptureResult): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  const expectedCaptureId = fnv1a(
    `${result.attackerId}|${result.targetId}|${result.capturedAt}`,
  ).toString(16)
  if (result.captureId !== expectedCaptureId) {
    problems.push(
      `captureId must equal fnv1a(attackerId|targetId|capturedAt) = ${expectedCaptureId}, got ${String(result.captureId)}`,
    )
  }

  for (const field of ['attackerId', 'defenderId', 'targetId'] as const) {
    if (typeof result[field] !== 'string' || result[field].trim().length === 0) {
      problems.push(
        `${field} must be a non-empty string, got ${String(result[field])}`,
      )
    }
  }

  if (!Number.isFinite(result.capturedAt) || result.capturedAt <= 0) {
    problems.push(
      `capturedAt must be a finite number > 0, got ${result.capturedAt}`,
    )
  }

  if (!(CAPTURE_OUTCOMES as readonly string[]).includes(result.outcome)) {
    problems.push(
      `outcome must be 'captured'|'repelled', got ${String(result.outcome)}`,
    )
  }

  if (result.cost === null) {
    problems.push('cost must be present (the price is paid on every capture attempt)')
  }

  if (result.casualties === null) {
    problems.push('casualties must be present (the ledger records both sides)')
  }

  if (result.outcome === 'captured') {
    if (result.transfer === null) {
      problems.push(
        'a captured world must carry the locked transfer (transfer non-null)',
      )
    } else {
      if (result.transfer.toOwnerId !== result.attackerId) {
        problems.push(
          `the transfer must hand the world to the attacker ${result.attackerId}, ` +
            `got toOwnerId ${result.transfer.toOwnerId}`,
        )
      }
      if (result.transfer.method !== 'conquest') {
        problems.push(
          `the transfer event must record method 'conquest', got ${result.transfer.method}`,
        )
      }
      if (result.transfer.bodyId !== result.targetId) {
        problems.push(
          `the transfer event must anchor on the target ${result.targetId}, ` +
            `got ${result.transfer.bodyId}`,
        )
      }
      if (result.transfer.at !== result.capturedAt) {
        problems.push(
          `the transfer event must carry the capture time ${result.capturedAt}, ` +
            `got ${result.transfer.at}`,
        )
      }
    }
    if (result.survivingStructures === null) {
      problems.push(
        'a captured world must carry the surviving structures (survivingStructures non-null)',
      )
    } else if (result.survivingStructures.defenseTurret !== undefined) {
      problems.push(
        'the transfer must destroy the defense turrets (DESIGN §5 — turret absent)',
      )
    }
  } else {
    if (result.transfer !== null) {
      problems.push('a repelled capture must carry no transfer (transfer null)')
    }
    if (result.survivingStructures !== null) {
      problems.push(
        'a repelled capture must carry no surviving structures (survivingStructures null)',
      )
    }
  }

  return { ok: problems.length === 0, problems }
}

/**
 * Deterministic one-line capture report, e.g.
 * `Captured in 4h battle: 10,400 population · 5,200 fleet · 260K cr · 3
 * structures survived` (a captured world — the cost totals and the number of
 * surviving structures, the turret already gone via the delegate) or
 * `Repelled: attackers lost 3,000 troops` (a repelled world — the attacker
 * population lost from the T05 ledger). Numbers use a plain thousands
 * separator (no environment-sensitive formatting — deterministic everywhere).
 * The result must satisfy its invariants (RangeError otherwise).
 */
export function captureSummary(result: CaptureResult): string {
  const { ok, problems } = captureInvariants(result)
  if (!ok) {
    throw new RangeError(`cannot summarise a malformed capture: ${problems[0]}`)
  }

  if (result.outcome === 'repelled') {
    const casualties = result.casualties as CasualtyLedger
    return `Repelled: attackers lost ${formatInteger(casualties.attacker.populationLoss)} troops`
  }

  const cost = result.cost as ConquestCost
  const survivors = result.survivingStructures as StructureGrid
  const survived = Object.values(survivors).filter(
    (level) => level > 0,
  ).length
  return (
    `Captured in ${BATTLE_DURATION_HOURS}h battle: ` +
    `${formatInteger(cost.total.population)} population · ` +
    `${formatInteger(cost.total.fleet)} fleet · ` +
    `${formatInteger(Math.floor(cost.total.credits / 1000))}K cr · ` +
    `${survived} structures survived`
  )
}
