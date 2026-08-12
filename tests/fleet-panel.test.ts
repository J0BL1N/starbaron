import { describe, expect, it } from 'vitest'
import { fleetCompositionSize } from '../src/sim/fleet/fleet'
import type { Fleet, FleetComposition } from '../src/sim/fleet/fleet'
import type { TravelLeg } from '../src/sim/fleet/movement'
import type {
  FleetOrder,
  FleetOrderStatus,
  FleetOrderTarget,
  FleetOrderTargetKind,
  FleetOrders,
  FleetOrderType,
} from '../src/sim/fleet/orders'
import type { PositionedFleet } from '../src/sim/fleet/positioning'
import { fleetLabel } from '../src/sim/fleet/render-state'
import { SHIP_CLASSES, SHIP_CLASS_IDS } from '../src/sim/fleet/ships'
import {
  EN_ROUTE_LOCATION,
  fleetDetailState,
  fleetListState,
  fleetPanelState,
} from '../src/sim/ui/fleet-panel'
import type { FleetListRow, FleetPanelState } from '../src/sim/ui/fleet-panel'

const AT = 1_700_000_000_000

const MIXED_COMPOSITION: FleetComposition = {
  scout: 4,
  corvette: 2,
  frigate: 0,
  cruiser: 1,
  battleship: 0,
}

function fleet(overrides: Partial<Fleet> = {}): Fleet {
  const base: Fleet = {
    id: 'fleet-a',
    ownerId: 'owner-1',
    name: 'Vanguard',
    composition: { ...MIXED_COMPOSITION },
    location: { kind: 'planet', bodyId: 'home-1' },
    createdAt: AT,
    status: 'idle',
  }
  return {
    ...base,
    ...overrides,
    composition: { ...base.composition, ...(overrides.composition ?? {}) },
    location: { ...base.location, ...(overrides.location ?? {}) },
  }
}

function ref(
  kind: 'planet' | 'system',
  bodyId: string,
): { kind: 'planet' | 'system'; bodyId: string } {
  return { kind, bodyId }
}

function leg(
  fleetId: string,
  toRef: { kind: 'planet' | 'system'; bodyId: string },
  status: TravelLeg['status'] = 'traveling',
): TravelLeg {
  return {
    fleetId,
    from: { kind: 'planet', bodyId: 'home-1' },
    to: { ...toRef },
    distancePc: 10,
    speedPcPerSec: 1,
    departureAt: AT,
    arrivalAt: AT + 10_000,
    status,
  }
}

function positioned(
  fleetId: string,
  phase: PositionedFleet['position']['phase'] = 'at-origin',
  progress = 0,
  legValue: TravelLeg | null = null,
): PositionedFleet {
  return { fleetId, position: { x: 0, y: 0, z: 0, phase, progress }, leg: legValue }
}

function target(
  kind: FleetOrderTargetKind = 'planet',
  id = 't-1',
): FleetOrderTarget {
  return { kind, id }
}

function order(
  id: string,
  type: FleetOrderType,
  status: FleetOrderStatus,
  targetValue: FleetOrderTarget | null = null,
): FleetOrder {
  return {
    id,
    fleetId: 'fleet-a',
    type,
    target: targetValue,
    issuedAt: AT,
    status,
    expiresAt: null,
  }
}

function orders(entries: readonly FleetOrder[], activeOrderId: string | null = null): FleetOrders {
  return { fleetId: 'fleet-a', orders: [...entries], activeOrderId }
}

function listMap(fleets: readonly Fleet[]): ReadonlyMap<string, PositionedFleet> {
  return new Map(fleets.map((f) => [f.id, positioned(f.id)]))
}

function ordersMap(...entries: FleetOrders[]): ReadonlyMap<string, FleetOrders> {
  return new Map(entries.map((o) => [o.fleetId, o]))
}

function list(
  fleets: readonly Fleet[],
  positionedMap: ReadonlyMap<string, PositionedFleet> = listMap(fleets),
): FleetListRow[] {
  return fleetListState({ fleets, positioned: positionedMap, orders: new Map(), at: AT })
}

