/**
 * Notifications framework (P4-T07) — a pure, deterministic state model for
 * in-game notifications: types, creation, deduplication, ordering, expiry,
 * unread count, and read/reaction state.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock.
 * Timestamps (`at`) are caller-supplied INPUTS (milliseconds since epoch).
 * The same inputs always produce the same (deep-equal) NotificationsState.
 *
 * DEDUPLICATION CONTRACT: the notification id is derived, never supplied —
 * `fnv1a(`${title}|${message}|${at}`)` (canonical hash, src/sim/planets/hash).
 * The same content at the same time therefore yields the same id, and
 * addNotification refuses to add a second item whose id already exists. The
 * id does NOT include `type`: two adds that differ only in type collapse to a
 * single item (the first add wins).
 *
 * DELTA SEMANTICS (anti-duplication, mirroring P3-T08 offline-model): every
 * transition takes the CURRENT NotificationsState and returns a NEW state via
 * structural sharing — inputs are never mutated. `unreadCount` is always
 * recomputed from the resulting items, so a transition cannot drift from its
 * items.
 *
 * EXPIRY BOUNDARY: `expired` removes items STRICTLY older than maxAge — an
 * item whose `at` equals exactly `referenceAt - maxAgeSeconds * 1000`
 * (exactly maxAge old) is KEPT. "Exactly maxAge old" is not "older than
 * maxAge".
 *
 * Contract scope: the state model and its projections only. The P10
 * delivery/channel wiring (persisting, rendering, pushing) is out of scope
 * here.
 */

import { fnv1a } from '../planets/hash'
import { assertPositiveAt } from './validate'

export type NotificationType = 'info' | 'warning' | 'danger' | 'success'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  at: number
  read: boolean
  reactions: readonly string[]
}

export interface NotificationsState {
  items: Notification[]
  unreadCount: number
}

export interface AddNotificationInput {
  type: NotificationType
  title: string
  message: string
  at: number
}

function findItem(
  state: NotificationsState,
  id: string,
): Notification | undefined {
  return state.items.find((item) => item.id === id)
}

/**
 * Deterministic notification id: fnv1a over `${title}|${message}|${at}`. The
 * `|` separator keeps fields ending in digits unambiguous against
 * concatenation; the same (title, message, at) triple always yields the same
 * id.
 */
export function notificationId(
  title: string,
  message: string,
  at: number,
): string {
  return String(fnv1a(`${title}|${message}|${at}`))
}

export function emptyNotificationsState(): NotificationsState {
  return { items: [], unreadCount: 0 }
}

function recomputeUnreadCount(items: readonly Notification[]): number {
  let count = 0
  for (const item of items) {
    if (!item.read) {
      count += 1
    }
  }
  return count
}

/**
 * Immutably append a notification. Deduplication: an item whose derived id
 * already exists (same title|message|at) is NOT added twice — the input state
 * is returned unchanged. `at` must be a positive finite number. New items are
 * always unread, and unreadCount is recomputed from the resulting items.
 */
export function addNotification(
  state: NotificationsState,
  input: AddNotificationInput,
): NotificationsState {
  assertPositiveAt(input.at)
  const id = notificationId(input.title, input.message, input.at)
  if (findItem(state, id) !== undefined) {
    return state
  }
  const item: Notification = {
    id,
    type: input.type,
    title: input.title,
    message: input.message,
    at: input.at,
    read: false,
    reactions: [],
  }
  const items = [...state.items, item]
  return { items, unreadCount: recomputeUnreadCount(items) }
}

/**
 * Immutably mark one notification read. Unknown id throws. Idempotent: an
 * already-read notification returns the input state unchanged. unreadCount is
 * recomputed from the resulting items.
 */
export function markRead(
  state: NotificationsState,
  id: string,
): NotificationsState {
  const existing = findItem(state, id)
  if (existing === undefined) {
    throw new RangeError(`unknown notification id ${JSON.stringify(id)}`)
  }
  if (existing.read) {
    return state
  }
  const items = state.items.map((item) =>
    item.id === id ? { ...item, read: true } : item,
  )
  return { items, unreadCount: recomputeUnreadCount(items) }
}

