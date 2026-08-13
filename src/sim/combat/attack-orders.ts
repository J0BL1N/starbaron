/**
 * Attack ORDERS (P7-T01) — the attack-order model: launching an attack (a
 * fleet committing a subset of its soldiers against a target), the travel leg
 * to the target, the time-projected lifecycle and the pre-resolution abort
 * transition. RESOLUTION of the outcome is NOT here — that is P7-T03's
 * contract (the resolution hook). This module models launch, travel, the
 * resolution window and the lifecycle up to resolution.
 *
 * The LOCKED attack model is DESIGN.md §5 / §5a (attack flow: scout →
 * assemble → launch → wait → resolve → report; attack cost = population +
 * fleet — committed troops are lost whether the attack wins or loses; travel
 * = real distance). This module mirrors the locked numbers and defers every
 * other concern to the caller.
 *
 * DESIGN decisions (all documented):
 * - **Launch cost (DELEGATED):** `attackLaunchCost` delegates the LOCKED
 *   formula `200 + fleetSize × 0.2 + distancePc × 10` to the estimator's
 *   `launchCost` (src/sim/player/estimator.ts), which mirrors the applied
 *   0006 game_config seed exactly. The exported consts ATTACK_LAUNCH_BASE_CR
 *   / ATTACK_LAUNCH_PER_FLEET_CR / ATTACK_LAUNCH_PER_PC_CR alias that seed so
 *   the DESIGN numbers stay documented without drifting.
 * - **Committed troops:** troops come FROM the fleet — `troopsCommitted` is
 *   the committed SUBSET, so it must be a positive integer no larger than
 *   `fleetSize` (Error otherwise). The committed troops are lost whether the
 *   attack wins or loses (§5); the casualty split is resolution's (P7-T03).
 * - **Arrival (DELEGATED):** `arrivalAt = launchAt + travelDuration(distance,
 *   speed) × 1000`, computed overflow-safe via `movement.arrivalTime`. That
 *   convention rejects a zero-distance leg (arrival would equal launch), so a
 *   launch at distancePc 0 throws RangeError — a same-position target cannot
 *   be attacked.
 * - **Id:** `fnv1a(`${attackerId}|${fleetId}|${launchAt}|${targetId}`)
 *   .toString(16)` — deterministic, no time-source reads (`launchAt` is an
 *   input).
 * - **Lifecycle (time projection):** `attackStatusAt` projects a launched
 *   order through its windows: `at < launchAt` → 'launched' (issued, not yet
 *   away); `launchAt ≤ at < arrivalAt` → 'traveling'; `at ≥ arrivalAt` →
 *   'arrived' (the resolution window — [arrivalAt, ∞) until resolved;
 *   RESOLUTION TIMING is P7-T03's concern). A stored 'resolving' / 'resolved'
 *   / 'aborted' status projects as itself; resolved orders also report their
 *   stored outcome. Boundaries match the positioning conventions: `at ==
 *   launchAt` is 'traveling' and `at == arrivalAt` is 'arrived' (both
 *   inclusive), mirroring `movement.isArrived`.
 * - **Progress:** deterministic string `en route · N%` where N =
 *   round(clamp01((at − launchAt) / (arrivalAt − launchAt)) × 100), clamped
 *   via Math.min/Math.max onto [0,1] — an at before launchAt reads 0%, an at
 *   at or after arrivalAt reads 100%. Aborted orders report 'aborted';
 *   resolved orders report 'resolved'.
 * - **Abort:** only 'launched' / 'traveling' orders abort (the fleet is still
 *   in flight). 'arrived' / 'resolving' / 'resolved' / 'aborted' orders
 *   cannot abort (Error) — once on the ground the attack goes to resolution.
 * - **Wallet:** `launchAttack` RESERVES the launch cost (`cost` is returned;
 *   the wallet is never debited here — the caller debits via transactions). A
 *   wallet short on credits throws (insufficient); wallet shape is validated
 *   (finite, non-negative).
 * - **Error taxonomy:** malformed VALUES (bad at/troops/fleetSize/kind/id/
 *   speed/distance/wallet) throw RangeError; semantic violations (committing
 *   more troops than the fleet holds, insufficient credits, aborting an
 *   order that is already in resolution or terminal) throw Error.
 *
 * Pure module — deterministic, no time-source reads (timestamps are INPUTS),
 * no nondeterministic APIs, no mutable module-level tables (lookup tables are
 * deep-frozen), strictly typed.
 */

