import { describe, expect, it } from 'vitest'
import {
  COMPOSITION_KEYS,
  FLEET_LOCATION_KINDS,
  FLEET_STATUSES,
  ORDER_STATUSES,
  ORDER_TYPES,
  ROUTE_GEOMETRY_EPSILON,
  TARGET_KINDS,
  TRAVEL_REF_KINDS,
  TRAVEL_STATUSES,
  deserializeFleetSnapshot,
  serializeFleetSnapshot,
  snapshotInvariants,
} from '../src/sim/fleet/persistence'
import type { FleetSnapshot } from '../src/sim/fleet/persistence'
import { activateNext, issueOrder } from '../src/sim/fleet/orders'
import type { FleetOrders } from '../src/sim/fleet/orders'
import { planRoute } from '../src/sim/fleet/routes'
import type { TravelRoute } from '../src/sim/fleet/routes'
import { arrivalTime } from '../src/sim/fleet/movement'
import type { Fleet } from '../src/sim/fleet/fleet'
import type { Position, TravelRef } from '../src/sim/fleet/movement'

const AT = 1_700_000_000_000

function fleet(overrides: Partial<Fleet> = {}): Fleet {
  return {
    id: 'fleet-1',
    ownerId: 'owner-1',
    name: 'First Fleet',
    composition: { scout: 2, corvette: 0, frigate: 1, cruiser: 0, battleship: 0 },
    location: { kind: 'planet', bodyId: 'home-1' },
    createdAt: AT,
    status: 'idle',
    ...overrides,
  }
}

function ordersState(overrides: Partial<FleetOrders> = {}): FleetOrders {
  return { fleetId: 'fleet-1', orders: [], activeOrderId: null, ...overrides }
}

function ordersWithQueue(): FleetOrders {
  let state = issueOrder(ordersState(), {
    type: 'move',
    target: { kind: 'system', id: 'sys-alpha' },
    issuedAt: AT,
    expiresAt: AT + 5000,
  })
  state = issueOrder(state, { type: 'return', target: null, issuedAt: AT + 1 })
  state = activateNext(state, AT + 1)
  return state
}

function pos(x: number, y: number, z: number): Position {
  return { x, y, z }
}

function ref(kind: 'planet' | 'system', bodyId: string): TravelRef {
  return { kind, bodyId }
}

function route(overrides: Partial<TravelRoute> = {}): TravelRoute {
  return {
    ...planRoute({
      fleetId: 'fleet-1',
      waypoints: [
        { ref: ref('planet', 'home-1'), position: pos(0, 0, 0) },
        { ref: ref('system', 'sys-alpha'), position: pos(3, 0, 0) },
        { ref: ref('system', 'sys-beta'), position: pos(3, 0, 5) },
      ],
      speedPcPerSec: 1.0,
      departureAt: AT,
    }),
    ...overrides,
  }
}

function secondRoute(): TravelRoute {
  return planRoute({
    fleetId: 'fleet-1',
    waypoints: [
      { ref: ref('planet', 'home-1'), position: pos(0, 0, 0) },
      { ref: ref('system', 'sys-gamma'), position: pos(4, 1, 0) },
    ],
    speedPcPerSec: 0.5,
    departureAt: AT + 100_000,
  })
}

function snapshot(overrides: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return {
    fleet: fleet(),
    orders: ordersWithQueue(),
    routes: [route()],
    ...overrides,
  }
}

function minimalSnapshot(): FleetSnapshot {
  return {
    fleet: {
      id: 'f1',
      ownerId: 'o1',
      name: 'Fleet',
      composition: { scout: 0, corvette: 0, frigate: 0, cruiser: 0, battleship: 0 },
      location: { kind: 'planet', bodyId: 'home' },
      createdAt: AT,
      status: 'idle',
    },
    orders: null,
    routes: [],
  }
}