/**
 * Immutably mark every notification read; unreadCount becomes 0. Idempotent:
 * an already-all-read state is returned unchanged.
 */
export function markAllRead(state: NotificationsState): NotificationsState {
  if (state.items.every((item) => item.read)) {
    return state
  }
  const items = state.items.map((item) =>
    item.read ? item : { ...item, read: true },
  )
  return { items, unreadCount: 0 }
}

/**
 * Immutably add a reaction emoji to a notification. Duplicate emojis are not
 * added again (input state returned unchanged); an empty emoji and an unknown
 * id both throw. Reactions do not affect unreadCount.
 */
export function react(
  state: NotificationsState,
  id: string,
  emoji: string,
): NotificationsState {
  if (emoji.length === 0) {
    throw new RangeError('emoji must be a non-empty string')
  }
  const existing = findItem(state, id)
  if (existing === undefined) {
    throw new RangeError(`unknown notification id ${JSON.stringify(id)}`)
  }
  if (existing.reactions.includes(emoji)) {
    return state
  }
  const items = state.items.map((item) =>
    item.id === id
      ? { ...item, reactions: [...item.reactions, emoji] }
      : item,
  )
  return { items, unreadCount: recomputeUnreadCount(items) }
}

/**
 * Newest-first projection (at descending, id as a deterministic tie-break).
 * Returns a NEW array — the input state is never mutated.
 */
export function sortedNotifications(
  state: NotificationsState,
): Notification[] {
  return [...state.items].sort(
    (a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/**
 * Immutably remove items STRICTLY older than maxAge — those with
 * `item.at < referenceAt - maxAgeSeconds * 1000`. An item exactly maxAge old
 * (`item.at === referenceAt - maxAgeSeconds * 1000`) is KEPT. unreadCount is
 * recomputed from the surviving items. Both `at` and `maxAgeSeconds` must be
 * positive finite numbers.
 */
export function expired(
  state: NotificationsState,
  at: number,
  maxAgeSeconds: number,
): NotificationsState {
  assertPositiveAt(at)
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new RangeError(
      `maxAgeSeconds must be a positive finite number, got ${maxAgeSeconds}`,
    )
  }
  const cutoff = at - maxAgeSeconds * 1000
  const items = state.items.filter((item) => item.at >= cutoff)
  if (items.length === state.items.length) {
    return state
  }
  return { items, unreadCount: recomputeUnreadCount(items) }
}

/**
 * Validate a NotificationsState, catching tamper classes a well-behaved state
 * machine would never produce: duplicate ids, non-finite or non-positive `at`,
 * a non-boolean `read`, duplicate reactions within an item, an empty or
 * whitespace-only reaction, and an `unreadCount` that does not match the
 * number of unread items. Collects ALL problems before returning.
 */
export function validateNotifications(state: NotificationsState): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  const seenIds = new Set<string>()
  for (const item of state.items) {
    if (seenIds.has(item.id)) {
      problems.push(`duplicate notification id ${JSON.stringify(item.id)}`)
    }
    seenIds.add(item.id)

    if (!Number.isFinite(item.at) || item.at <= 0) {
      problems.push(
        `notification ${JSON.stringify(item.id)} at must be a positive finite number`,
      )
    }
    if (typeof item.read !== 'boolean') {
      problems.push(
        `notification ${JSON.stringify(item.id)} read must be a boolean`,
      )
    }
    const seenReactions = new Set<string>()
    for (const emoji of item.reactions) {
      if (emoji.trim().length === 0) {
        problems.push(
          `notification ${JSON.stringify(item.id)} has an empty or whitespace-only reaction ${JSON.stringify(emoji)}`,
        )
      }
      if (seenReactions.has(emoji)) {
        problems.push(
          `notification ${JSON.stringify(item.id)} has duplicate reaction ${JSON.stringify(emoji)}`,
        )
      }
      seenReactions.add(emoji)
    }
  }

  const unread = recomputeUnreadCount(state.items)
  if (state.unreadCount !== unread) {
    problems.push(
      `unreadCount ${state.unreadCount} does not match the ${unread} unread items`,
    )
  }

  return { ok: problems.length === 0, problems }
}
