/**
 * Fleet ORDERS (P5-T07) — the order model, queue, validation and lifecycle for
 * a single fleet.
 *
 * SCOPE: this module defines the ORDER MODEL only. Resolution of an 'attack'
 * order (combat outcomes) happens in P7 — nothing here resolves outcomes; this
 * module models order issuance, queueing and the lifecycle transitions
 * (issued → active → done/cancelled). Resolution is the CALLER's contract.
 *
 * DESIGN decisions (all documented; DESIGN.md has no fleet-order section):
 * - **Order set** is the roadmap's four types: move / attack / defend / return.
 *   'return' targets the fleet's origin (the caller resolves the origin body
 *   id); it is the ONLY type with a null target — move/attack/defend REQUIRE a
 *   concrete target and throw (Error) if one is missing.
 * - **One-active-order semantics:** at most ONE order is 'active' at a time
 *   (the queue). `issueOrder` THROWS while an order is active, so new orders
 *   can only be enqueued when the fleet has no active order. Several 'issued'
 *   orders may be queued while none is active; once one goes active the fleet
 *   is locked until that order completes or is cancelled.
 * - **Explicit lifecycle (documented decision):** new orders enqueue as
 *   'issued'. They are NOT auto-activated — `activateNext` promotes the first
 *   'issued' order (FIFO by queue position) to 'active'. `completeOrder` and
 *   `cancelOrder` likewise do NOT auto-activate the next queued order; the
 *   caller drives the lifecycle explicitly. This keeps the module pure and
 *   deterministic — no implicit side transitions.
 * - **Id:** `fnv1a(`${fleetId}|${type}|${issuedAt}|${index}`).toString(16)` —
 *   deterministic, no time-source reads. `index` is the order's queue
 *   position at append time and defaults to `orders.length`; orders are only
 *   ever APPENDED (never removed), so positions are unique and ids do not
 *   collide unless a caller overrides `index` with a colliding value for
 *   identical fleetId|type|issuedAt (the caller's responsibility;
 *   `ordersInvariants` flags duplicate ids).
 * - **Timestamps are INPUTS** — no time-source reads. `issuedAt`, `expiresAt`
 *   and the `at` of each transition are caller-supplied and validated via
 *   assertPositiveAt.
 * - **expiresAt** is null unless a duration limit is set; when present it must
 *   be finite and strictly after `issuedAt`. Return orders MAY have no expiry
 *   (returning to origin can be an open-ended trip) — expiry is per-order and
 *   optional for every type.
 * - **ORDER_MIN_AT boundary (single transition contract, see the exported
 *   const):** every lifecycle transition `at` must be >= the target order's
 *   `issuedAt` (RangeError otherwise). A transition on an order whose
 *   `expiresAt` is non-null at `at >= expiresAt` means the order is EXPIRED —
 *   every transition on an expired order throws a RangeError carrying the
 *   'expired' token (an expired order can neither activate nor be completed
 *   nor cancelled).
 * - **Error taxonomy:** malformed VALUES (bad at/issuedAt/index/expiresAt/
 *   target shape) throw RangeError; semantic violations (target pairing
 *   mismatch, issuing while active, invalid lifecycle transitions) throw Error.
 *
 * Pure module — deterministic, no time-source reads, no nondeterministic
 * APIs, no module-level mutable state, strictly typed.
 */

import { assertPositiveAt } from '../ui/validate'
import { fnv1a } from '../planets/hash'

export type FleetOrderType = 'move' | 'attack' | 'defend' | 'return'

export type FleetOrderStatus = 'issued' | 'active' | 'done' | 'cancelled'

export type FleetOrderTargetKind = 'planet' | 'system' | 'body'

export interface FleetOrderTarget {
  kind: FleetOrderTargetKind
  id: string
}

export interface FleetOrder {
  id: string
  fleetId: string
  type: FleetOrderType
  target: FleetOrderTarget | null
  issuedAt: number
  status: FleetOrderStatus
  expiresAt: number | null
}

export interface FleetOrders {
  fleetId: string
  orders: FleetOrder[]
  activeOrderId: string | null
}

export interface IssueOrderInput {
  type: FleetOrderType
  target?: FleetOrderTarget | null
  issuedAt: number
  index?: number
  expiresAt?: number | null
}

/** The FleetOrderType union as a deep-frozen lookup table (runtime-immutable). */
export const ORDER_TYPES: readonly FleetOrderType[] = Object.freeze([
  'move',
  'attack',
  'defend',
  'return',
])