describe('serializeFleetSnapshot', () => {
  it('is deterministic: identical snapshots produce byte-identical strings', () => {
    const a = serializeFleetSnapshot(snapshot())
    const b = serializeFleetSnapshot(snapshot())
    expect(a).toBe(b)
    expect(serializeFleetSnapshot(snapshot())).toBe(a)
  })

  it('keeps stable hand-ordered keys (pinned exact string)', () => {
    expect(serializeFleetSnapshot(minimalSnapshot())).toBe(
      '{"fleet":{"id":"f1","ownerId":"o1","name":"Fleet",' +
        '"composition":{"scout":0,"corvette":0,"frigate":0,"cruiser":0,"battleship":0},' +
        '"location":{"kind":"planet","bodyId":"home"},"createdAt":1700000000000,' +
        '"status":"idle"},"orders":null,"routes":[]}',
    )
  })

  it('serializes null orders (never omits the key)', () => {
    const json = serializeFleetSnapshot(minimalSnapshot())
    expect(JSON.parse(json).orders).toBeNull()
    expect(json).toContain('"orders":null')
  })

  it('serializes a null expiresAt and null target as null', () => {
    const state = ordersWithQueue()
    expect(state.orders[1].target).toBeNull()
    expect(state.orders[0].expiresAt).toBe(AT + 5000)
    expect(state.orders[1].expiresAt).toBeNull()
    const parsed = JSON.parse(serializeFleetSnapshot(snapshot())) as {
      orders: { orders: Array<{ expiresAt: number | null; target: unknown }> }
    }
    expect(parsed.orders.orders[0].expiresAt).toBe(AT + 5000)
    expect(parsed.orders.orders[1].expiresAt).toBeNull()
    expect(parsed.orders.orders[1].target).toBeNull()
  })

  it('throws on an invalid snapshot (corrupted composition)', () => {
    const bad = snapshot({
      fleet: { ...fleet(), composition: { ...fleet().composition, scout: -1 } },
    })
    expect(() => serializeFleetSnapshot(bad)).toThrow(Error)
    expect(snapshotInvariants(bad).ok).toBe(false)
  })

  it('throws on an invalid snapshot (dangling activeOrderId)', () => {
    const state = ordersWithQueue()
    const dangling = { ...state, activeOrderId: 'does-not-exist' }
    expect(() => serializeFleetSnapshot(snapshot({ orders: dangling }))).toThrow(Error)
  })

  it('throws on a snapshot whose routes reference another fleet', () => {
    const orphan = snapshot({
      routes: [{ ...route(), fleetId: 'other-fleet' }],
    })
    expect(() => serializeFleetSnapshot(orphan)).toThrow(Error)
  })
})

