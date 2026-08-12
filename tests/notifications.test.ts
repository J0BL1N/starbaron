import { describe, expect, it } from 'vitest'
import { fnv1a } from '../src/sim/planets/hash'
import {
  addNotification,
  emptyNotificationsState,
  expired,
  markAllRead,
  markRead,
  notificationId,
  react,
  sortedNotifications,
  validateNotifications,
} from '../src/sim/ui/notifications'
import type {
  Notification,
  NotificationsState,
} from '../src/sim/ui/notifications'

const NOW = 1_700_000_000_000

const INFO_A = {
  type: 'info' as const,
  title: 'Colony complete',
  message: 'Alpha Prime is ready',
  at: NOW,
}
const WARN_B = {
  type: 'warning' as const,
  title: 'Low credits',
  message: 'Credits are running low',
  at: NOW - 1_000,
}
const DANGER_C = {
  type: 'danger' as const,
  title: 'Hostile fleet',
  message: 'Fleet inbound',
  at: NOW - 2_000,
}

function expectUnchanged<T>(snapshot: T, value: T): void {
  expect(value).toEqual(snapshot)
}

describe('P4-T07 addNotification — creation and deduplication', () => {
  it('appends a new item with a derived id, read=false and empty reactions', () => {
    const state = addNotification(emptyNotificationsState(), INFO_A)
    expect(state.items).toHaveLength(1)
    const item = state.items[0]!
    expect(item.id).toBe(notificationId(INFO_A.title, INFO_A.message, INFO_A.at))
    expect(item.type).toBe('info')
    expect(item.title).toBe(INFO_A.title)
    expect(item.message).toBe(INFO_A.message)
    expect(item.at).toBe(INFO_A.at)
    expect(item.read).toBe(false)
    expect(item.reactions).toEqual([])
    expect(state.unreadCount).toBe(1)
  })

  it('derives the id deterministically as fnv1a over title|message|at', () => {
    const expected = String(
      fnv1a(`${INFO_A.title}|${INFO_A.message}|${INFO_A.at}`),
    )
    expect(notificationId(INFO_A.title, INFO_A.message, INFO_A.at)).toBe(
      expected,
    )
    const first = addNotification(emptyNotificationsState(), INFO_A)
    const second = addNotification(emptyNotificationsState(), INFO_A)
    expect(first.items[0]!.id).toBe(second.items[0]!.id)
    expect(first).toEqual(second)
  })

  it('deduplicates: the same input twice yields one item and the same state', () => {
    const once = addNotification(emptyNotificationsState(), INFO_A)
    const twice = addNotification(once, INFO_A)
    expect(twice.items).toHaveLength(1)
    expect(twice.unreadCount).toBe(1)
    expect(twice).toBe(once)
  })

  it('deduplicates across type: the id (title|message|at) is the dedup key', () => {
    const first = addNotification(emptyNotificationsState(), INFO_A)
    const differentType = addNotification(first, {
      ...INFO_A,
      type: 'success',
    })
    expect(differentType.items).toHaveLength(1)
    expect(differentType.items[0]!.type).toBe('info')
    expect(differentType).toBe(first)
  })

  it('distinct title, message, or at produce distinct ids and items', () => {
    const a = addNotification(emptyNotificationsState(), INFO_A)
    const withTitle = addNotification(a, { ...INFO_A, title: 'Other' })
    const withMessage = addNotification(a, { ...INFO_A, message: 'Other msg' })
    const withAt = addNotification(a, { ...INFO_A, at: NOW + 1 })
    for (const state of [withTitle, withMessage, withAt]) {
      expect(state.items).toHaveLength(2)
      expect(state.items[0]!.id).not.toBe(state.items[1]!.id)
    }
  })

  it('preserves existing items and insertion order across multiple adds', () => {
    const a = addNotification(emptyNotificationsState(), INFO_A)
    const b = addNotification(a, WARN_B)
    const c = addNotification(b, DANGER_C)
    expect(c.items.map((item) => item.id)).toEqual([
      notificationId(INFO_A.title, INFO_A.message, INFO_A.at),
      notificationId(WARN_B.title, WARN_B.message, WARN_B.at),
      notificationId(DANGER_C.title, DANGER_C.message, DANGER_C.at),
    ])
    expect(c.unreadCount).toBe(3)
  })

  it('throws RangeError on a non-positive or non-finite at', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        addNotification(emptyNotificationsState(), { ...INFO_A, at: bad }),
      ).toThrow(RangeError)
    }
  })
})

