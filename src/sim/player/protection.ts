import type { BodyId } from '../world/identity'
import { assertOwnershipParity } from './ownership'

/**
 * Home-world protection (DESIGN §5 "unconquerable home planet", §6
 * anti-grief): a player's home world can never be conquered, whatever the
 * attacker commits. This module is the pure model of that decision —
 * protected iff the row is BOTH a home (isHome) AND stored unconquerable
 * (unconquerable). All timestamps are caller-supplied inputs; the module
 * never reads the clock, so every function is deterministic.
 *
 * FINDING 3 — unified protection predicate: deriveProtection first runs the
 * shared assertOwnershipParity gate (src/sim/player/ownership.ts) — an
 * unequal-flag input (isHome ≠ unconquerable) is REJECTED with a descriptive
 * error before any protection decision, exactly like transferOwnership and
 * conquestTransfer. All three decision sites then use the identical
 * predicate: protected ⇔ isHome && unconquerable.
 */
export type HomeProtectionReason = 'home-world'

export interface HomeProtection {
  bodyId: BodyId
  ownerId: string
  protected: boolean
  /** Caller-supplied (e.g. claimed_at), present only while protected. */
  protectedSince?: number
  reason?: HomeProtectionReason
}

export interface AttemptedConquestInput {
  target: HomeProtection
  attackerId: string
}

export type AttemptedConquestReason = 'home-world-protected'

export interface AttemptedConquestResult {
  rejected: boolean
  reason?: AttemptedConquestReason
  details: string
}

export interface ProtectionUiState {
  protected: boolean
  label: string
}

export const HOME_WORLD_REASON: HomeProtectionReason = 'home-world'
export const HOME_WORLD_PROTECTED_REASON: AttemptedConquestReason =
  'home-world-protected'
export const UNCONQUERABLE_HOME_LABEL = 'Unconquerable home world'
export const CONQUERABLE_LABEL = 'Conquerable'

/**
 * Derive the protection state of a body from its stored ownership flags.
 * Protected iff BOTH isHome AND unconquerable are true (DESIGN §5 locks
 * "unconquerable = is_home at claim"); an unequal-flag input is REJECTED by
 * the shared assertOwnershipParity gate before the decision is made (finding
 * 3). protectedSince is an INPUT passed through verbatim — it is never
 * computed from the wall clock here. Returns a fresh object (no shared
 * state).
 */
export function deriveProtection(
  bodyId: BodyId,
  ownerId: string,
  isHome: boolean,
  unconquerable: boolean,
  protectedSince?: number,
): HomeProtection {
  assertOwnershipParity(isHome, unconquerable)
  const isProtected = isHome && unconquerable
  return {
    bodyId,
    ownerId,
    protected: isProtected,
    ...(isProtected && { reason: HOME_WORLD_REASON }),
    ...(isProtected && protectedSince !== undefined && { protectedSince }),
  }
}

/**
 * Gate a conquest attempt against the target's protection state. A protected
 * home world rejects EVERY attacker — a foreign empire or the owner
 * themselves: "any planet except your home planet can be taken" (DESIGN §5),
 * so the home can never be conquered. The result is a fresh object; the
 * inputs are never mutated.
 */
export function attemptedConquest(
  input: AttemptedConquestInput,
): AttemptedConquestResult {
  const { target, attackerId } = input
  if (target.protected) {
    return {
      rejected: true,
      reason: HOME_WORLD_PROTECTED_REASON,
      details: `cannot conquer ${target.bodyId}: the home world of ${target.ownerId} is unconquerable (attacker ${attackerId})`,
    }
  }
  return {
    rejected: false,
    details: `conquest of ${target.bodyId} is permitted: target is not protected (attacker ${attackerId})`,
  }
}

export function conquestAllowed(target: HomeProtection): boolean {
  return !target.protected
}

export function protectionStateForUi(
  protection: HomeProtection,
): ProtectionUiState {
  return {
    protected: protection.protected,
    label: protection.protected ? UNCONQUERABLE_HOME_LABEL : CONQUERABLE_LABEL,
  }
}