describe('deserializeFleetSnapshot', () => {
  it('round-trips a full snapshot (orders queue + multi-route)', () => {
    const input = snapshot({ routes: [route(), secondRoute()] })
    const restored = deserializeFleetSnapshot(serializeFleetSnapshot(input))
    expect(restored).toEqual(input)
  })

  it('round-trips with null orders and empty routes', () => {
    const input = minimalSnapshot()
    expect(deserializeFleetSnapshot(serializeFleetSnapshot(input))).toEqual(input)
  })

  it('round-trips an empty orders queue and an empty fleet composition', () => {
    const input = snapshot({
      fleet: { ...fleet(), composition: { scout: 0, corvette: 0, frigate: 0, cruiser: 0, battleship: 0 } },
      orders: ordersState(),
    })
    expect(deserializeFleetSnapshot(serializeFleetSnapshot(input))).toEqual(input)
  })

  it('round-trips a fleet in traveling status with an active order', () => {
    const input = snapshot({
      fleet: { ...fleet(), status: 'traveling' },
    })
    expect(input.orders?.activeOrderId).not.toBeNull()
    const restored = deserializeFleetSnapshot(serializeFleetSnapshot(input))
    expect(restored).toEqual(input)
    expect(restored.orders?.activeOrderId).toBe(input.orders?.activeOrderId)
  })

  it('rejects malformed JSON (including trailing content)', () => {
    for (const bad of ['not json', '', '{', '{"fleet":1} trailing', 'null x']) {
      expect(() => deserializeFleetSnapshot(bad), JSON.stringify(bad)).toThrow(
        /not valid JSON/,
      )
    }
  })

  it('rejects non-JSON numeric literals (NaN/Infinity are not JSON)', () => {
    expect(() =>
      deserializeFleetSnapshot('{"fleet":{"createdAt":NaN}}'),
    ).toThrow(/not valid JSON/)
    expect(() =>
      deserializeFleetSnapshot('{"fleet":{"createdAt":Infinity}}'),
    ).toThrow(/not valid JSON/)
  })

  it('rejects a non-object root', () => {
    for (const bad of ['null', '42', '"x"', '[]']) {
      expect(() => deserializeFleetSnapshot(bad), bad).toThrow(/invalid fleet snapshot/)
    }
  })

  it('rejects a missing required key', () => {
    const parsed = JSON.parse(serializeFleetSnapshot(minimalSnapshot())) as Record<string, unknown>
    delete parsed.routes
    expect(() => deserializeFleetSnapshot(JSON.stringify(parsed))).toThrow(
      /missing key 'routes'/,
    )
  })

  it('rejects an unexpected key (strict exact-key parse)', () => {
    const parsed = JSON.parse(serializeFleetSnapshot(minimalSnapshot())) as Record<string, unknown>
    parsed.extra = 1
    expect(() => deserializeFleetSnapshot(JSON.stringify(parsed))).toThrow(
      /unexpected key 'extra'/,
    )
  })

  it('rejects wrong shapes (fleet.composition not an object)', () => {
    const parsed = JSON.parse(serializeFleetSnapshot(minimalSnapshot())) as {
      fleet: Record<string, unknown>
    }
    parsed.fleet.composition = 'not-a-composition'
    expect(() => deserializeFleetSnapshot(JSON.stringify(parsed))).toThrow(
      /fleet\.composition must be an object/,
    )
  })

  it('rejects wrong shapes (route waypoints not an array)', () => {
    const routes = JSON.parse(serializeFleetSnapshot(snapshot())) as {
      routes: Array<Record<string, unknown>>
    }
    routes.routes[0].waypoints = {}
    const payload = { fleet: fleet(), orders: null, routes: routes.routes }
    expect(() => deserializeFleetSnapshot(JSON.stringify(payload))).toThrow(
      /waypoints must be an array/,
    )
  })

  it('rejects a non-object order entry', () => {
    const parsed = JSON.parse(serializeFleetSnapshot(snapshot())) as {
      orders: { orders: unknown[] }
    }
    parsed.orders.orders = [42]
    expect(() => deserializeFleetSnapshot(JSON.stringify(parsed))).toThrow(
      /orders\.orders\[0\] must be an object/,
    )
  })

  it('rejects an invariant violation (dangling activeOrderId)', () => {
    const state = ordersWithQueue()
    const dangling = { ...state, activeOrderId: 'does-not-exist' }
    const payload = { fleet: fleet(), orders: dangling, routes: [] }
    const json = JSON.stringify(payload)
    expect(snapshotInvariants(payload).ok).toBe(false)
    expect(() => deserializeFleetSnapshot(json)).toThrow(/invariant violation/)
  })

  it('rejects an invariant violation (orders.fleetId mismatch)', () => {
    const payload = {
      fleet: fleet(),
      orders: { ...ordersWithQueue(), fleetId: 'other-fleet' },
      routes: [],
    }
    expect(() => deserializeFleetSnapshot(JSON.stringify(payload))).toThrow(
      /must equal fleet\.id/,
    )
  })

  it('rejects an invariant violation (leg fleetId differs from the route)', () => {
    const good = route()
    const payload = {
      fleet: fleet(),
      orders: null,
      routes: [
        {
          ...good,
          legs: good.legs.map((leg, i) =>
            i === 0 ? { ...leg, fleetId: 'intruder' } : leg,
          ),
        },
      ],
    }
    expect(snapshotInvariants(payload).ok).toBe(false)
    expect(() => deserializeFleetSnapshot(JSON.stringify(payload))).toThrow(
      /invariant violation/,
    )
  })

  it('rejects an invariant violation (corrupted composition)', () => {
    const payload = {
      fleet: { ...fleet(), composition: { ...fleet().composition, battleship: -3 } },
      orders: null,
      routes: [],
    }
    expect(() => deserializeFleetSnapshot(JSON.stringify(payload))).toThrow(
      /non-negative integer/,
    )
  })

  it('rejects an invariant violation (route arrival before departure)', () => {
    const payload = {
      fleet: fleet(),
      orders: null,
      routes: [{ ...route(), arrivalAt: route().departureAt - 1 }],
    }
    expect(() => deserializeFleetSnapshot(JSON.stringify(payload))).toThrow(
      /strictly after departureAt/,
    )
  })

  it('rejects an invariant violation (inconsistent route totals)', () => {
    const payload = {
      fleet: fleet(),
      orders: null,
      routes: [{ ...route(), totalDistancePc: 999 }],
    }
    expect(() => deserializeFleetSnapshot(JSON.stringify(payload))).toThrow(
      /must equal the sum of leg distances/,
    )
  })
})