describe('fleetListState — rows', () => {
  it('emits one row per fleet with the deterministic unprefixed fleetLabel', () => {
    const a = fleet({ id: 'fleet-a', name: 'Vanguard' })
    const b = fleet({ id: 'fleet-b', name: 'Reaper' })
    const rows = list([a, b])
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      const f = row.fleetId === 'fleet-a' ? a : b
      expect(row.label).toBe(fleetLabel(f))
      expect(row.label).toBe(`Fleet ${f.id.slice(0, 8)}`)
    }
  })

  it('size is fleetCompositionSize of the composition; status is the fleet status verbatim', () => {
    const a = fleet()
    expect(list([a])[0].size).toBe(fleetCompositionSize(a.composition))
    expect(list([a])[0].size).toBe(7)
    for (const status of ['idle', 'traveling', 'combat', 'returning'] as const) {
      const row = list([fleet({ status })])[0]
      expect(row.status).toBe(status)
    }
  })

  it("location at-origin is the fleet's location ref string (no leg, or a pending leg)", () => {
    const a = fleet({ location: { kind: 'system', bodyId: 'sys-1' } })
    expect(list([a])[0].location).toBe('system:sys-1')
    const pending = new Map([
      [a.id, positioned(a.id, 'at-origin', 0, leg(a.id, ref('system', 'sys-9')))],
    ])
    expect(list([a], pending)[0].location).toBe('system:sys-1')
  })

  it("location at-destination is the active leg's to ref string", () => {
    const a = fleet()
    const arrived = new Map([
      [a.id, positioned(a.id, 'at-destination', 1, leg(a.id, ref('system', 'sys-9')))],
    ])
    expect(list([a], arrived)[0].location).toBe('system:sys-9')
  })

  it("location traveling is the 'en route' form", () => {
    const a = fleet()
    const moving = new Map([
      [a.id, positioned(a.id, 'traveling', 0.5, leg(a.id, ref('system', 'sys-9')))],
    ])
    expect(list([a], moving)[0].location).toBe(EN_ROUTE_LOCATION)
  })

  it('phase mirrors the positioned phase for every phase', () => {
    const a = fleet()
    const cases: Array<
      [PositionedFleet['position']['phase'], TravelLeg | null, number]
    > = [
      ['at-origin', null, 0],
      ['traveling', leg(a.id, ref('system', 'sys-9')), 0.5],
      ['at-destination', leg(a.id, ref('system', 'sys-9')), 1],
    ]
    for (const [phase, legValue, progress] of cases) {
      const row = list([a], new Map([[a.id, positioned(a.id, phase, progress, legValue)]]))[0]
      expect(row.phase).toBe(phase)
    }
  })

  it('no positioned entry → phase at-origin and location = the fleet location ref (fallback)', () => {
    const a = fleet({ status: 'traveling' })
    const rows = fleetListState({
      fleets: [a],
      positioned: new Map(),
      orders: new Map(),
      at: AT,
    })
    expect(rows[0].phase).toBe('at-origin')
    expect(rows[0].location).toBe('planet:home-1')
  })
})

describe('fleetListState — ordering, determinism, validation', () => {
  it('orders rows by fleetId ascending regardless of input order', () => {
    const z = fleet({ id: 'fleet-z' })
    const a = fleet({ id: 'fleet-a' })
    const m = fleet({ id: 'fleet-m' })
    expect(list([z, a, m]).map((r) => r.fleetId)).toEqual([
      'fleet-a',
      'fleet-m',
      'fleet-z',
    ])
  })

  it('never mutates the input fleets array and is deterministic', () => {
    const z = fleet({ id: 'fleet-z' })
    const a = fleet({ id: 'fleet-a' })
    const fleets = [z, a]
    const positionedMap = listMap(fleets)
    const before = structuredClone(fleets)
    const input = { fleets, positioned: positionedMap, orders: new Map<string, FleetOrders>(), at: AT }
    expect(fleetListState(input)).toEqual(fleetListState(input))
    expect(fleets).toEqual(before)
  })

  it('throws RangeError for a non-positive or non-finite at', () => {
    const a = fleet()
    for (const bad of [0, -5, NaN, Infinity, -Infinity]) {
      expect(() =>
        fleetListState({
          fleets: [a],
          positioned: new Map(),
          orders: new Map(),
          at: bad,
        }),
      ).toThrow(RangeError)
    }
  })
})

