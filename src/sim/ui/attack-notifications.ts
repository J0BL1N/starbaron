/**
 * ATTACK NOTIFICATIONS (P7-T11) — the notification contract for combat events
 * over the combat chain: the incoming attack with its ETA (a T01 order in
 * flight), the arrival moment, and the battle result (a T03 outcome). This is
 * a PURE UI-state projection — the HUD wiring is P12 and the notification
 * store feed is P10.
 *
 * PURE module — deterministic: every function derives only from its
 * arguments; no time-source reads (`at` is a caller-supplied epoch-ms INPUT);
 * no nondeterministic APIs; no module-level mutable tables (the lookup tables
 * below are deep-frozen); strictly typed.
 *
 * DESIGN decisions (documented — pinned):
 * - **id:** `String(fnv1a(`${kind}|${orderId}|${at}`))` — deterministic, the
 *   P4-T07 numeric-hash convention (notifications.ts `notificationId`). The
 *   `|` separator keeps the fields unambiguous; the same triple always yields
 *   the same id.
 * - **incoming:** 'incoming-attack' is valid only while the order is IN
 *   FLIGHT — `order.status` must be 'launched'/'traveling' (an arrived,
 *   resolving, resolved or aborted order throws) and `at` must be strictly
 *   before `order.arrivalAt` (Error otherwise). The arrival boundary is
 *   half-open like positioning/movement: at `at == arrivalAt` the attack is
 *   no longer incoming. `etaSeconds = floor((arrivalAt − at) / 1000)` is
 *   always ≥ 0 by that boundary. The ETA label floors hours and minutes
 *   (`2h 14m` — the intel-ui floored-age convention), so a sub-minute ETA
 *   reads `0h 0m`. `at` may precede `launchAt`: an issued-but-not-away
 *   'launched' order still projects a valid ETA.
 * - **arrived:** 'attack-arrived' requires `at >= order.arrivalAt` (Error
 *   otherwise — the same half-open boundary) and carries `etaSeconds: null`.
 * - **result:** 'battle-result' speaks from the DEFENDER's perspective (the
 *   reader owns the target). The message derives from the LOCKED T09 combat
 *   report (combat-reports.ts), never from an independent winner flag:
 *   `report.result === 'stalemate'` → 'STALEMATE — attackers withdrew'; the
 *   report's validated winner drives the flip — winner is the DEFENDER
 *   (report.result 'defeat') → 'VICTORY — you repelled the attack', winner
 *   is the ATTACKER (report.result 'victory') → 'DEFEAT — <target> fell to
 *   the attackers'. T09's reportInvariants is the winner/loser gate, so the
 *   report is the single source of who won. The linked T01 orderId is a
 *   separate input (the CombatReport carries no orderId).
 * - **state:** the HUD projection over a list of these notifications: `count`
 *   is the list length, `latest` is the newest by (at, id) with a
 *   deterministic id tie-break (null when empty), and `unread` mirrors the
 *   P4-T07 unread convention (a new item is unread until marked read). The
 *   notifications module exposes no shared unread helper and this subset
 *   carries no read flag, so the projection treats every carried item as
 *   unread — unread === count — and documents that read-state tracking is the
 *   P4 store's job once the P10 feed attaches the richer Notification shape.
 *
 * Validation (RangeError unless noted): `at` positive finite (validate.ts
 * assertPositiveAt); the order shape, target id and in-flight status; the
 * half-open boundaries (Error); the report via T09's locked reportInvariants
 * (a malformed report — bad result, winner/loser mismatch, empty ids —
 * throws RangeError).
 */

import { fnv1a } from '../planets/hash'
import { ATTACK_ORDER_STATUSES } from '../combat/attack-orders'
import type { AttackOrder } from '../combat/attack-orders'
import { reportInvariants } from '../combat/combat-reports'
import type { CombatReport } from '../combat/combat-reports'
import type { BattleResult } from '../combat/resolution'
import { assertNonEmptyString, assertPositiveAt } from './validate'

export type AttackNotificationKind =
  | 'incoming-attack'
  | 'attack-arrived'
  | 'battle-result'

export interface AttackNotification {
  notificationId: string
  kind: AttackNotificationKind
  orderId: string
  targetId: string
  at: number
  etaSeconds: number | null
  message: string
}

export type AttackBattleResult = BattleResult