describe('snapshotInvariants', () => {
  it('accepts a canonical snapshot', () => {
    expect(snapshotInvariants(snapshot())).toEqual({ ok: true, problems: [] })
  })

  it('accepts null orders and empty routes', () => {
    expect(snapshotInvariants(minimalSnapshot()).ok).toBe(true)
  })

  it('rejects a corrupted fleet composition', () => {
    const bad = snapshot({
      fleet: { ...fleet(), composition: { ...fleet().composition, frigate: -1 } },
    })
    const result = snapshotInvariants(bad)
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('frigate')
  })

  it('rejects a dangling activeOrderId', () => {
    const state = ordersWithQueue()
    const bad = snapshot({ orders: { ...state, activeOrderId: 'ghost' } })
    expect(snapshotInvariants(bad).ok).toBe(false)
  })

  it('rejects orders whose fleetId differs from fleet.id', () => {
    const bad = snapshot({
      orders: { ...ordersWithQueue(), fleetId: 'another-fleet' },
    })
    const result = snapshotInvariants(bad)
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('orders.fleetId')
  })

  it('rejects a route with fewer than 2 waypoints', () => {
    const bad = snapshot({ routes: [{ ...route(), waypoints: route().waypoints.slice(0, 1) }] })
    const result = snapshotInvariants(bad)
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('at least 2 waypoints')
  })

  it('rejects a route whose leg count differs from waypoints - 1', () => {
    const bad = snapshot({ routes: [{ ...route(), legs: [] }] })
    const result = snapshotInvariants(bad)
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('leg count must equal waypoints - 1')
  })

  it('rejects a route with inconsistent totals', () => {
    const bad = snapshot({ routes: [{ ...route(), totalDurationSec: 999 }] })
    const result = snapshotInvariants(bad)
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('totalDurationSec')
  })

  it('rejects a route whose arrivalAt is not after departureAt', () => {
    const bad = snapshot({
      routes: [{ ...route(), arrivalAt: route().departureAt - 1 }],
    })
    const result = snapshotInvariants(bad)
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('strictly after departureAt')
  })

  it('rejects a route referencing another fleet', () => {
    const bad = snapshot({ routes: [{ ...route(), fleetId: 'intruder' }] })
    const result = snapshotInvariants(bad)
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('routes[0].fleetId')
  })

  it('rejects a route whose leg fleetId differs from the route fleet', () => {
    const good = route()
    const bad = snapshot({
      routes: [
        {
          ...good,
          legs: good.legs.map((leg, i) =>
            i === 0 ? { ...leg, fleetId: 'intruder' } : leg,
          ),
        },
      ],
    })
    const result = snapshotInvariants(bad)
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('must equal route.fleetId')
  })

  it('rejects a broken sequential-leg chain', () => {
    const good = route()
    const broken = {
      ...good,
      legs: good.legs.map((leg, i) =>
        i === 1 ? { ...leg, departureAt: leg.departureAt + 1 } : leg,
      ),
    }
    expect(snapshotInvariants(snapshot({ routes: [broken] })).ok).toBe(false)
  })

  it('rejects an invalid leg status', () => {
    const good = route()
    const broken = {
      ...good,
      legs: good.legs.map((leg, i) =>
        i === 0 ? { ...leg, status: 'warping' as never } : leg,
      ),
    }
    expect(snapshotInvariants(snapshot({ routes: [broken] })).ok).toBe(false)
  })

  it('does not throw on garbage-shaped input (reports problems instead)', () => {
    const garbage = { fleet: 42, orders: 'x', routes: [7] } as unknown as FleetSnapshot
    const result = snapshotInvariants(garbage)
    expect(result.ok).toBe(false)
    expect(result.problems.length).toBeGreaterThan(0)
  })
})

