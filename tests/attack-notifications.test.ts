import { describe, expect, it } from 'vitest'
import {
  ATTACK_BATTLE_RESULTS,
  ATTACK_NOTIFICATION_KINDS,
  attackArrivedNotification,
  attackNotificationState,
  battleResultNotification,
  incomingAttackNotification,
} from '../src/sim/ui/attack-notifications'
import type {
  AttackNotification,
  AttackNotificationKind,
} from '../src/sim/ui/attack-notifications'
import type { AttackOrder } from '../src/sim/combat/attack-orders'
import { fnv1a } from '../src/sim/planets/hash'

const AT = 1_700_000_000_000

function order(overrides: Partial<AttackOrder> = {}): AttackOrder {
  return {
    id: 'order-1',
    attackerId: 'raider-1',
    fleetId: 'fleet-1',
    targetRef: { kind: 'planet', id: 'HD 564 b' },
    troopsCommitted: 5000,
    launchAt: AT - 60_000,
    arrivalAt: AT + 8_040_000,
    status: 'launched',
    launchCost: { credits: 1300 },
    outcome: 'pending',
    ...overrides,
  }
}

function expectedId(kind: AttackNotificationKind, orderId: string, at: number): string {
  return String(fnv1a(`${kind}|${orderId}|${at}`))
}

function snapshot(value: AttackOrder): AttackOrder {
  return JSON.parse(JSON.stringify(value)) as AttackOrder
}

describe('P7-T11 incomingAttackNotification — ETA math and message', () => {
  it('arrival in 2h 14m → etaSeconds 8040 and a floored ETA message', () => {
    const n = incomingAttackNotification(order(), AT)
    expect(n.kind).toBe('incoming-attack')
    expect(n.orderId).toBe('order-1')
    expect(n.targetId).toBe('HD 564 b')
    expect(n.at).toBe(AT)
    expect(n.etaSeconds).toBe(8040)
    expect(n.message).toBe('INCOMING ATTACK on HD 564 b — ETA 2h 14m')
  })

  it('floors hours and minutes: 7,800s remaining → ETA 2h 10m', () => {
    const n = incomingAttackNotification(order(), order().arrivalAt - 7_800_000)
    expect(n.etaSeconds).toBe(7800)
    expect(n.message).toBe('INCOMING ATTACK on HD 564 b — ETA 2h 10m')
  })

  it('floors sub-minute ETAs: 1,500ms remaining → etaSeconds 1, ETA 0h 0m', () => {
    const n = incomingAttackNotification(order(), order().arrivalAt - 1_500)
    expect(n.etaSeconds).toBe(1)
    expect(n.message).toBe('INCOMING ATTACK on HD 564 b — ETA 0h 0m')
  })

  it('still projects a valid ETA for an at before launchAt (issued, not away)', () => {
    const n = incomingAttackNotification(order(), AT - 90_000)
    expect(n.etaSeconds).toBe(8130)
    expect(n.message).toBe('INCOMING ATTACK on HD 564 b — ETA 2h 15m')
  })

  it('derives the id deterministically as fnv1a(kind|orderId|at)', () => {
    const n = incomingAttackNotification(order(), AT)
    expect(n.notificationId).toBe(expectedId('incoming-attack', 'order-1', AT))
    const again = incomingAttackNotification(order(), AT)
    expect(again.notificationId).toBe(n.notificationId)
    expect(again).toEqual(n)
  })

  it('throws at the arrival boundary: at == arrivalAt is arrived, not incoming', () => {
    expect(() => incomingAttackNotification(order(), order().arrivalAt)).toThrow(Error)
  })

  it('throws when at is after arrivalAt', () => {
    expect(() =>
      incomingAttackNotification(order(), order().arrivalAt + 1),
    ).toThrow(Error)
  })

  it('throws for arrived, resolving, resolved or aborted orders (not in flight)', () => {
    for (const status of ['arrived', 'resolving', 'resolved', 'aborted'] as const) {
      expect(() => incomingAttackNotification(order({ status }), AT), status).toThrow(
        Error,
      )
    }
    expect(incomingAttackNotification(order({ status: 'traveling' }), AT).kind).toBe(
      'incoming-attack',
    )
  })

  it('throws RangeError for a non-positive or non-finite at', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => incomingAttackNotification(order(), bad), String(bad)).toThrow(
        RangeError,
      )
    }
  })
})