export interface BattleResultNotificationInput {
  /** The linked T01 order (the notification store keys on it). */
  orderId: string
  /** The locked T09 combat report — its validated winner/loser drive the message. */
  report: CombatReport
  at: number
}

export interface AttackNotificationState {
  count: number
  unread: number
  latest: AttackNotification | null
}

/** The AttackNotificationKind union as a deep-frozen lookup table (runtime-immutable). */
export const ATTACK_NOTIFICATION_KINDS: readonly AttackNotificationKind[] =
  Object.freeze(['incoming-attack', 'attack-arrived', 'battle-result'])

/** The battle result union (T03 BattleResult) as a deep-frozen lookup table. */
export const ATTACK_BATTLE_RESULTS: readonly AttackBattleResult[] = Object.freeze([
  'victory',
  'defeat',
  'stalemate',
])

/**
 * Deterministic notification id: `fnv1a(`${kind}|${orderId}|${at}`)` as a
 * decimal string — the P4-T07 numeric-hash convention. The `|` separator
 * keeps the fields unambiguous; the same triple always yields the same id.
 */
function notificationIdFor(
  kind: AttackNotificationKind,
  orderId: string,
  at: number,
): string {
  return String(fnv1a(`${kind}|${orderId}|${at}`))
}

/**
 * The floored ETA label (intel-ui floored-age convention): whole hours and
 * whole minutes, `2h 14m`. `etaSeconds` is always ≥ 0 by the incoming
 * boundary, so the label never shows a negative duration.
 */
