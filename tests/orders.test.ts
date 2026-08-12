import { describe, expect, it } from 'vitest'
import {
  activateNext,
  cancelOrder,
  completeOrder,
  issueOrder,
  ordersInvariants,
} from '../src/sim/fleet/orders'
import type {
  FleetOrder,
  FleetOrderTarget,
  FleetOrders,
  IssueOrderInput,
} from '../src/sim/fleet/orders'
import { fnv1a } from '../src/sim/planets/hash'

const AT = 1_700_000_000_000

function freshState(fleetId = 'f1'): FleetOrders {
  return { fleetId, orders: [], activeOrderId: null }
}

function target(
  kind: FleetOrderTarget['kind'] = 'planet',
  id = 't1',
): FleetOrderTarget {
  return { kind, id }
}

function issue(
  state: FleetOrders,
  overrides: Partial<IssueOrderInput> = {},
): FleetOrders {
  return issueOrder(state, {
    type: 'move',
    target: target(),
    issuedAt: AT,
    ...overrides,
  })
}

describe('issueOrder', () => {
  it("issues a 'move' order enqueued as 'issued' with target preserved", () => {
    const state = freshState()
    const after = issue(state, { type: 'move', target: target('system', 'sys-7') })
    expect(after.orders).toHaveLength(1)
    const order = after.orders[0]
    expect(order.type).toBe('move')
    expect(order.status).toBe('issued')
    expect(order.target).toEqual({ kind: 'system', id: 'sys-7' })
    expect(order.fleetId).toBe('f1')
    expect(order.issuedAt).toBe(AT)
    expect(order.expiresAt).toBeNull()
    expect(after.activeOrderId).toBeNull()
    expect(ordersInvariants(after).ok).toBe(true)
  })

  it('id is deterministic and matches the fnv1a spec', () => {
    const a = issue(freshState(), {})
    const b = issue(freshState(), {})
    expect(a.orders[0].id).toBe(b.orders[0].id)
    expect(a.orders[0].id).toBe(fnv1a('f1|move|1700000000000|0').toString(16))
  })

  it('index defaults to orders.length, keeping positions (and ids) distinct', () => {
    const s1 = issue(freshState(), { type: 'move', target: target(), issuedAt: AT })
    const s2 = issue(s1, { type: 'defend', target: target('planet', 'home'), issuedAt: AT + 1 })
    expect(s2.orders[0].id).toBe(fnv1a('f1|move|1700000000000|0').toString(16))
    expect(s2.orders[1].id).toBe(fnv1a('f1|defend|1700000000001|1').toString(16))
    expect(s2.orders[0].id).not.toBe(s2.orders[1].id)
  })

  it('move/attack/defend REQUIRE a target (missing or null throws)', () => {
    for (const t of ['move', 'attack', 'defend'] as const) {
      expect(() => issue(freshState(), { type: t, target: undefined, issuedAt: AT }), t).toThrow(Error)
      expect(() => issue(freshState(), { type: t, target: null, issuedAt: AT }), t).toThrow(Error)
    }
  })

  it("'return' requires a null target (non-null throws)", () => {
    const ok = issue(freshState(), { type: 'return', target: null, issuedAt: AT })
    expect(ok.orders[0].target).toBeNull()
    expect(() => issue(freshState(), { type: 'return', target: target(), issuedAt: AT })).toThrow(Error)
  })

  it('throws RangeError for an invalid target kind or empty target id', () => {
    const badKind = { kind: 'moon', id: 'x' } as unknown as FleetOrderTarget
    const emptyId = { kind: 'planet', id: '' } as unknown as FleetOrderTarget
    expect(() => issue(freshState(), { type: 'move', target: badKind, issuedAt: AT })).toThrow(RangeError)
    expect(() => issue(freshState(), { type: 'move', target: emptyId, issuedAt: AT })).toThrow(RangeError)
  })

  it('throws RangeError for non-positive or non-finite issuedAt', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => issue(freshState(), { issuedAt: bad }), String(bad)).toThrow(RangeError)
    }
  })

  it('throws when issuing while an order is active (one-active semantics)', () => {
    let s = issue(freshState(), {})
    s = activateNext(s, AT + 1)
    expect(s.activeOrderId).toBe(s.orders[0].id)
    expect(() => issue(s, { type: 'move', target: target(), issuedAt: AT + 2 })).toThrow(Error)
  })

  it('throws RangeError for a negative or fractional index', () => {
    expect(() => issue(freshState(), { index: -1, issuedAt: AT })).toThrow(RangeError)
    expect(() => issue(freshState(), { index: 1.5, issuedAt: AT })).toThrow(RangeError)
  })

  it('requires expiresAt to be finite and strictly after issuedAt; null/greater accepted', () => {
    const ok = issue(freshState(), { expiresAt: AT + 1000, issuedAt: AT })
    expect(ok.orders[0].expiresAt).toBe(AT + 1000)
    for (const bad of [AT, AT - 1, NaN, Infinity]) {
      expect(() => issue(freshState(), { issuedAt: AT, expiresAt: bad }), String(bad)).toThrow(RangeError)
    }
  })

  it('does not mutate the input state and returns a fresh state', () => {
    const s0 = issue(freshState(), {})
    const order0 = s0.orders[0]
    const s1 = issue(s0, { type: 'defend', target: target('planet', 'home'), issuedAt: AT + 1 })
    expect(s0.orders).toHaveLength(1)
    expect(s0.orders[0].id).toBe(fnv1a('f1|move|1700000000000|0').toString(16))
    expect(s0.orders[0].status).toBe('issued')
    expect(ordersInvariants(s0).ok).toBe(true)
    expect(s1).not.toBe(s0)
    expect(s1.orders).not.toBe(s0.orders)
    expect(s1.orders[0]).toBe(order0)
    expect(s1.orders[0]).toEqual(s0.orders[0])
    expect(s1.orders[1].status).toBe('issued')
  })

  it('accepts planet, system and body target kinds for target-bearing orders', () => {
    for (const k of ['planet', 'system', 'body'] as const) {
      const s = issue(freshState(), { type: 'move', target: target(k, 'x-1'), issuedAt: AT })
      expect(s.orders[0].target).toEqual({ kind: k, id: 'x-1' })
    }
  })
})