describe('module-level lookup tables are deep-frozen (finding 6)', () => {
  it('every persistence lookup table is frozen', () => {
    for (const table of [
      FLEET_STATUSES,
      FLEET_LOCATION_KINDS,
      ORDER_TYPES,
      ORDER_STATUSES,
      TARGET_KINDS,
      TRAVEL_REF_KINDS,
      TRAVEL_STATUSES,
      COMPOSITION_KEYS,
    ]) {
      expect(Object.isFrozen(table)).toBe(true)
    }
    expect(ROUTE_GEOMETRY_EPSILON).toBe(1e-9)
  })

  it('mutating a frozen table throws TypeError (runtime-immutable)', () => {
    expect(() => {
      ;(FLEET_STATUSES as unknown as string[]).push('flying')
    }).toThrow(TypeError)
    expect(() => {
      ;(COMPOSITION_KEYS as unknown as string[]).push('dreadnought')
    }).toThrow(TypeError)
  })
})

describe('route geometry invariants (finding 4)', () => {
  it('rejects a leg whose `to` ref points elsewhere than its waypoint (A→C leg on A→B waypoints)', () => {
    const good = route()
    const corrupt = {
      ...good,
      legs: good.legs.map((leg, i) =>
        i === 0 ? { ...leg, to: ref('system', 'sys-beta') } : leg,
      ),
    }
    const result = snapshotInvariants(snapshot({ routes: [corrupt] }))
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('must equal waypoints[1].ref')
  })

  it('rejects a leg whose `from` ref points elsewhere than its waypoint', () => {
    const good = route()
    const corrupt = {
      ...good,
      legs: good.legs.map((leg, i) =>
        i === 0 ? { ...leg, from: ref('system', 'sys-gamma') } : leg,
      ),
    }
    const result = snapshotInvariants(snapshot({ routes: [corrupt] }))
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('must equal waypoints[0].ref')
  })

  it('rejects a leg distance that contradicts the waypoint geometry even when the totals agree', () => {
    const good = route()
    const corrupt = {
      ...good,
      legs: good.legs.map((leg, i) =>
        i === 0
          ? { ...leg, distancePc: 4, arrivalAt: leg.departureAt + 4 * 1000 }
          : leg,
      ),
      totalDistancePc: 4 + good.legs[1].distancePc,
      totalDurationSec: 4 + good.legs[1].distancePc,
    }
    const result = snapshotInvariants(snapshot({ routes: [corrupt] }))
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('within a relative epsilon')
  })

  it('rejects an arrival timestamp that does not match the recomputed arrival', () => {
    const good = route()
    const leg0 = good.legs[0]
    const leg1 = good.legs[1]
    const corrupt = {
      ...good,
      legs: [
        { ...leg0, arrivalAt: leg0.arrivalAt + 1 },
        { ...leg1, departureAt: leg0.arrivalAt + 1, arrivalAt: leg1.arrivalAt + 1 },
      ],
      arrivalAt: good.arrivalAt + 1,
    }
    const result = snapshotInvariants(snapshot({ routes: [corrupt] }))
    expect(result.ok).toBe(false)
    expect(result.problems.join('; ')).toContain('must equal arrivalTime')
  })

  it('keeps the epsilon relative: a tiny distance drift within 1e-9 passes', () => {
    const good = route()
    const leg0 = good.legs[0]
    const leg1 = good.legs[1]
    const drift = leg0.distancePc * (1 + ROUTE_GEOMETRY_EPSILON / 2)
    const arrival0 = arrivalTime(leg0.departureAt, drift, leg0.speedPcPerSec)
    const arrival1 = arrivalTime(arrival0, leg1.distancePc, leg1.speedPcPerSec)
    const corrupt = {
      ...good,
      legs: [
        { ...leg0, distancePc: drift, arrivalAt: arrival0 },
        { ...leg1, departureAt: arrival0, arrivalAt: arrival1 },
      ],
      totalDistancePc: drift + leg1.distancePc,
      totalDurationSec: drift + leg1.distancePc,
      arrivalAt: arrival1,
    }
    const result = snapshotInvariants(snapshot({ routes: [corrupt] }))
    expect(result.ok).toBe(true)
  })

  it('deserialize also rejects the corrupted A→C route geometry (deep pass re-runs the invariants)', () => {
    const good = route()
    const corrupt = {
      ...good,
      legs: good.legs.map((leg, i) =>
        i === 0 ? { ...leg, to: ref('system', 'sys-beta') } : leg,
      ),
    }
    const payload = { fleet: fleet(), orders: null, routes: [corrupt] }
    expect(snapshotInvariants(payload).ok).toBe(false)
    expect(() => deserializeFleetSnapshot(JSON.stringify(payload))).toThrow(
      /invariant violation/,
    )
  })
})