import { fnv1a } from '../planets/hash'
import { assertPositiveAt } from '../ui/validate'
import { arrivalTime } from '../fleet/movement'
import { launchCost, PVP_CONSTANTS } from '../player/estimator'
import type { WalletState } from '../player/types'

export type AttackTargetKind = 'planet' | 'system'

export interface AttackTargetRef {
  kind: AttackTargetKind
  id: string
}

export type AttackOrderStatus =
  | 'launched'
  | 'traveling'
  | 'arrived'
  | 'resolving'
  | 'resolved'
  | 'aborted'

export type AttackOutcome = 'pending' | 'victory' | 'defeat' | 'aborted'

export interface AttackOrder {
  id: string
  attackerId: string
  fleetId: string
  targetRef: AttackTargetRef
  troopsCommitted: number
  launchAt: number
  arrivalAt: number
  status: AttackOrderStatus
  launchCost: { credits: number }
  outcome: AttackOutcome
}

export interface LaunchAttackInput {
  attackerId: string
  fleetId: string
  targetRef: AttackTargetRef
  troopsCommitted: number
  fleetSize: number
  distancePc: number
  launchAt: number
  speedPcPerSec: number
  wallet: WalletState
}

export interface AttackStatusProjection {
  status: string
  outcome: string
  progress: string
}

/** The AttackTargetKind union as a deep-frozen lookup table (runtime-immutable). */
export const ATTACK_TARGET_KINDS: readonly AttackTargetKind[] = Object.freeze([
  'planet',
  'system',
])

/** The AttackOrderStatus union as a deep-frozen lookup table (runtime-immutable). */
export const ATTACK_ORDER_STATUSES: readonly AttackOrderStatus[] = Object.freeze([
  'launched',
  'traveling',
  'arrived',
  'resolving',
  'resolved',
  'aborted',
])

/** The AttackOutcome union as a deep-frozen lookup table (runtime-immutable). */
export const ATTACK_OUTCOMES: readonly AttackOutcome[] = Object.freeze([
  'pending',
  'victory',
  'defeat',
  'aborted',
])

/**
 * DESIGN-locked launch-cost constants (DESIGN.md §5a: `200 cr + fleet × 0.2 cr
 * + distancePc × 10 cr`). Aliased from `PVP_CONSTANTS` — the estimator's copy
 * of the applied 0006 game_config seed — so there is exactly one locked
 * source and no balance drift.
 */
export const ATTACK_LAUNCH_BASE_CR = PVP_CONSTANTS.launch_cost_base_credits
export const ATTACK_LAUNCH_PER_FLEET_CR =
  PVP_CONSTANTS.launch_cost_per_fleet_credits