/** The FleetOrderStatus union as a deep-frozen lookup table (runtime-immutable). */
export const ORDER_STATUSES: readonly FleetOrderStatus[] = Object.freeze([
  'issued',
  'active',
  'done',
  'cancelled',
])

/** The FleetOrderTargetKind union as a deep-frozen lookup table (runtime-immutable). */
export const TARGET_KINDS: readonly FleetOrderTargetKind[] = Object.freeze([
  'planet',
  'system',
  'body',
])

/** The target-bearing order types as a deep-frozen lookup table (runtime-immutable). */
export const TARGET_REQUIRED: readonly FleetOrderType[] = Object.freeze([
  'move',
  'attack',
  'defend',
])

function assertTarget(
  target: FleetOrderTarget | null,
  type: FleetOrderType,
): void {
  const requiresTarget = (TARGET_REQUIRED as readonly string[]).includes(type)
  if (requiresTarget) {
    if (target === null) {
      throw new Error(`order of type '${type}' requires a target, got null`)
    }
    if (!(TARGET_KINDS as readonly string[]).includes(target.kind)) {
      throw new RangeError(
        `target.kind must be 'planet'|'system'|'body', got ${String(target.kind)}`,
      )
    }
    if (typeof target.id !== 'string' || target.id.length === 0) {
      throw new RangeError(
        `target.id must be a non-empty string, got ${JSON.stringify(target.id)}`,
      )
    }
  } else if (target !== null) {
    throw new Error(
      `order of type '${type}' requires a null target, got ${JSON.stringify(target)}`,
    )
  }
}

function assertValidExpiry(
  expiresAt: number | null,
  issuedAt: number,
): void {
  if (expiresAt === null) return
  if (!Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new RangeError(
      `expiresAt must be a finite number strictly after issuedAt (${issuedAt}), got ${expiresAt}`,
    )
  }
}

/**
 * ORDER_MIN_AT semantics — the single boundary contract for order lifecycle
 * transitions. Every transition timestamp `at` (activateNext / completeOrder /
 * cancelOrder) must be >= the target order's `issuedAt` (the order's minimum
 * transition timestamp, inclusive); a RangeError otherwise. When the order has
 * a non-null `expiresAt`, a transition at `at >= expiresAt` means the order is
 * EXPIRED — every transition on an expired order throws a RangeError whose
 * message carries the `ORDER_EXPIRED` token.
 */
export const ORDER_MIN_AT = 'issuedAt'

/** The message token every expired-order transition RangeError carries. */
export const ORDER_EXPIRED = 'expired'

function assertTransitionBoundary(
  order: FleetOrder,
  at: number,
  action: string,
): void {
  if (at < order.issuedAt) {
    throw new RangeError(
      `cannot ${action} order ${order.id}: at (${at}) must be >= issuedAt ` +
        `(${order.issuedAt}) (${ORDER_MIN_AT} boundary)`,
    )
  }
  if (order.expiresAt !== null && at >= order.expiresAt) {
    throw new RangeError(
      `cannot ${action} order ${order.id}: ${ORDER_EXPIRED} at ${at} ` +
        `(expiresAt ${order.expiresAt}) — an expired order cannot transition`,
    )
  }
}

/**
 * Issues a new order for a fleet. The order is appended with status 'issued'
 * (the caller activates it via `activateNext` — explicit lifecycle). Validates:
 * state shape; `issuedAt` positive finite; `type` in the union; type/target
 * pairing (move/attack/defend require a target, 'return' requires null); `index`
 * a non-negative integer (defaults to `orders.length`); the one-active-order
 * rule (throws while an order is active); `expiresAt` finite and strictly after
 * `issuedAt` when present. Returns a fresh `FleetOrders`; the input is never
 * mutated.
 */
export function issueOrder(
  state: FleetOrders,
  input: IssueOrderInput,
): FleetOrders {
  if (typeof state.fleetId !== 'string' || state.fleetId.length === 0) {
    throw new RangeError('state.fleetId must be a non-empty string')
  }
  if (!Array.isArray(state.orders)) {
    throw new RangeError('state.orders must be an array')
  }
  assertPositiveAt(input.issuedAt)
  if (!(ORDER_TYPES as readonly string[]).includes(input.type)) {
    throw new RangeError(
      `type must be one of 'move'|'attack'|'defend'|'return', got ${String(input.type)}`,
    )
  }
  const target = input.target === undefined ? null : input.target
  assertTarget(target, input.type)
  const index = input.index === undefined ? state.orders.length : input.index
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`index must be a non-negative integer, got ${index}`)
  }
  if (state.activeOrderId !== null) {
    throw new Error(
      `cannot issue order for fleet ${state.fleetId}: an order is already ` +
        'active (one-active-order semantics)',
    )
  }
  const expiresAt = input.expiresAt === undefined ? null : input.expiresAt
  assertValidExpiry(expiresAt, input.issuedAt)

  const id = fnv1a(`${state.fleetId}|${input.type}|${input.issuedAt}|${index}`).toString(16)
  const order: FleetOrder = {
    id,
    fleetId: state.fleetId,
    type: input.type,
    target,
    issuedAt: input.issuedAt,
    status: 'issued',
    expiresAt,
  }
  return { ...state, orders: [...state.orders, order] }
}