describe('P4-T07 markRead / markAllRead — read state', () => {
  it('marks the target read and recomputes unreadCount, leaving others alone', () => {
    const base = addNotification(
      addNotification(emptyNotificationsState(), INFO_A),
      WARN_B,
    )
    const id = notificationId(WARN_B.title, WARN_B.message, WARN_B.at)
    const next = markRead(base, id)
    expect(next.items.find((item) => item.id === id)!.read).toBe(true)
    expect(next.items[0]!.read).toBe(false)
    expect(next.unreadCount).toBe(1)
    expect(base.unreadCount).toBe(2)
    expect(base.items[1]!.read).toBe(false)
  })

  it('is idempotent: marking an already-read notification returns the same state', () => {
    const base = addNotification(emptyNotificationsState(), INFO_A)
    const id = notificationId(INFO_A.title, INFO_A.message, INFO_A.at)
    const read = markRead(base, id)
    const again = markRead(read, id)
    expect(again).toBe(read)
    expect(again.unreadCount).toBe(0)
  })

  it('throws RangeError on an unknown id', () => {
    expect(() => markRead(emptyNotificationsState(), 'no-such-id')).toThrow(
      RangeError,
    )
  })

  it('marks all items read and unreadCount becomes 0', () => {
    const base = addNotification(
      addNotification(emptyNotificationsState(), INFO_A),
      WARN_B,
    )
    const next = markAllRead(base)
    expect(next.items.every((item) => item.read)).toBe(true)
    expect(next.unreadCount).toBe(0)
  })

})

describe('P4-T07 react — reactions', () => {
  const id = notificationId(INFO_A.title, INFO_A.message, INFO_A.at)

  it('adds an emoji and leaves unreadCount untouched', () => {
    const base = addNotification(emptyNotificationsState(), INFO_A)
    const next = react(base, id, '👍')
    expect(next.items[0]!.reactions).toEqual(['👍'])
    expect(next.unreadCount).toBe(1)
    expect(next.items[0]!.read).toBe(false)
  })

  it('deduplicates: the same emoji twice yields one reaction and the same state', () => {
    const once = react(addNotification(emptyNotificationsState(), INFO_A), id, '👍')
    const twice = react(once, id, '👍')
    expect(twice.items[0]!.reactions).toEqual(['👍'])
    expect(twice).toBe(once)
  })

  it('accumulates distinct emojis in insertion order', () => {
    const base = addNotification(emptyNotificationsState(), INFO_A)
    const next = react(react(base, id, '👍'), id, '🔥')
    expect(next.items[0]!.reactions).toEqual(['👍', '🔥'])
  })

  it('repairs a deliberately mismatched unreadCount', () => {
    const base = addNotification(emptyNotificationsState(), INFO_A)
    const tampered: NotificationsState = { ...base, unreadCount: 42 }
    const next = react(tampered, id, '👍')
    expect(next.items[0]!.reactions).toEqual(['👍'])
    expect(next.unreadCount).toBe(
      next.items.filter((item) => !item.read).length,
    )
    expect(next.unreadCount).not.toBe(42)
  })

  it('throws RangeError on an empty emoji', () => {
    const base = addNotification(emptyNotificationsState(), INFO_A)
    expect(() => react(base, id, '')).toThrow(RangeError)
  })

  it('throws RangeError on an unknown id', () => {
    expect(() =>
      react(emptyNotificationsState(), 'no-such-id', '👍'),
    ).toThrow(RangeError)
  })
})

