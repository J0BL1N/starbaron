/**
 * Home-world immunity (P7-T08): the combat layer's home-world protection.
 *
 * P2-T03 (src/sim/player/protection.ts) already makes a home world
 * unconquerable at the OWNERSHIP layer — deriveProtection is the locked
 * home-world truth (protected iff isHome AND unconquerable, after the shared
 * assertOwnershipParity gate). This module enforces the SAME truth at the
 * attack layer: an attack can never be LAUNCHED against a home world
 * (guardLaunch) and no RESOLUTION touching one is permitted
 * (assertConquestPermitted). A conquest path can therefore never bypass the
 * ownership-layer protection — the home-world truth is DELEGATED to
 * protection.ts, never re-derived here, so every layer answers the identical
 * predicate.
 *
 * Pure module: every function is a pure function of its arguments — no
 * nondeterministic APIs, no module-level mutable state (the only module-level
 * table is deep-frozen), no time-source reads (attemptedAt is a
 * caller-supplied epoch-ms INPUT). Identical inputs produce identical
 * (deep-equal) results. Strictly typed.
 *
 * The three exports share one input shape:
 *   - homeImmunityFor          the verdict: immune | attackable.
 *   - guardLaunch              the LAUNCH-layer guard: { allowed, immunity }.
 *     The launch flow (attack-orders.launchAttack, P7-T01) consults this
 *     BEFORE forming the attack: the caller reads `allowed` and refuses the
 *     launch when it is false. The launch-flow integration point belongs to
 *     the caller / P7-T11 — this module is the pure guard only.
 *   - assertConquestPermitted  the RESOLUTION-layer guard: throws when a
 *     resolution touches a home world; a no-op otherwise. The resolution
 *     consumer is the capture/resolve layer (P7-T07).
 *
 * UNOWNED TARGETS: an ownerPlayer of null means the target has no owner —
 * unowned worlds are attackable (there is no home to protect). The same
 * holds for a target that is not the owner's home world (a colony or a
 * foreign world).
 */

import { deriveProtection } from '../player/protection'
import type { PlayerState } from '../player/types'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'

/** The body-id type as derived from the locked protection signature. */
type DerivedBodyId = Parameters<typeof deriveProtection>[0]

export type HomeImmunityStatus = 'immune' | 'attackable'

export interface HomeImmunity {
  targetId: string
  isHome: boolean
  status: HomeImmunityStatus
  reason: string
  attemptedAt: number
}

export interface HomeImmunityInput {
  targetId: string
  ownerPlayer: PlayerState | null
  attemptedAt: number
}

export interface LaunchGuardResult {
  allowed: boolean
  immunity: HomeImmunity
}

/** The HomeImmunityStatus union as a deep-frozen lookup table (runtime-immutable). */
export const HOME_IMMUNITY_STATUSES: readonly HomeImmunityStatus[] = Object.freeze([
  'immune',
  'attackable',
])

/** Verdict reason for a protected home world (mirrors the protection module's wording). */
export const HOME_WORLD_IMMUNITY_REASON = 'home world — protected by law'
/** Verdict reason for every attackable target. */
export const NOT_HOME_WORLD_REASON = 'not a home world'
/** The resolution-layer throw message (the P2 transfer message class). */
export const CONQUEST_PROTECTED_MESSAGE = 'home world — protected'

function attackable(targetId: string, attemptedAt: number): HomeImmunity {
  return {
    targetId,
    isHome: false,
    status: 'attackable',
    reason: NOT_HOME_WORLD_REASON,
    attemptedAt,
  }
}

/**
 * The immunity verdict for a target at an attempted attack. Delegates the
 * home-world truth to `deriveProtection` (protection.ts): the target is
 * immune exactly when it IS the owner's home world AND the locked predicate
 * reports it protected. An unowned target (ownerPlayer null) and a target
 * that is not the owner's home world are both attackable. targetId must be a
 * non-empty string (trimmed) and attemptedAt a positive finite number — both
 * validated before a decision. Returns a fresh object; inputs are never
 * mutated.
 */
export function homeImmunityFor(input: HomeImmunityInput): HomeImmunity {
  const targetId = assertNonEmptyString(input.targetId, 'targetId')
  assertPositiveAt(input.attemptedAt)
  const ownerPlayer = input.ownerPlayer
  if (ownerPlayer === null) {
    return attackable(targetId, input.attemptedAt)
  }
  if (targetId !== ownerPlayer.homePlanet.name) {
    return attackable(targetId, input.attemptedAt)
  }
  const protection = deriveProtection(
    targetId as DerivedBodyId,
    ownerPlayer.playerId,
    ownerPlayer.homePlanet.isHome,
    ownerPlayer.homePlanet.unconquerable,
    ownerPlayer.homePlanet.claimedAt,
  )
  if (protection.protected) {
    return {
      targetId,
      isHome: true,
      status: 'immune',
      reason: HOME_WORLD_IMMUNITY_REASON,
      attemptedAt: input.attemptedAt,
    }
  }
  return attackable(targetId, input.attemptedAt)
}

/**
 * The LAUNCH-layer guard: `allowed` is false exactly when the target is the
 * owner's home world; the matching immunity verdict accompanies it. This
 * NEVER throws on a home world — the caller decides how to handle the
 * refusal (the launch flow consults this BEFORE launchAttack and drops the
 * launch when allowed is false). Input validation still propagates (a
 * malformed targetId or attemptedAt throws RangeError).
 */
export function guardLaunch(input: HomeImmunityInput): LaunchGuardResult {
  const immunity = homeImmunityFor(input)
  return { allowed: !immunity.isHome, immunity }
}

/**
 * The RESOLUTION-layer guard: throws `Error` with message
 * `'home world — protected'` when a resolution touches the owner's home
 * world — the same message class as the P2 ownership-transfer throw — and is
 * a no-op for every other target. The consumer is the resolution layer
 * (capture/resolve, P7-T07).
 */
export function assertConquestPermitted(input: HomeImmunityInput): void {
  const immunity = homeImmunityFor(input)
  if (immunity.isHome) {
    throw new Error(CONQUEST_PROTECTED_MESSAGE)
  }
}