describe('activateNext', () => {
  it('promotes the first issued order to active and sets activeOrderId', () => {
    let s = issue(freshState(), {})
    expect(s.activeOrderId).toBeNull()
    s = activateNext(s, AT + 1)
    expect(s.orders[0].status).toBe('active')
    expect(s.activeOrderId).toBe(s.orders[0].id)
    expect(ordersInvariants(s).ok).toBe(true)
  })

  it('activates queued orders FIFO via repeated activateNext after completion', () => {
    let s = issue(freshState(), { type: 'move', target: target(), issuedAt: AT })
    s = issue(s, { type: 'defend', target: target('planet', 'home'), issuedAt: AT + 1 })
    s = issue(s, { type: 'return', target: null, issuedAt: AT + 2 })
    s = activateNext(s, AT + 3)
    expect(s.activeOrderId).toBe(s.orders[0].id)
    s = completeOrder(s, s.orders[0].id, AT + 4)
    s = activateNext(s, AT + 5)
    expect(s.activeOrderId).toBe(s.orders[1].id)
    expect(s.orders[1].status).toBe('active')
    s = completeOrder(s, s.orders[1].id, AT + 6)
    s = activateNext(s, AT + 7)
    expect(s.activeOrderId).toBe(s.orders[2].id)
    expect(ordersInvariants(s).ok).toBe(true)
  })

  it('is a NO-OP when an active order exists or the queue has no issued orders', () => {
    let s = issue(freshState(), {})
    s = activateNext(s, AT + 1)
    expect(activateNext(s, AT + 2)).toBe(s)
    const empty = freshState()
    expect(activateNext(empty, AT)).toBe(empty)
  })

  it('throws RangeError for non-positive or non-finite at', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() => activateNext(freshState(), bad), String(bad)).toThrow(RangeError)
    }
  })
})

