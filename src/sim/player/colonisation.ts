import type { BodyId } from '../world/identity'
import { idSeed, parseCanonicalId } from '../world/identity'
import type { OwnershipEvent, OwnershipRecord } from './ownership'
import { ownershipFor } from './ownership'
import type { HomeProtection } from './protection'

/**
 * Planet colonisation (P2-T06): the pure model of claiming an EMPTY world.
 *
 * Pure module: every function is a pure function of its arguments — no
 * nondeterministic APIs, no wall-clock timestamps (`at` is a caller-supplied
 * INPUT), no module-level mutable state. The same inputs always produce the
 * same (deep-equal) result.
 *
 * Fleet/travel prerequisites are an EXTERNAL flag bundle
 * (ColonisationRequirement): this module only checks the flags; P5 supplies
 * the real computation (fleet assembly + travel time from real distance). No
 * UI/DB/rendering wiring — callers project the result.
 *
 * WALLET CONTRACT: the wallet is NEVER mutated here. A successful colonise
 * returns the cost it consumed (`result.cost`) and the CALLER applies the
 * spend (e.g. `walletSpend`). The pure model reports; the caller persists.
 *
 * ELIGIBILITY LADDER (first match wins, documented order):
 *   invalid-target → already-owned → protected → requirements-not-met →
 *   insufficient-funds → success.
 *
 * Invalid `at`/`ownerId` on the success path throw RangeError from
 * ownershipFor (the record validator) — they are not ladder reasons.
 */

export interface ColonisationCost {
  credits: number
  alloys: number
}

/** Default base colonisation cost (credits + alloys) before per-body variance. */
export const COLONISATION_BASE_COST: ColonisationCost = {
  credits: 500,
  alloys: 100,
}

/**
 * External prerequisite flags (P5 supplies the real computation): the colonist
 * fleet is assembled AND the travel can reach the target. Both must be true.
 */
export interface ColonisationRequirement {
  hasFleet: boolean
  hasTravel: boolean
}

export type ColonisationRejectionReason =
  | 'already-owned'
  | 'protected'
  | 'requirements-not-met'
  | 'insufficient-funds'
  | 'invalid-target'

export type ColonisationResult =
  | {
      ok: true
      record: OwnershipRecord
      event: OwnershipEvent
      cost: ColonisationCost
    }
  | {
      ok: false
      reason: ColonisationRejectionReason
      cost: ColonisationCost
    }

export interface ColoniseInput {
  bodyId: BodyId
  ownerId: string
  wallet: { credits: number; alloys: number }
  requirements: ColonisationRequirement
  existingOwners: ReadonlySet<BodyId>
  at: number
  protection?: HomeProtection
}

function assertBaseCost(base: ColonisationCost): void {
  for (const field of ['credits', 'alloys'] as const) {
    if (!Number.isFinite(base[field]) || base[field] < 0) {
      throw new RangeError(
        `${field} must be a finite non-negative number, got ${base[field]}`,
      )
    }
  }
}

function isValidBodyId(value: BodyId): boolean {
  const parsed = parseCanonicalId(value)
  return parsed.ok && parsed.kind === 'body'
}

/**
 * The per-body colonisation cost: the base scaled by a deterministic mild
 * variance multiplier derived from the body id — multiplier = 0.9 +
 * (idSeed(bodyId) % 21) / 100, so the cost lands in [0.9x, 1.1x] of base.
 * Deterministic: the same body id always yields the same cost. Exported for
 * UI display and used internally by `colonise`.
 */
export function colonisationCostFor(
  bodyId: BodyId,
  base: ColonisationCost = COLONISATION_BASE_COST,
): ColonisationCost {
  assertBaseCost(base)
  const multiplier = 0.9 + (idSeed(bodyId) % 21) / 100
  return {
    credits: Math.round(base.credits * multiplier),
    alloys: Math.round(base.alloys * multiplier),
  }
}

/**
 * Colonise a body. Runs the full eligibility ladder and either returns a fresh
 * OwnershipRecord (method 'colonisation', isHome false, unconquerable false)
 * with its audit event and consumed cost, or a rejection reason + cost.
 * Inputs are never mutated. `protection` is optional and only consulted when
 * present (P2-T03: `protection?.protected === true` blocks).
 */
export function colonise(input: ColoniseInput): ColonisationResult {
  const cost = colonisationCostFor(input.bodyId)
  if (!isValidBodyId(input.bodyId)) {
    return { ok: false, reason: 'invalid-target', cost }
  }
  if (input.existingOwners.has(input.bodyId)) {
    return { ok: false, reason: 'already-owned', cost }
  }
  if (input.protection?.protected === true) {
    return { ok: false, reason: 'protected', cost }
  }
  if (!input.requirements.hasFleet || !input.requirements.hasTravel) {
    return { ok: false, reason: 'requirements-not-met', cost }
  }
  if (input.wallet.credits < cost.credits || input.wallet.alloys < cost.alloys) {
    return { ok: false, reason: 'insufficient-funds', cost }
  }
  const record = ownershipFor(
    input.bodyId,
    input.ownerId,
    null,
    input.at,
    'colonisation',
    false,
    false,
  )
  const event: OwnershipEvent = {
    bodyId: record.bodyId,
    fromOwnerId: null,
    toOwnerId: record.ownerId,
    at: record.acquiredAt,
    method: 'colonisation',
  }
  return { ok: true, record, event, cost }
}