describe('P7-T11 attackArrivedNotification — arrival boundary', () => {
  it('notifies at the exact arrivalAt with a null ETA', () => {
    const n = attackArrivedNotification(order(), order().arrivalAt)
    expect(n.kind).toBe('attack-arrived')
    expect(n.orderId).toBe('order-1')
    expect(n.targetId).toBe('HD 564 b')
    expect(n.at).toBe(order().arrivalAt)
    expect(n.etaSeconds).toBeNull()
    expect(n.message).toBe('ATTACK ARRIVED on HD 564 b — defenders engaged')
    expect(n.notificationId).toBe(
      expectedId('attack-arrived', 'order-1', order().arrivalAt),
    )
  })

  it('also notifies for an at after arrivalAt (later observation)', () => {
    const n = attackArrivedNotification(order(), order().arrivalAt + 5_000)
    expect(n.etaSeconds).toBeNull()
    expect(n.message).toBe('ATTACK ARRIVED on HD 564 b — defenders engaged')
  })

  it('throws when at is before arrivalAt (the half-open boundary)', () => {
    expect(() =>
      attackArrivedNotification(order(), order().arrivalAt - 1),
    ).toThrow(Error)
  })

  it('throws RangeError for a non-positive or non-finite at', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => attackArrivedNotification(order(), bad), String(bad)).toThrow(
        RangeError,
      )
    }
  })
})