describe('P4-T07 sortedNotifications — ordering', () => {
  function seeded(): NotificationsState {
    return addNotification(
      addNotification(emptyNotificationsState(), INFO_A),
      DANGER_C,
    )
  }

  it('returns a new array, newest first by at descending, without mutating input', () => {
    const base = addNotification(seeded(), WARN_B)
    const snapshot = JSON.stringify(base.items)
    const sorted = sortedNotifications(base)
    expect(sorted).not.toBe(base.items)
    expect(sorted.map((item) => item.at)).toEqual([NOW, NOW - 1_000, NOW - 2_000])
    expectUnchanged(snapshot, JSON.stringify(base.items))
  })

  it('breaks at ties deterministically by id', () => {
    const sameAt = addNotification(
      addNotification(emptyNotificationsState(), INFO_A),
      { ...WARN_B, at: NOW },
    )
    const sorted = sortedNotifications(sameAt)
    const [first, second] = sorted
    expect(first!.at).toBe(NOW)
    expect(second!.at).toBe(NOW)
    expect(first!.id < second!.id).toBe(true)
    const again = sortedNotifications(sameAt)
    expect(again.map((item) => item.id)).toEqual(sorted.map((item) => item.id))
  })
})

describe('P4-T07 expired — expiry', () => {
  function aged(): NotificationsState {
    const young = { ...INFO_A, at: NOW }
    const middle = { ...WARN_B, at: NOW - 30_000 }
    const old = { ...DANGER_C, at: NOW - 90_000 }
    return addNotification(
      addNotification(addNotification(emptyNotificationsState(), young), middle),
      old,
    )
  }

  it('removes items strictly older than maxAge and recomputes unreadCount', () => {
    const state = aged()
    const next = expired(state, NOW, 60)
    expect(next.items.map((item) => item.title)).toEqual([
      'Colony complete',
      'Low credits',
    ])
    expect(next.unreadCount).toBe(2)
    expect(state.items).toHaveLength(3)
    expect(state.unreadCount).toBe(3)
  })

  it('keeps an item exactly maxAge old; removes one millisecond older', () => {
    const boundary = { ...WARN_B, at: NOW - 60_000 }
    const justOlder = { ...DANGER_C, at: NOW - 60_001 }
    const state = addNotification(
      addNotification(emptyNotificationsState(), boundary),
      justOlder,
    )
    const next = expired(state, NOW, 60)
    expect(next.items.map((item) => item.title)).toEqual(['Low credits'])
    expect(next.unreadCount).toBe(1)
  })

  it('returns the same state when nothing expires', () => {
    const state = aged()
    const next = expired(state, NOW, 3600)
    expect(next).toBe(state)
  })

  it('throws RangeError on a non-positive or non-finite maxAgeSeconds', () => {
    const state = aged()
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => expired(state, NOW, bad)).toThrow(RangeError)
    }
  })

  it('throws RangeError on a non-positive or non-finite reference at', () => {
    const state = aged()
    for (const bad of [0, -5, Number.NaN]) {
      expect(() => expired(state, bad, 60)).toThrow(RangeError)
    }
  })
})