describe('completeOrder', () => {
  it('transitions active → done and clears activeOrderId', () => {
    let s = issue(freshState(), {})
    s = activateNext(s, AT + 1)
    s = completeOrder(s, s.orders[0].id, AT + 2)
    expect(s.orders[0].status).toBe('done')
    expect(s.activeOrderId).toBeNull()
    expect(ordersInvariants(s).ok).toBe(true)
  })

  it('throws when completing an order that is not active', () => {
    const issued = issue(freshState(), {})
    expect(() => completeOrder(issued, issued.orders[0].id, AT + 1)).toThrow(Error)
    let done = issue(freshState(), {})
    done = activateNext(done, AT + 1)
    done = completeOrder(done, done.orders[0].id, AT + 2)
    expect(() => completeOrder(done, done.orders[0].id, AT + 3)).toThrow(Error)
    let cancelled = issue(freshState(), {})
    cancelled = cancelOrder(cancelled, cancelled.orders[0].id, AT + 1)
    expect(() => completeOrder(cancelled, cancelled.orders[0].id, AT + 2)).toThrow(Error)
  })

  it('throws for an unknown order id', () => {
    const s = issue(freshState(), {})
    expect(() => completeOrder(s, 'ghost', AT + 1)).toThrow(Error)
  })

  it('validates at and does NOT auto-activate the next queued order', () => {
    let s = issue(freshState(), { type: 'move', target: target(), issuedAt: AT })
    s = issue(s, { type: 'defend', target: target('planet', 'home'), issuedAt: AT + 1 })
    s = activateNext(s, AT + 2)
    s = completeOrder(s, s.orders[0].id, AT + 3)
    expect(s.activeOrderId).toBeNull()
    expect(s.orders[1].status).toBe('issued')
    expect(() => completeOrder(s, s.orders[0].id, 0)).toThrow(RangeError)
  })
})

describe('cancelOrder', () => {
  it('transitions issued → cancelled and leaves activeOrderId null', () => {
    const s = issue(freshState(), {})
    const c = cancelOrder(s, s.orders[0].id, AT + 1)
    expect(c.orders[0].status).toBe('cancelled')
    expect(c.activeOrderId).toBeNull()
    expect(ordersInvariants(c).ok).toBe(true)
  })

  it('transitions active → cancelled and clears activeOrderId', () => {
    let s = issue(freshState(), {})
    s = activateNext(s, AT + 1)
    s = cancelOrder(s, s.orders[0].id, AT + 2)
    expect(s.orders[0].status).toBe('cancelled')
    expect(s.activeOrderId).toBeNull()
    expect(ordersInvariants(s).ok).toBe(true)
  })

  it('throws when cancelling a done or already-cancelled order', () => {
    let done = issue(freshState(), {})
    done = activateNext(done, AT + 1)
    done = completeOrder(done, done.orders[0].id, AT + 2)
    expect(() => cancelOrder(done, done.orders[0].id, AT + 3)).toThrow(Error)
    let cancelled = issue(freshState(), {})
    cancelled = cancelOrder(cancelled, cancelled.orders[0].id, AT + 1)
    expect(() => cancelOrder(cancelled, cancelled.orders[0].id, AT + 2)).toThrow(Error)
  })

  it('throws for an unknown order id and for non-positive at', () => {
    const s = issue(freshState(), {})
    expect(() => cancelOrder(s, 'ghost', AT + 1)).toThrow(Error)
    expect(() => cancelOrder(s, s.orders[0].id, 0)).toThrow(RangeError)
  })
})