/**
 * Promotes the first 'issued' order (FIFO by queue position) to 'active' and
 * sets `activeOrderId` to its id. If an active order already exists it is a
 * NO-OP (the same state reference is returned); if the queue holds no 'issued'
 * order it is likewise a NO-OP. `at` must be positive finite (RangeError
 * otherwise) and, when an order is promoted, must satisfy the ORDER_MIN_AT
 * boundary: `at >= order.issuedAt`, and an order whose `expiresAt` is non-null
 * and `at >= expiresAt` is EXPIRED and cannot activate (RangeError carrying the
 * 'expired' token). No auto-activation chain — one promotion per call.
 */
export function activateNext(state: FleetOrders, at: number): FleetOrders {
  assertPositiveAt(at)
  if (state.activeOrderId !== null) return state
  const index = state.orders.findIndex((o) => o.status === 'issued')
  if (index === -1) return state
  const order = state.orders[index]
  assertTransitionBoundary(order, at, 'activate')
  const orders = state.orders.map((o) =>
    o === order ? { ...o, status: 'active' as const } : o,
  )
  return { ...state, orders, activeOrderId: order.id }
}

/**
 * Completes the ACTIVE order with `orderId` ('active' → 'done') and clears
 * `activeOrderId`. Only active orders can complete — an 'issued', 'done' or
 * 'cancelled' order throws (Error), and an unknown id throws RangeError with
 * the shared unknown-id message (`unknown order id <id>`). `at` must be
 * positive finite and satisfy the ORDER_MIN_AT boundary: `at >=
 * order.issuedAt`, and an expired order (non-null `expiresAt` with `at >=
 * expiresAt`) cannot transition (RangeError carrying the 'expired' token).
 * Completion does NOT auto-activate the next queued order (explicit lifecycle
 * — the caller calls `activateNext`).
 */
export function completeOrder(
  state: FleetOrders,
  orderId: string,
  at: number,
): FleetOrders {
  assertPositiveAt(at)
  const order = state.orders.find((o) => o.id === orderId)
  if (!order) {
    throw new RangeError(`unknown order id ${JSON.stringify(orderId)}`)
  }
  if (order.status !== 'active') {
    throw new Error(
      `cannot complete order ${orderId}: only active orders can be completed, ` +
        `got '${order.status}'`,
    )
  }
  assertTransitionBoundary(order, at, 'complete')
  const orders = state.orders.map((o) =>
    o.id === orderId ? { ...o, status: 'done' as const } : o,
  )
  return { ...state, orders, activeOrderId: null }
}

/**
 * Cancels an 'issued' or 'active' order ('issued'/'active' → 'cancelled').
 * Cancelling the active order clears `activeOrderId`; cancelling a queued
 * 'issued' order leaves it untouched. A 'done' order — and an already
 * 'cancelled' order — cannot be cancelled (Error), and an unknown id throws
 * RangeError with the shared unknown-id message (`unknown order id <id>`).
 * `at` must be positive finite and satisfy the ORDER_MIN_AT boundary: `at >=
 * order.issuedAt`, and an expired order (non-null `expiresAt` with `at >=
 * expiresAt`) cannot transition (RangeError carrying the 'expired' token).
 * Cancellation does NOT auto-activate the next queued order (explicit
 * lifecycle).
 */
export function cancelOrder(
  state: FleetOrders,
  orderId: string,
  at: number,
): FleetOrders {
  assertPositiveAt(at)
  const order = state.orders.find((o) => o.id === orderId)
  if (!order) {
    throw new RangeError(`unknown order id ${JSON.stringify(orderId)}`)
  }
  if (order.status !== 'issued' && order.status !== 'active') {
    throw new Error(
      `cannot cancel order ${orderId}: only issued or active orders can be ` +
        `cancelled, got '${order.status}'`,
    )
  }
  assertTransitionBoundary(order, at, 'cancel')
  const orders = state.orders.map((o) =>
    o.id === orderId ? { ...o, status: 'cancelled' as const } : o,
  )
  const activeOrderId = order.status === 'active' ? null : state.activeOrderId
  return { ...state, orders, activeOrderId }
}