describe('P4-T07 validateNotifications — tamper detection', () => {
  function wellFormed(): NotificationsState {
    const base = addNotification(
      addNotification(emptyNotificationsState(), INFO_A),
      WARN_B,
    )
    const idA = notificationId(INFO_A.title, INFO_A.message, INFO_A.at)
    const withReaction = react(base, idA, '👍')
    return markRead(withReaction, idA)
  }

  it('passes an empty state', () => {
    const result = validateNotifications(emptyNotificationsState())
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('passes a well-formed multi-item state (read, unread, reactions)', () => {
    const result = validateNotifications(wellFormed())
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('flags duplicate ids', () => {
    const state = wellFormed()
    const duplicateId = state.items[0]!.id
    const tampered: NotificationsState = {
      items: [
        ...state.items,
        { ...state.items[1]!, id: duplicateId, reactions: [] },
      ],
      unreadCount: state.unreadCount,
    }
    const result = validateNotifications(tampered)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('duplicate notification id'))).toBe(
      true,
    )
  })

  it('flags a non-finite or non-positive at', () => {
    const state = wellFormed()
    const tampered = {
      ...state,
      items: [{ ...state.items[0]!, at: Number.NaN }],
    } as unknown as NotificationsState
    const result = validateNotifications(tampered)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('at must be a positive finite'))).toBe(
      true,
    )
  })

  it('flags an unreadCount that does not match the unread items', () => {
    const state = wellFormed()
    const tampered = { ...state, unreadCount: state.unreadCount + 1 }
    const result = validateNotifications(tampered)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('unreadCount'))).toBe(true)
  })

  it('flags duplicate reactions within an item', () => {
    const state = wellFormed()
    const tampered = {
      ...state,
      items: [{ ...state.items[0]!, reactions: ['👍', '👍'] }],
    } as unknown as NotificationsState
    const result = validateNotifications(tampered)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('duplicate reaction'))).toBe(true)
  })

  it('flags a non-boolean read flag', () => {
    const state = wellFormed()
    const tampered = {
      ...state,
      items: [{ ...state.items[0]!, read: 'yes' }],
    } as unknown as NotificationsState
    const result = validateNotifications(tampered)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('read must be a boolean'))).toBe(
      true,
    )
  })

  it('reports every problem at once, not just the first', () => {
    const state = wellFormed()
    const id = state.items[0]!.id
    const tampered = {
      items: [
        { ...state.items[0]!, at: 0 },
        { ...state.items[1]!, id, reactions: ['👍', '👍'] },
      ],
      unreadCount: 99,
    } as unknown as NotificationsState
    const result = validateNotifications(tampered)
    expect(result.ok).toBe(false)
    expect(
      result.problems.some((p) => p.includes('at must be a positive finite')),
    ).toBe(true)
    expect(result.problems.some((p) => p.includes('duplicate notification id'))).toBe(
      true,
    )
    expect(result.problems.some((p) => p.includes('duplicate reaction'))).toBe(true)
    expect(result.problems.some((p) => p.includes('unreadCount'))).toBe(true)
  })
})

describe('P4-T07 invariants — determinism and purity', () => {
  const id = (item: Notification): string => item.id

  it('is deterministic: an identical transition pipeline yields deep-equal states', () => {
    function pipeline(): NotificationsState {
      let state = addNotification(
        addNotification(emptyNotificationsState(), INFO_A),
        WARN_B,
      )
      const idA = notificationId(INFO_A.title, INFO_A.message, INFO_A.at)
      state = react(state, idA, '🔥')
      state = markRead(state, idA)
      state = expired(state, NOW, 3600)
      return state
    }
    const first = pipeline()
    const second = pipeline()
    expect(second).toEqual(first)
    expect(sortedNotifications(first).map(id)).toEqual(
      sortedNotifications(second).map(id),
    )
    expect(validateNotifications(first).ok).toBe(true)
  })

  it('tolerates a deep-frozen input state and never mutates it', () => {
    const base = addNotification(
      addNotification(emptyNotificationsState(), INFO_A),
      WARN_B,
    )
    const idA = notificationId(INFO_A.title, INFO_A.message, INFO_A.at)
    const idB = notificationId(WARN_B.title, WARN_B.message, WARN_B.at)
    Object.freeze(base)
    Object.freeze(base.items)
    for (const item of base.items) {
      Object.freeze(item)
      Object.freeze(item.reactions)
    }
    const snapshot = JSON.stringify(base)

    addNotification(base, DANGER_C)
    markRead(base, idA)
    markAllRead(base)
    react(base, idB, '👍')
    sortedNotifications(base)
    expired(base, NOW, 60)

    expectUnchanged(snapshot, JSON.stringify(base))
  })

  it('cross-checks: add → react → markRead → expired states stay valid end to end', () => {
    let state = addNotification(emptyNotificationsState(), INFO_A)
    const idA = notificationId(INFO_A.title, INFO_A.message, INFO_A.at)
    state = react(state, idA, '👍')
    state = markRead(state, idA)
    state = addNotification(state, DANGER_C)
    state = expired(state, NOW, 60)
    expect(state.unreadCount).toBe(1)
    expect(state.items[0]!.read).toBe(true)
    expect(validateNotifications(state).ok).toBe(true)
  })
})