describe('ordersInvariants', () => {
  it('passes for a valid multi-order state', () => {
    let s = issue(freshState(), { type: 'move', target: target(), issuedAt: AT, expiresAt: AT + 100 })
    s = issue(s, { type: 'defend', target: target('planet', 'home'), issuedAt: AT + 1 })
    s = issue(s, { type: 'return', target: null, issuedAt: AT + 2 })
    s = activateNext(s, AT + 3)
    s = completeOrder(s, s.orders[0].id, AT + 4)
    expect(ordersInvariants(s)).toEqual({ ok: true, problems: [] })
  })

  it('flags activeOrderId null while an order is active', () => {
    let s = issue(freshState(), {})
    s = activateNext(s, AT + 1)
    const tampered: FleetOrders = { ...s, activeOrderId: null }
    const r = ordersInvariants(tampered)
    expect(r.ok).toBe(false)
    expect(r.problems.some((p) => p.includes('active'))).toBe(true)
  })

  it('flags an activeOrderId that references a non-active or missing order', () => {
    let s = issue(freshState(), {})
    s = activateNext(s, AT + 1)
    s = completeOrder(s, s.orders[0].id, AT + 2)
    const nonActive: FleetOrders = { ...s, activeOrderId: s.orders[0].id }
    expect(ordersInvariants(nonActive).ok).toBe(false)
    const missing: FleetOrders = { ...s, activeOrderId: 'ghost' }
    expect(ordersInvariants(missing).ok).toBe(false)
  })

  it('flags duplicate order ids', () => {
    const s = issue(freshState(), {})
    const dup: FleetOrders = { ...s, orders: [s.orders[0], { ...s.orders[0] }] }
    const r = ordersInvariants(dup)
    expect(r.ok).toBe(false)
    expect(r.problems.some((p) => p.includes('duplicate'))).toBe(true)
  })

  it('flags an invalid status and a target-pairing violation', () => {
    const s = issue(freshState(), {})
    const badStatus: FleetOrders = {
      ...s,
      orders: [{ ...s.orders[0], status: 'flying' } as unknown as FleetOrder],
    }
    const r1 = ordersInvariants(badStatus)
    expect(r1.ok).toBe(false)
    expect(r1.problems.some((p) => p.includes('status'))).toBe(true)
    const ret = issue(freshState(), { type: 'return', target: null, issuedAt: AT })
    const badPairing: FleetOrders = {
      ...ret,
      orders: [{ ...ret.orders[0], target: target() }],
    }
    const r2 = ordersInvariants(badPairing)
    expect(r2.ok).toBe(false)
    expect(r2.problems.some((p) => p.includes('target'))).toBe(true)
  })

  it('flags expiresAt not strictly after issuedAt', () => {
    const s = issue(freshState(), { expiresAt: AT + 100, issuedAt: AT })
    const bad: FleetOrders = {
      ...s,
      orders: [{ ...s.orders[0], expiresAt: s.orders[0].issuedAt }],
    }
    const r = ordersInvariants(bad)
    expect(r.ok).toBe(false)
    expect(r.problems.some((p) => p.includes('expiresAt'))).toBe(true)
  })
})

describe('lifecycle', () => {
  it('full move lifecycle: issue → activate → complete → issue → activate → complete', () => {
    let s = freshState()
    s = issue(s, { type: 'move', target: target(), issuedAt: AT })
    s = activateNext(s, AT + 1)
    expect(s.orders[0].status).toBe('active')
    s = completeOrder(s, s.orders[0].id, AT + 2)
    expect(s.orders[0].status).toBe('done')
    expect(s.activeOrderId).toBeNull()
    s = issue(s, { type: 'defend', target: target('planet', 'home'), issuedAt: AT + 3 })
    s = activateNext(s, AT + 4)
    expect(s.activeOrderId).toBe(s.orders[1].id)
    s = completeOrder(s, s.orders[1].id, AT + 5)
    expect(s.orders[1].status).toBe('done')
    expect(ordersInvariants(s).ok).toBe(true)
  })

  it('attack orders are modeled and lifecycle-safe (resolution deferred to P7); return is origin-bound', () => {
    let s = issue(freshState(), { type: 'attack', target: target('body', 'enemy-fleet'), issuedAt: AT })
    expect(s.orders[0].type).toBe('attack')
    s = activateNext(s, AT + 1)
    expect(s.orders[0].status).toBe('active')
    s = completeOrder(s, s.orders[0].id, AT + 2)
    expect(s.orders[0].status).toBe('done')
    const r = issue(freshState(), { type: 'return', target: null, issuedAt: AT })
    expect(r.orders[0].type).toBe('return')
    expect(r.orders[0].target).toBeNull()
  })

  it('cancelling an active order unlocks the queue for the next issued order', () => {
    let s = issue(freshState(), { type: 'move', target: target(), issuedAt: AT })
    s = issue(s, { type: 'defend', target: target('planet', 'home'), issuedAt: AT + 1 })
    s = activateNext(s, AT + 2)
    s = cancelOrder(s, s.orders[0].id, AT + 3)
    expect(s.activeOrderId).toBeNull()
    s = activateNext(s, AT + 4)
    expect(s.activeOrderId).toBe(s.orders[1].id)
    expect(ordersInvariants(s).ok).toBe(true)
  })

  it('transitions return fresh states without mutating the prior state', () => {
    const s0 = issue(freshState(), { type: 'move', target: target(), issuedAt: AT })
    const s1 = activateNext(s0, AT + 1)
    const s2 = completeOrder(s1, s1.orders[0].id, AT + 2)
    expect(s0.orders[0].status).toBe('issued')
    expect(s1.orders[0].status).toBe('active')
    expect(s2.orders[0].status).toBe('done')
    expect(s0).not.toBe(s1)
    expect(s1).not.toBe(s2)
  })
})