describe('fleetDetailState — composition and position', () => {
  it('composition rows follow the SHIP_CLASS_IDS order with names from the roster', () => {
    const detail = fleetDetailState({
      fleet: fleet(),
      positioned: positioned('fleet-a'),
      orders: null,
      at: AT,
    })
    expect(detail.composition.map((row) => row.id)).toEqual(SHIP_CLASS_IDS)
    for (const row of detail.composition) {
      expect(row.name).toBe(SHIP_CLASSES[row.id].name)
    }
  })

  it('composition counts mirror the composition, including zero-count classes', () => {
    const f = fleet()
    const detail = fleetDetailState({
      fleet: f,
      positioned: positioned(f.id),
      orders: null,
      at: AT,
    })
    expect(detail.composition).toHaveLength(SHIP_CLASS_IDS.length)
    for (const row of detail.composition) {
      expect(row.count).toBe(f.composition[row.id])
    }
    expect(detail.composition.find((r) => r.id === 'frigate')?.count).toBe(0)
  })

  it('label, size and status delegate to fleetLabel, fleetCompositionSize and the fleet', () => {
    const f = fleet({ id: 'fleet-x', status: 'combat' })
    const detail = fleetDetailState({
      fleet: f,
      positioned: positioned(f.id),
      orders: null,
      at: AT,
    })
    expect(detail.fleetId).toBe('fleet-x')
    expect(detail.label).toBe(fleetLabel(f))
    expect(detail.size).toBe(fleetCompositionSize(f.composition))
    expect(detail.status).toBe('combat')
  })

  it('position passes the positioned phase and progress through verbatim', () => {
    const p = positioned('fleet-a', 'traveling', 0.75, leg('fleet-a', ref('system', 'sys-9')))
    const detail = fleetDetailState({
      fleet: fleet(),
      positioned: p,
      orders: null,
      at: AT,
    })
    expect(detail.position).toEqual({ phase: 'traveling', progress: 0.75 })
  })
})

describe('fleetDetailState — active order and queue', () => {
  it('activeOrder is null when orders is null and when no order is active', () => {
    const noOrders = fleetDetailState({
      fleet: fleet(),
      positioned: positioned('fleet-a'),
      orders: null,
      at: AT,
    })
    expect(noOrders.activeOrder).toBeNull()
    const issuedOnly = orders([order('o-1', 'move', 'issued', target())], null)
    const noActive = fleetDetailState({
      fleet: fleet(),
      positioned: positioned('fleet-a'),
      orders: issuedOnly,
      at: AT,
    })
    expect(noActive.activeOrder).toBeNull()
  })

  it('activeOrder comes from activeOrderId: type, target string and status', () => {
    const active = order('o-active', 'attack', 'active', target('body', 'enemy-5'))
    const state = orders(
      [order('o-queued', 'move', 'issued', target('planet', 'p-1')), active],
      'o-active',
    )
    const detail = fleetDetailState({
      fleet: fleet(),
      positioned: positioned('fleet-a'),
      orders: state,
      at: AT,
    })
    expect(detail.activeOrder).toEqual({
      type: 'attack',
      target: 'body:enemy-5',
      status: 'active',
    })
  })

  it("a 'return' order's active target is the literal 'origin'", () => {
    const state = orders([order('o-active', 'return', 'active', null)], 'o-active')
    const detail = fleetDetailState({
      fleet: fleet(),
      positioned: positioned('fleet-a'),
      orders: state,
      at: AT,
    })
    expect(detail.activeOrder).toEqual({ type: 'return', target: 'origin', status: 'active' })
  })

  it('a dangling activeOrderId throws RangeError', () => {
    const state = orders([], 'ghost-order')
    expect(() =>
      fleetDetailState({
        fleet: fleet(),
        positioned: positioned('fleet-a'),
        orders: state,
        at: AT,
      }),
    ).toThrow(RangeError)
  })

  it('queuedOrders counts issued orders only; 0 when orders is null', () => {
    const noOrders = fleetDetailState({
      fleet: fleet(),
      positioned: positioned('fleet-a'),
      orders: null,
      at: AT,
    })
    expect(noOrders.queuedOrders).toBe(0)
    const state = orders(
      [
        order('o-1', 'move', 'issued', target('planet', 'p-1')),
        order('o-2', 'defend', 'issued', target('system', 'sys-9')),
        order('o-3', 'move', 'done', target('planet', 'p-1')),
        order('o-4', 'move', 'cancelled', target('planet', 'p-1')),
        order('o-active', 'attack', 'active', target('body', 'enemy-5')),
      ],
      'o-active',
    )
    const detail = fleetDetailState({
      fleet: fleet(),
      positioned: positioned('fleet-a'),
      orders: state,
      at: AT,
    })
    expect(detail.queuedOrders).toBe(2)
  })
})

describe('fleetDetailState — determinism and validation', () => {
  it('is deterministic and never mutates the fleet or orders inputs', () => {
    const f = fleet()
    const o = orders([order('o-active', 'move', 'active', target('planet', 'p-1'))], 'o-active')
    const p = positioned(f.id)
    const input = { fleet: f, positioned: p, orders: o, at: AT }
    const before = structuredClone(input)
    expect(fleetDetailState(input)).toEqual(fleetDetailState(input))
    expect(input).toEqual(before)
  })

  it('throws RangeError for a non-positive or non-finite at', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() =>
        fleetDetailState({
          fleet: fleet(),
          positioned: positioned('fleet-a'),
          orders: null,
          at: bad,
        }),
      ).toThrow(RangeError)
    }
  })
})