function formatEta(etaSeconds: number): string {
  const hours = Math.floor(etaSeconds / 3600)
  const minutes = Math.floor((etaSeconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

/** The order must be a well-formed AttackOrder: status in the union, a
 * non-empty id and target id, launchAt positive finite and arrivalAt strictly
 * after launchAt. */
function assertOrderShape(order: AttackOrder): void {
  assertNonEmptyString(order.id, 'order.id')
  if (!(ATTACK_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new RangeError(
      `order.status must be 'launched'|'traveling'|'arrived'|'resolving'|'resolved'|'aborted', got ${String(order.status)}`,
    )
  }
  if (!Number.isFinite(order.launchAt) || order.launchAt <= 0) {
    throw new RangeError(
      `order.launchAt must be a finite number > 0, got ${order.launchAt}`,
    )
  }
  if (!Number.isFinite(order.arrivalAt) || order.arrivalAt <= order.launchAt) {
    throw new RangeError(
      `order.arrivalAt must be finite and strictly after launchAt (${order.launchAt}), got ${order.arrivalAt}`,
    )
  }
  assertNonEmptyString(order.targetRef.id, 'order.targetRef.id')
}

/** An incoming attack is only notified while the order is in flight. */
function assertInFlight(order: AttackOrder): void {
  if (order.status !== 'launched' && order.status !== 'traveling') {
    throw new Error(
      `cannot notify an incoming attack for order ${order.id}: ` +
        `status '${order.status}' is not launched/traveling — an arrived, ` +
        'resolving, resolved or aborted order is no longer in flight',
    )
  }
}

/**
 * The 'incoming-attack' notification: the threat read-out for a T01 order in
 * flight. `order.status` must be 'launched'/'traveling' and `at` must be
 * strictly before `order.arrivalAt` (Error otherwise — the half-open arrival
 * boundary: at `at == arrivalAt` the attack is no longer incoming).
 * `etaSeconds = floor((order.arrivalAt − at) / 1000)` is always ≥ 0 by that
 * boundary. The message is deterministic:
 * `INCOMING ATTACK on <target> — ETA <h>h <m>m` (floored). The order and `at`
 * are validated first (RangeError); a fresh notification is returned and the
 * input is never mutated.
 */
export function incomingAttackNotification(
  order: AttackOrder,
  at: number,
): AttackNotification {
  assertPositiveAt(at)
  assertOrderShape(order)
  assertInFlight(order)
  if (at >= order.arrivalAt) {
    throw new Error(
      `cannot notify an incoming attack for order ${order.id}: at ${at} is ` +
        `at or after arrival ${order.arrivalAt} (the attack is no longer incoming)`,
    )
  }
  const etaSeconds = Math.floor((order.arrivalAt - at) / 1000)
  return {
    notificationId: notificationIdFor('incoming-attack', order.id, at),
    kind: 'incoming-attack',
    orderId: order.id,
    targetId: order.targetRef.id,
    at,
    etaSeconds,
    message: `INCOMING ATTACK on ${order.targetRef.id} — ETA ${formatEta(etaSeconds)}`,
  }
}

/**
 * The 'attack-arrived' notification: the arrival moment of a T01 order.
 * Requires `at >= order.arrivalAt` (Error otherwise — the half-open arrival
 * boundary, mirrored from positioning/movement). `etaSeconds` is null and the
 * message is deterministic: `ATTACK ARRIVED on <target> — defenders engaged`.
 * The order and `at` are validated first (RangeError); a fresh notification
 * is returned and the input is never mutated.
 */
export function attackArrivedNotification(
  order: AttackOrder,
  at: number,
): AttackNotification {
  assertPositiveAt(at)
  assertOrderShape(order)
  if (at < order.arrivalAt) {
    throw new Error(
      `cannot notify arrival for order ${order.id}: at ${at} is before ` +
        `arrival ${order.arrivalAt}`,
    )
  }
  return {
    notificationId: notificationIdFor('attack-arrived', order.id, at),
    kind: 'attack-arrived',
    orderId: order.id,
    targetId: order.targetRef.id,
    at,
    etaSeconds: null,
    message: `ATTACK ARRIVED on ${order.targetRef.id} — defenders engaged`,
  }
}

/**
 * The 'battle-result' notification for a T03 outcome, read from the
 * DEFENDER's perspective (the notification reader owns the target). The
 * message derives from the LOCKED T09 combat report (never an independent
 * winner flag): the report's validated `result` and `sections.winner` are
 * the single source of who won — the perspective flip is the winner's
 * identity. `report.result === 'stalemate'` (no winner) →
 * `STALEMATE — attackers withdrew from <target>`; winner is the DEFENDER
 * (result 'defeat') → `VICTORY — you repelled the attack on <target>`; the
 * ATTACKER won (result 'victory') → `DEFEAT — <target> fell to the
 * attackers`. The linked orderId is a separate input (the CombatReport
 * carries no orderId). `etaSeconds` is null. Validation (RangeError): the
 * orderId non-empty (validate.ts assertNonEmptyString), `at` positive finite,
 * and the report via T09's locked reportInvariants — a malformed report
 * (bad result, winner/loser mismatch, empty ids) throws. A fresh
 * notification is returned; the input is never mutated.
 */
export function battleResultNotification(
  input: BattleResultNotificationInput,
): AttackNotification {
  const orderId = assertNonEmptyString(input.orderId, 'orderId')
  assertPositiveAt(input.at)
  const { ok, problems } = reportInvariants(input.report)
  if (!ok) {
    throw new RangeError(`cannot notify a malformed combat report: ${problems[0]}`)
  }
  const targetId = input.report.targetId

  const message =
    input.report.result === 'stalemate'
      ? `STALEMATE — attackers withdrew from ${targetId}`
      : input.report.sections.winner === input.report.defenderId
        ? `VICTORY — you repelled the attack on ${targetId}`
        : `DEFEAT — ${targetId} fell to the attackers`

  return {
    notificationId: notificationIdFor('battle-result', orderId, input.at),
    kind: 'battle-result',
    orderId,
    targetId,
    at: input.at,
    etaSeconds: null,
    message,
  }
}

/**
 * The HUD projection over a list of attack notifications at reference time
 * `at` (`at` must be positive finite — assertPositiveAt). `count` is the list
 * length. `latest` is the newest notification by (at, id) with a
 * deterministic id tie-break (null when empty) — mirrors the P4-T07
 * newest-first ordering. `unread` mirrors the P4-T07 unread convention (a new
 * item is unread until marked read): this subset carries no read flag and the
 * notifications module exposes no shared unread helper, so the projection
 * treats every carried item as unread — unread === count — and read-state
 * tracking is the P4 store's job once the P10 feed attaches the richer
 * Notification shape. The input list is never mutated; a fresh projection is
 * returned.
 */
export function attackNotificationState(
  notifications: readonly AttackNotification[],
  at: number,
): AttackNotificationState {
  assertPositiveAt(at)
  const count = notifications.length
  let latest: AttackNotification | null = null
  for (const item of notifications) {
    if (
      latest === null ||
      item.at > latest.at ||
      (item.at === latest.at && item.notificationId < latest.notificationId)
    ) {
      latest = item
    }
  }
  return { count, unread: count, latest }
}