/**
 * Structural invariants of a FleetOrders: fleetId non-empty; orders an array;
 * per-order — id non-empty and unique, fleetId matching the state fleetId,
 * type/status in their unions, issuedAt finite > 0, target pairing valid
 * (move/attack/defend require a target, 'return' requires null, target shape
 * valid), expiresAt finite and strictly after issuedAt when present; and
 * `activeOrderId` matching EXACTLY one 'active' order (null only when none is
 * active; non-null must reference an existing order in 'active' status).
 */
export function ordersInvariants(state: FleetOrders): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  if (typeof state.fleetId !== 'string' || state.fleetId.length === 0) {
    problems.push(
      `fleetId must be a non-empty string, got ${String(state.fleetId)}`,
    )
  }
  if (!Array.isArray(state.orders)) {
    problems.push('orders must be an array')
    return { ok: problems.length === 0, problems }
  }

  const ids = new Set<string>()
  let activeCount = 0
  for (let i = 0; i < state.orders.length; i++) {
    const order = state.orders[i]
    if (typeof order.id !== 'string' || order.id.length === 0) {
      problems.push(
        `orders[${i}].id must be a non-empty string, got ${String(order.id)}`,
      )
    } else if (ids.has(order.id)) {
      problems.push(`duplicate order id '${order.id}' at index ${i}`)
    } else {
      ids.add(order.id)
    }
    if (typeof order.fleetId !== 'string' || order.fleetId !== state.fleetId) {
      problems.push(
        `orders[${i}].fleetId must equal state.fleetId, got ${JSON.stringify(order.fleetId)}`,
      )
    }
    if (!(ORDER_TYPES as readonly string[]).includes(order.type)) {
      problems.push(
        `orders[${i}].type must be 'move'|'attack'|'defend'|'return', got ${String(order.type)}`,
      )
    }
    if (!(ORDER_STATUSES as readonly string[]).includes(order.status)) {
      problems.push(
        `orders[${i}].status must be 'issued'|'active'|'done'|'cancelled', got ${String(order.status)}`,
      )
    }
    if (!Number.isFinite(order.issuedAt) || order.issuedAt <= 0) {
      problems.push(
        `orders[${i}].issuedAt must be a finite number > 0, got ${order.issuedAt}`,
      )
    }
    const requiresTarget = (TARGET_REQUIRED as readonly string[]).includes(order.type)
    if (requiresTarget && order.target === null) {
      problems.push(`orders[${i}].target is required for type '${order.type}'`)
    }
    if (!requiresTarget && order.target !== null) {
      problems.push(`orders[${i}].target must be null for type '${order.type}'`)
    }
    if (order.target !== null) {
      if (!(TARGET_KINDS as readonly string[]).includes(order.target.kind)) {
        problems.push(
          `orders[${i}].target.kind must be 'planet'|'system'|'body', got ${String(order.target.kind)}`,
        )
      }
      if (typeof order.target.id !== 'string' || order.target.id.length === 0) {
        problems.push(`orders[${i}].target.id must be a non-empty string`)
      }
    }
    if (order.expiresAt !== null) {
      if (!Number.isFinite(order.expiresAt) || order.expiresAt <= order.issuedAt) {
        problems.push(
          `orders[${i}].expiresAt must be finite and strictly after issuedAt ` +
            `(${order.issuedAt}), got ${order.expiresAt}`,
        )
      }
    }
    if (order.status === 'active') activeCount++
  }

  if (state.activeOrderId === null) {
    if (activeCount !== 0) {
      problems.push(
        `activeOrderId is null but ${activeCount} order(s) are 'active'`,
      )
    }
  } else {
    if (typeof state.activeOrderId !== 'string' || state.activeOrderId.length === 0) {
      problems.push(
        `activeOrderId must be a non-empty string or null, got ${String(state.activeOrderId)}`,
      )
    } else {
      const ref = state.orders.find((o) => o.id === state.activeOrderId)
      if (!ref) {
        problems.push(`activeOrderId '${state.activeOrderId}' references no order`)
      } else if (ref.status !== 'active') {
        problems.push(
          `activeOrderId '${state.activeOrderId}' references an order with ` +
            `status '${ref.status}', expected 'active'`,
        )
      }
    }
    if (activeCount !== 1) {
      problems.push(`exactly one 'active' order expected, found ${activeCount}`)
    }
  }

  return { ok: problems.length === 0, problems }
}