describe('fleetPanelState — selection and composition', () => {
  function panel(
    fleets: readonly Fleet[],
    positionedMap: ReadonlyMap<string, PositionedFleet>,
    ordersEntries: ReadonlyMap<string, FleetOrders>,
    selectedFleetId?: string | null,
  ): FleetPanelState {
    return fleetPanelState({
      fleets,
      positioned: positionedMap,
      orders: ordersEntries,
      selectedFleetId,
      at: AT,
    })
  }

  it('list equals fleetListState and the rows are sorted', () => {
    const z = fleet({ id: 'fleet-z' })
    const a = fleet({ id: 'fleet-a' })
    const fleets = [z, a]
    const p = listMap(fleets)
    const state = panel(fleets, p, new Map())
    expect(state.fleets).toEqual(
      fleetListState({ fleets, positioned: p, orders: new Map(), at: AT }),
    )
    expect(state.fleets.map((r) => r.fleetId)).toEqual(['fleet-a', 'fleet-z'])
  })

  it('selectedFleetId passes through and selected equals fleetDetailState for a present, positioned fleet', () => {
    const a = fleet({ id: 'fleet-a' })
    const b = fleet({ id: 'fleet-b' })
    const fleets = [a, b]
    const p = new Map([
      [a.id, positioned(a.id, 'traveling', 0.5, leg(a.id, ref('system', 'sys-9')))],
    ])
    const o = ordersMap(orders([order('o-1', 'move', 'issued', target())], null))
    const state = panel(fleets, p, o, 'fleet-a')
    expect(state.selectedFleetId).toBe('fleet-a')
    expect(state.selected).toEqual(
      fleetDetailState({
        fleet: a,
        positioned: p.get(a.id)!,
        orders: o.get(a.id) ?? null,
        at: AT,
      }),
    )
    expect(state.selected!.position.phase).toBe('traveling')
    expect(state.selected!.activeOrder).toBeNull()
    expect(state.selected!.queuedOrders).toBe(1)
  })

  it('selection is null when no selectedFleetId is given or it is explicitly null', () => {
    const a = fleet()
    const p = listMap([a])
    expect(panel([a], p, new Map()).selectedFleetId).toBeNull()
    expect(panel([a], p, new Map(), null).selectedFleetId).toBeNull()
    expect(panel([a], p, new Map()).selected).toBeNull()
  })

  it('selection is null when the id is not in the fleet list', () => {
    const a = fleet()
    const state = panel([a], listMap([a]), new Map(), 'ghost-fleet')
    expect(state.selectedFleetId).toBeNull()
    expect(state.selected).toBeNull()
  })

  it('selection is null when the selected fleet has no positioned entry (edge)', () => {
    const a = fleet()
    const state = fleetPanelState({
      fleets: [a],
      positioned: new Map(),
      orders: new Map(),
      selectedFleetId: 'fleet-a',
      at: AT,
    })
    expect(state.selectedFleetId).toBe('fleet-a')
    expect(state.selected).toBeNull()
  })

  it('an absent orders map entry yields activeOrder null and queuedOrders 0 in the selected detail (edge)', () => {
    const a = fleet()
    const state = panel([a], listMap([a]), new Map(), 'fleet-a')
    expect(state.selected).not.toBeNull()
    expect(state.selected!.activeOrder).toBeNull()
    expect(state.selected!.queuedOrders).toBe(0)
  })
})

describe('fleetPanelState — determinism and validation', () => {
  it('is deterministic and never mutates inputs', () => {
    const a = fleet()
    const fleets = [a]
    const p = listMap(fleets)
    const input = {
      fleets,
      positioned: p,
      orders: new Map<string, FleetOrders>(),
      selectedFleetId: 'fleet-a' as string | null | undefined,
      at: AT,
    }
    const before = structuredClone(input)
    expect(fleetPanelState(input)).toEqual(fleetPanelState(input))
    expect(input).toEqual(before)
  })

  it('throws RangeError for a non-positive or non-finite at (even with an empty fleet list)', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() =>
        fleetPanelState({
          fleets: [],
          positioned: new Map(),
          orders: new Map(),
          at: bad,
        }),
      ).toThrow(RangeError)
    }
  })
})
