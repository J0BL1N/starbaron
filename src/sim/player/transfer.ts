import type { StructureId } from '../structures/types'
import type { OwnershipEvent, OwnershipRecord } from './ownership'
import { transferOwnership } from './ownership'

type BodyId = OwnershipRecord['bodyId']
type StructureGrid = Record<StructureId, number>

/**
 * Planetary conquest transfer (P2-T07): the pure model of a world CHANGING
 * HANDS by force — with population/structure/garrison survival rules,
 * previous-owner history, transaction safety and notification hooks.
 *
 * Pure module: every function is a pure function of its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock
 * (`at` is a caller-supplied epoch-ms INPUT). The same inputs always
 * produce the same (deep-equal) result.
 *
 * COMBAT MATH IS NOT HERE (P7): the survival fractions arrive as INPUTS
 * (SurvivalRules), validated to [0, 1]. This module only applies them —
 * survivors round half-up (Math.round), structures floor per id, and
 * zero levels are dropped.
 *
 * TRANSACTION SAFETY / ELIGIBILITY LADDER (first match wins):
 *   protected -> self-transfer -> success.
 *   - `protected`: transferOwnership's unconquerable guard (P2-T03
 *     integration — a protected home can never change hands). The throw
 *     is converted to { ok:false, reason:'protected' }, NEVER escaped.
 *   - `self-transfer`: the attacker is already the owner.
 *   Invalid `at` / `toOwnerId` are NOT ladder reasons — they throw
 *   RangeError from the transferOwnership validators, exactly like the
 *   colonisation success path (P2-T06).
 *
 * HISTORY: the CALLER persists the audit trail with
 * `historyAppend(previousHistory, event)` — the returned event records
 * the previous owner (`fromOwnerId`) and the updated record records it
 * as `previousOwnerId`, so the append is loss-free. The input history
 * array is never mutated here ("the pure model reports; the caller
 * persists", mirroring colonisation.ts).
 *
 * NOTIFICATIONS: the UI hook (P4-T07 wires the UI). Every conquest emits
 * two notifications — 'ownership-lost' to the previous owner, then
 * 'ownership-gained' to the new owner — sharing the same bodyId and `at`.
 */

/** Survival fractions, each in [0, 1]; P7 computes them from combat math. */
export interface SurvivalRules {
  populationSurvival: number
  structureSurvival: number
  garrisonSurvival: number
}

/** The UI notification hook (P4-T07 wires the UI). */
export interface TransferNotification {
  kind: 'ownership-lost' | 'ownership-gained'
  bodyId: BodyId
  ownerId: string
  at: number
}

export interface TransferOutcome {
  record: OwnershipRecord
  event: OwnershipEvent
  survivors: { population: number; garrison: number }
  structures: StructureGrid
  notifications: TransferNotification[]
}

export type ConquestTransferRejectionReason = 'protected' | 'self-transfer'

export interface ConquestTransferRejection {
  ok: false
  reason: ConquestTransferRejectionReason
}

export type ConquestTransferResult = TransferOutcome | ConquestTransferRejection

export interface ConquestTransferInput {
  record: OwnershipRecord
  toOwnerId: string
  at: number
  survival: SurvivalRules
  structures: StructureGrid
  previousHistory: OwnershipEvent[]
  /** The current population/garrison of the world at conquest time. */
  current: { population: number; garrison: number }
}

function assertFiniteFraction(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      `${field} must be a finite fraction in [0, 1], got: ${String(value)}`,
    )
  }
  return value
}

function assertFiniteNonNegative(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} must be a finite non-negative number, got: ${String(value)}`,
    )
  }
  return value
}

function validateSurvival(survival: SurvivalRules): SurvivalRules {
  return {
    populationSurvival: assertFiniteFraction(
      survival.populationSurvival,
      'populationSurvival',
    ),
    structureSurvival: assertFiniteFraction(
      survival.structureSurvival,
      'structureSurvival',
    ),
    garrisonSurvival: assertFiniteFraction(
      survival.garrisonSurvival,
      'garrisonSurvival',
    ),
  }
}

/**
 * The survivors of a population/garrison: Math.round(current * fraction)
 * (round half up) with `fraction` clamped into [0, 1]. A non-finite or
 * negative `current` throws a descriptive RangeError — a count can never
 * be NaN/Infinity, and clamping cannot repair it.
 */
export function applySurvival(current: number, fraction: number): number {
  const validCurrent = assertFiniteNonNegative(current, 'current')
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
    throw new RangeError(
      `fraction must be a finite number, got: ${String(fraction)}`,
    )
  }
  const clamped = Math.min(1, Math.max(0, fraction))
  return Math.round(validCurrent * clamped)
}

/**
 * The structures that survive a conquest: per structure id,
 * floor(level * fraction), with zero levels dropped. Immutable — the
 * input grid is never mutated and a fresh grid is returned. `fraction`
 * must be a finite fraction in [0, 1] (throws a descriptive RangeError
 * otherwise); every level must be a finite non-negative number.
 */
export function structureSurvivors(
  grid: StructureGrid,
  fraction: number,
): StructureGrid {
  const validFraction = assertFiniteFraction(fraction, 'fraction')
  const survivors = {} as StructureGrid
  for (const key of Object.keys(grid)) {
    const structureId = key as StructureId
    const level = assertFiniteNonNegative(
      grid[structureId],
      `structure level ${structureId}`,
    )
    const kept = Math.floor(level * validFraction)
    if (kept > 0) {
      survivors[structureId] = kept
    }
  }
  return survivors
}

/**
 * Conquer a world and transfer it to a new owner. Runs the eligibility
 * ladder (protected -> self-transfer -> success) and, on success, returns
 * the updated ownership record, its audit event, the surviving
 * population/garrison, the surviving structure grid, and the two
 * ownership notifications. All inputs are treated as immutable — the
 * record, the structures grid, the history array and the survival/current
 * objects are never mutated.
 */
export function conquestTransfer(
  input: ConquestTransferInput,
): ConquestTransferResult {
  if (input.record.unconquerable) {
    return { ok: false, reason: 'protected' }
  }
  if (input.toOwnerId === input.record.ownerId) {
    return { ok: false, reason: 'self-transfer' }
  }
  const survival = validateSurvival(input.survival)
  const current = {
    population: assertFiniteNonNegative(input.current.population, 'current.population'),
    garrison: assertFiniteNonNegative(input.current.garrison, 'current.garrison'),
  }
  const transfer = transferOwnership(input.record, input.toOwnerId, input.at, 'conquest')
  const record = transfer.updated
  const event = transfer.event
  const structures = structureSurvivors(input.structures, survival.structureSurvival)
  const notifications: TransferNotification[] = [
    {
      kind: 'ownership-lost',
      bodyId: record.bodyId,
      ownerId: input.record.ownerId,
      at: event.at,
    },
    {
      kind: 'ownership-gained',
      bodyId: record.bodyId,
      ownerId: record.ownerId,
      at: event.at,
    },
  ]
  return {
    record,
    event,
    survivors: {
      population: applySurvival(current.population, survival.populationSurvival),
      garrison: applySurvival(current.garrison, survival.garrisonSurvival),
    },
    structures,
    notifications,
  }
}