describe('P7-T11 battleResultNotification — result and perspective', () => {
  const input = (overrides: Partial<Parameters<typeof battleResultNotification>[0]> = {}) => ({
    orderId: 'order-1',
    targetId: 'HD 564 b',
    result: 'defeat' as const,
    attackerWon: true,
    at: order().arrivalAt + 1_000,
    ...overrides,
  })

  it('the defender repels the attack (T03 defeat, attacker lost) → VICTORY', () => {
    const n = battleResultNotification(input())
    expect(n.kind).toBe('battle-result')
    expect(n.orderId).toBe('order-1')
    expect(n.targetId).toBe('HD 564 b')
    expect(n.etaSeconds).toBeNull()
    expect(n.message).toBe('VICTORY — you repelled the attack on HD 564 b')
  })

  it('the attacker takes the planet (T03 victory, attacker won) → DEFEAT', () => {
    const n = battleResultNotification(input({ result: 'victory', attackerWon: false }))
    expect(n.message).toBe('DEFEAT — HD 564 b fell to the attackers')
  })

  it('a stalemate reads as withdrawal', () => {
    const n = battleResultNotification(input({ result: 'stalemate', attackerWon: false }))
    expect(n.message).toBe('STALEMATE — attackers withdrew from HD 564 b')
  })

  it('flips the perspective: the resolver result is translated to the defender', () => {
    const attackerWon = battleResultNotification(
      input({ result: 'victory', attackerWon: false }),
    )
    const defenderWon = battleResultNotification(input())
    expect(attackerWon.message).toBe('DEFEAT — HD 564 b fell to the attackers')
    expect(defenderWon.message).toBe('VICTORY — you repelled the attack on HD 564 b')
  })

  it('derives the id deterministically as fnv1a(kind|orderId|at)', () => {
    const n = battleResultNotification(input())
    expect(n.notificationId).toBe(
      expectedId('battle-result', 'order-1', order().arrivalAt + 1_000),
    )
    const later = battleResultNotification(input({ at: order().arrivalAt + 2_000 }))
    expect(later.notificationId).not.toBe(n.notificationId)
  })

  it('throws when attackerWon disagrees with the result (perspective consistency)', () => {
    expect(() =>
      battleResultNotification(input({ result: 'victory', attackerWon: true })),
    ).toThrow(Error)
    expect(() =>
      battleResultNotification(input({ result: 'defeat', attackerWon: false })),
    ).toThrow(Error)
    expect(() =>
      battleResultNotification(input({ result: 'stalemate', attackerWon: true })),
    ).toThrow(Error)
  })

  it('throws RangeError for an unknown result', () => {
    expect(() =>
      battleResultNotification(input({ result: 'tie' as never })),
    ).toThrow(RangeError)
  })

  it('throws RangeError for empty ids or a bad at', () => {
    expect(() => battleResultNotification(input({ orderId: '' }))).toThrow(RangeError)
    expect(() => battleResultNotification(input({ targetId: ' ' }))).toThrow(
      RangeError,
    )
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => battleResultNotification(input({ at: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
  })
})

describe('P7-T11 attackNotificationState — the HUD projection', () => {
  function item(
    kind: AttackNotificationKind,
    at: number,
    id = expectedId(kind, 'order-1', at),
  ): AttackNotification {
    return {
      notificationId: id,
      kind,
      orderId: 'order-1',
      targetId: 'HD 564 b',
      at,
      etaSeconds: kind === 'incoming-attack' ? 100 : null,
      message: `${kind} on HD 564 b`,
    }
  }

  it('an empty list projects count 0, unread 0 and a null latest', () => {
    expect(attackNotificationState([], AT)).toEqual({
      count: 0,
      unread: 0,
      latest: null,
    })
  })

  it('a single notification is the latest and counts as unread', () => {
    const one = item('incoming-attack', AT)
    const state = attackNotificationState([one], AT)
    expect(state.count).toBe(1)
    expect(state.unread).toBe(1)
    expect(state.latest).toBe(one)
  })

  it('count and unread mirror the list length (P4 convention: new items unread)', () => {
    const list = [item('incoming-attack', AT - 2_000), item('attack-arrived', AT), item('battle-result', AT + 1_000)]
    const state = attackNotificationState(list, AT)
    expect(state.count).toBe(3)
    expect(state.unread).toBe(3)
  })

  it('latest is the newest by at', () => {
    const newest = item('battle-result', AT + 5_000)
    const state = attackNotificationState(
      [item('incoming-attack', AT), item('attack-arrived', AT + 1_000), newest],
      AT,
    )
    expect(state.latest).toBe(newest)
  })

  it('tie-breaks equal at deterministically by ascending notificationId', () => {
    const newerId = expectedId('battle-result', 'order-1', AT)
    const olderId = expectedId('attack-arrived', 'order-1', AT)
    const a = item('battle-result', AT, newerId)
    const b = item('attack-arrived', AT, olderId)
    const winner = newerId < olderId ? a : b
    expect(attackNotificationState([b, a], AT).latest).toBe(winner)
    expect(attackNotificationState([a, b], AT).latest).toBe(winner)
  })

  it('is deterministic and never mutates the input list', () => {
    const list = [item('incoming-attack', AT), item('attack-arrived', AT + 1_000)]
    const first = attackNotificationState(list, AT)
    const second = attackNotificationState(list, AT)
    expect(second).toEqual(first)
    expect(second.latest).toBe(first.latest)
  })

  it('throws RangeError for a non-positive or non-finite at', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => attackNotificationState([], bad), String(bad)).toThrow(RangeError)
    }
  })
})

describe('P7-T11 purity and immutability', () => {
  it('the union lookup tables are deep-frozen', () => {
    expect(Object.isFrozen(ATTACK_NOTIFICATION_KINDS)).toBe(true)
    expect(Object.isFrozen(ATTACK_BATTLE_RESULTS)).toBe(true)
  })

  it('building a notification never mutates the order it reads', () => {
    const input = order()
    const before = snapshot(input)
    incomingAttackNotification(input, AT)
    attackArrivedNotification(input, input.arrivalAt)
    expect(input).toEqual(before)
  })

  it('repeated calls with equal inputs yield deep-equal notifications', () => {
    const first = incomingAttackNotification(order(), AT)
    const second = incomingAttackNotification(order(), AT)
    expect(second).toEqual(first)
    const report = battleResultNotification({
      orderId: 'order-1',
      targetId: 'HD 564 b',
      result: 'defeat',
      attackerWon: true,
      at: order().arrivalAt + 1_000,
    })
    expect(
      battleResultNotification({
        orderId: 'order-1',
        targetId: 'HD 564 b',
        result: 'defeat',
        attackerWon: true,
        at: order().arrivalAt + 1_000,
      }),
    ).toEqual(report)
  })
})