export const ATTACK_LAUNCH_PER_PC_CR = PVP_CONSTANTS.launch_cost_per_pc_credits

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(
      `${field} must be a non-empty string, got ${JSON.stringify(value)}`,
    )
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${field} must be a non-negative integer, got ${String(value)}`,
    )
  }
}

function assertTargetRef(targetRef: AttackTargetRef): void {
  if (!(ATTACK_TARGET_KINDS as readonly string[]).includes(targetRef.kind)) {
    throw new RangeError(
      `targetRef.kind must be 'planet' or 'system', got ${String(targetRef.kind)}`,
    )
  }
  if (typeof targetRef.id !== 'string' || targetRef.id.length === 0) {
    throw new RangeError('targetRef.id must be a non-empty string')
  }
}

function assertWallet(wallet: WalletState): void {
  if (!Number.isFinite(wallet.credits) || wallet.credits < 0) {
    throw new RangeError(
      `wallet.credits must be a finite non-negative number, got ${wallet.credits}`,
    )
  }
  if (!Number.isFinite(wallet.alloys) || wallet.alloys < 0) {
    throw new RangeError(
      `wallet.alloys must be a finite non-negative number, got ${wallet.alloys}`,
    )
  }
}

function assertOrderShape(order: AttackOrder): void {
  if (!(ATTACK_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new RangeError(
      `order.status must be 'launched'|'traveling'|'arrived'|'resolving'|'resolved'|'aborted', got ${String(order.status)}`,
    )
  }
  if (!(ATTACK_OUTCOMES as readonly string[]).includes(order.outcome)) {
    throw new RangeError(
      `order.outcome must be 'pending'|'victory'|'defeat'|'aborted', got ${String(order.outcome)}`,
    )
  }
  if (!Number.isFinite(order.launchAt) || order.launchAt <= 0) {
    throw new RangeError(
      `order.launchAt must be a finite number > 0, got ${order.launchAt}`,
    )
  }
  if (!Number.isFinite(order.arrivalAt) || order.arrivalAt <= order.launchAt) {
    throw new RangeError(
      `order.arrivalAt must be finite and strictly after launchAt ` +
        `(${order.launchAt}), got ${order.arrivalAt}`,
    )
  }
}

/**
 * The LOCKED launch cost (DESIGN.md §5a): `credits = 200 + fleetSize × 0.2 +
 * distancePc × 10`. Delegates to the estimator's `launchCost` (the applied
 * 0006 seed via PVP_CONSTANTS) — a single locked source. `fleetSize` must be
 * a non-negative integer (RangeError otherwise); `distancePc` is validated by
 * the estimator (finite non-negative, RangeError otherwise). The 5,000-fleet
 * raid on a 10 pc target from the DESIGN worked example costs 1,300 cr.
 */
export function attackLaunchCost(
  fleetSize: number,
  distancePc: number,
): { credits: number } {
  assertNonNegativeInteger(fleetSize, 'fleetSize')
  return { credits: launchCost(fleetSize, distancePc) }
}

/**
 * Launches an attack: validates the request, reserves the launch cost against
 * the wallet (the wallet is never debited), computes the overflow-safe arrival
 * via `movement.arrivalTime` and returns a fresh 'launched' order (outcome
 * 'pending'). Validation order (each throws):
 *   1. `launchAt` positive finite (assertPositiveAt)
 *   2. `attackerId` / `fleetId` non-empty strings
 *   3. `targetRef` kind in {'planet','system'} with a non-empty id
 *   4. `troopsCommitted` a positive integer
 *   5. `fleetSize` a non-negative integer, and `troopsCommitted <= fleetSize`
 *      (the committed subset — Error otherwise)
 *   6. `wallet` shape (credits/alloys finite non-negative)
 *   7. launch cost via `attackLaunchCost`, wallet sufficient (Error otherwise)
 *   8. `arrivalAt` via `movement.arrivalTime` (bad speed, zero distance and
 *      overflow throw RangeError)
 *
 * The order id is `fnv1a(`${attackerId}|${fleetId}|${launchAt}|${targetId}`)
 * .toString(16)` — deterministic. Returns a fresh order; the input is never
 * mutated and the target ref is copied.
 */
export function launchAttack(input: LaunchAttackInput): {
  order: AttackOrder
  cost: { credits: number }
} {
  const {
    attackerId,
    fleetId,
    targetRef,
    troopsCommitted,
    fleetSize,
    distancePc,
    launchAt,
    speedPcPerSec,
    wallet,
  } = input

  assertPositiveAt(launchAt)
  assertNonEmptyString(attackerId, 'attackerId')
  assertNonEmptyString(fleetId, 'fleetId')
  assertTargetRef(targetRef)
  if (!Number.isInteger(troopsCommitted) || troopsCommitted <= 0) {
    throw new RangeError(
      `troopsCommitted must be a positive integer, got ${String(troopsCommitted)}`,
    )
  }
  assertNonNegativeInteger(fleetSize, 'fleetSize')
  if (troopsCommitted > fleetSize) {
    throw new Error(
      `cannot commit ${troopsCommitted} troops: exceeds fleet size ${fleetSize} ` +
        '(the committed subset cannot exceed the fleet)',
    )
  }
  assertWallet(wallet)

  const cost = attackLaunchCost(fleetSize, distancePc)
  if (wallet.credits < cost.credits) {
    throw new Error(
      `cannot launch attack: insufficient credits (need ${cost.credits}, ` +
        `have ${wallet.credits})`,
    )
  }

  const arrivalAt = arrivalTime(launchAt, distancePc, speedPcPerSec)
  const id = fnv1a(`${attackerId}|${fleetId}|${launchAt}|${targetRef.id}`).toString(16)

  return {
    order: {
      id,
      attackerId,
      fleetId,
      targetRef: { ...targetRef },
      troopsCommitted,
      launchAt,
      arrivalAt,
      status: 'launched',
      launchCost: { credits: cost.credits },
      outcome: 'pending',
    },
    cost,
  }
}

function progressFor(order: AttackOrder, at: number): string {
  const total = order.arrivalAt - order.launchAt
  const elapsed = at - order.launchAt
  const ratio = total > 0 ? elapsed / total : 1
  const clamped = Math.min(1, Math.max(0, ratio))
  return `en route · ${Math.round(clamped * 100)}%`
}

/**
 * Time projection of an attack order at `at` (both `at` and the order must
 * validate — assertPositiveAt and assertOrderShape). For a launched order the
 * windows are: `at < launchAt` → 'launched'; `launchAt ≤ at < arrivalAt` →
 * 'traveling'; `at ≥ arrivalAt` → 'arrived' (the resolution window,
 * [arrivalAt, ∞) until resolved). Stored 'resolving' / 'resolved' / 'aborted'
 * statuses project as themselves; resolved orders also report their stored
 * outcome. In-flight projections report outcome 'pending'. `progress` is the
 * deterministic `en route · N%` string (see progressFor); aborted orders
 * report 'aborted' and resolved orders report 'resolved'.
 */
export function attackStatusAt(
  order: AttackOrder,
  at: number,
): AttackStatusProjection {
  assertPositiveAt(at)
  assertOrderShape(order)

  if (order.status === 'aborted') {
    return { status: 'aborted', outcome: 'aborted', progress: 'aborted' }
  }
  if (order.status === 'resolved') {
    return {
      status: 'resolved',
      outcome: order.outcome,
      progress: 'resolved',
    }
  }
  if (order.status === 'resolving') {
    return { status: 'resolving', outcome: 'pending', progress: progressFor(order, at) }
  }

  let status: AttackOrderStatus
  if (at < order.launchAt) {
    status = 'launched'
  } else if (at < order.arrivalAt) {
    status = 'traveling'
  } else {
    status = 'arrived'
  }
  return { status, outcome: 'pending', progress: progressFor(order, at) }
}

/**
 * Aborts a launched or traveling attack ('launched'/'traveling' → 'aborted',
 * outcome 'aborted'). An 'arrived', 'resolving', 'resolved' or 'aborted' order
 * cannot abort (Error) — once the fleet is on the ground the attack goes to
 * resolution (P7-T03). `at` must be positive finite (assertPositiveAt). The
 * order is validated (assertOrderShape) and a fresh order is returned; the
 * input is never mutated and the target ref is copied.
 */
export function abortAttack(order: AttackOrder, at: number): AttackOrder {
  assertPositiveAt(at)
  assertOrderShape(order)
  if (order.status !== 'launched' && order.status !== 'traveling') {
    throw new Error(
      `cannot abort attack ${order.id}: only launched or traveling attacks ` +
        `abort, got '${order.status}'`,
    )
  }
  return {
    ...order,
    targetRef: { ...order.targetRef },
    status: 'aborted',
    outcome: 'aborted',
  }
}
