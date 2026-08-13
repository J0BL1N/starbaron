import { describe, expect, it } from 'vitest'
import { SHIP_CLASSES, SHIP_CLASS_IDS } from '../src/sim/fleet/ships'
import {
  FLEET_LOCATION_KINDS,
  FLEET_STATUSES,
  createFleet,
  fleetCompositionCost,
  fleetCompositionSize,
  fleetInvariants,
} from '../src/sim/fleet/fleet'
import type { Fleet, FleetComposition, FleetCreationRequest, FleetLocation } from '../src/sim/fleet/fleet'
import { fnv1a } from '../src/sim/planets/hash'
import { shipyardStateFor } from '../src/sim/fleet/shipyard'
import type { WalletState } from '../src/sim/player/types'

const AT = 1_700_000_000_000

function composition(overrides: Partial<FleetComposition> = {}): FleetComposition {
  return { scout: 0, corvette: 0, frigate: 0, cruiser: 0, battleship: 0, ...overrides }
}

function wallet(credits: number, alloys: number): WalletState {
  return { credits, alloys }
}

function request(overrides: Partial<FleetCreationRequest> = {}): FleetCreationRequest {
  return {
    ownerId: 'p1',
    name: 'Strike Force',
    composition: composition({ scout: 2, frigate: 1 }),
    at: AT,
    shipyardLevel: 1,
    fleet: 0,
    wallet: wallet(1e9, 1e9),
    location: { kind: 'planet', bodyId: 'home-body' },
    ...overrides,
  }
}

describe('module-level lookup tables are deep-frozen (finding 6)', () => {
  it('FLEET_STATUSES and FLEET_LOCATION_KINDS are frozen with the unions', () => {
    expect(Object.isFrozen(FLEET_STATUSES)).toBe(true)
    expect(Object.isFrozen(FLEET_LOCATION_KINDS)).toBe(true)
    expect([...FLEET_STATUSES]).toEqual(['idle', 'traveling', 'combat', 'returning'])
    expect([...FLEET_LOCATION_KINDS]).toEqual(['planet', 'system'])
  })

  it('mutating a frozen table throws TypeError (runtime-immutable)', () => {
    expect(() => {
      ;(FLEET_STATUSES as unknown as string[]).push('flying')
    }).toThrow(TypeError)
    expect(() => {
      ;(FLEET_LOCATION_KINDS as unknown as string[]).pop()
    }).toThrow(TypeError)
  })
})

describe('fleetCompositionCost', () => {
  it('empty composition costs 0 credits and 0 alloys', () => {
    expect(fleetCompositionCost(composition())).toEqual({ credits: 0, alloys: 0 })
  })

  it('hand-computed mix: 2 scouts + 1 frigate = 9000 cr / 200 alloys', () => {
    const cost = fleetCompositionCost(composition({ scout: 2, frigate: 1 }))
    expect(cost.credits).toBe(2 * SHIP_CLASSES.scout.cost.credits + SHIP_CLASSES.frigate.cost.credits)
    expect(cost.credits).toBe(9_000)
    expect(cost.alloys).toBe(SHIP_CLASSES.frigate.cost.alloys)
    expect(cost.alloys).toBe(200)
  })

  it('every class × count matches the LOCKED SHIP_CLASSES costs', () => {
    const counts = composition({ scout: 3, corvette: 2, frigate: 1, cruiser: 4, battleship: 5 })
    const expected = SHIP_CLASS_IDS.reduce(
      (acc, id) => ({
        credits: acc.credits + SHIP_CLASSES[id].cost.credits * counts[id],
        alloys: acc.alloys + SHIP_CLASSES[id].cost.alloys * counts[id],
      }),
      { credits: 0, alloys: 0 },
    )
    expect(fleetCompositionCost(counts)).toEqual(expected)
  })

  it('is deterministic and returns fresh cost objects', () => {
    const comp = composition({ scout: 2, frigate: 1 })
    const a = fleetCompositionCost(comp)
    const b = fleetCompositionCost(comp)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('throws RangeError for negative counts', () => {
    expect(() => fleetCompositionCost(composition({ scout: -1 }))).toThrow(RangeError)
    expect(() => fleetCompositionCost(composition({ battleship: -2 }))).toThrow(RangeError)
  })

  it('throws RangeError for fractional counts', () => {
    expect(() => fleetCompositionCost(composition({ corvette: 1.5 }))).toThrow(RangeError)
  })
})

describe('fleetCompositionSize', () => {
  it('empty composition has size 0', () => {
    expect(fleetCompositionSize(composition())).toBe(0)
  })

  it('sums per-class counts (2 scouts + 1 frigate = 3)', () => {
    expect(fleetCompositionSize(composition({ scout: 2, frigate: 1 }))).toBe(3)
  })

  it('sums every class and is deterministic', () => {
    const comp = composition({ scout: 3, corvette: 2, frigate: 1, cruiser: 4, battleship: 5 })
    expect(fleetCompositionSize(comp)).toBe(15)
    expect(fleetCompositionSize(comp)).toBe(fleetCompositionSize(comp))
  })

  it('throws RangeError for negative and fractional counts', () => {
    expect(() => fleetCompositionSize(composition({ cruiser: -1 }))).toThrow(RangeError)
    expect(() => fleetCompositionSize(composition({ frigate: 0.5 }))).toThrow(RangeError)
  })
})

describe('createFleet happy path', () => {
  it('creates a fleet with every field set', () => {
    const req = request()
    const { fleet, cost } = createFleet(req)
    expect(fleet.ownerId).toBe('p1')
    expect(fleet.name).toBe('Strike Force')
    expect(fleet.composition).toEqual(req.composition)
    expect(fleet.location).toEqual({ kind: 'planet', bodyId: 'home-body' })
    expect(fleet.createdAt).toBe(AT)
    expect(fleet.status).toBe('idle')
    expect(fleet.id).toBe(fnv1a(`${req.ownerId}|${req.name}|${req.at}`).toString(16))
    expect(cost).toEqual(fleetCompositionCost(req.composition))
    expect(fleetInvariants(fleet).ok).toBe(true)
  })

  it('id is deterministic: identical inputs produce the same id', () => {
    expect(createFleet(request()).fleet.id).toBe(createFleet(request()).fleet.id)
  })

  it('different at or name produces a different id', () => {
    const a = createFleet(request({ at: AT })).fleet.id
    const b = createFleet(request({ at: AT + 1 })).fleet.id
    const c = createFleet(request({ name: 'Beta' })).fleet.id
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('empty composition is a valid (free) empty fleet', () => {
    const req = request({ composition: composition() })
    const { fleet, cost } = createFleet(req)
    expect(fleetCompositionSize(fleet.composition)).toBe(0)
    expect(cost).toEqual({ credits: 0, alloys: 0 })
    expect(fleet.status).toBe('idle')
  })

  it('supplied location is preserved exactly (planet and system kinds)', () => {
    const planet: FleetLocation = { kind: 'planet', bodyId: 'p-body' }
    const system: FleetLocation = { kind: 'system', bodyId: 's-body' }
    expect(createFleet(request({ location: planet })).fleet.location).toEqual(planet)
    expect(createFleet(request({ location: system })).fleet.location).toEqual(system)
  })
})

describe('createFleet validation', () => {
  it('throws RangeError for an empty ownerId', () => {
    expect(() => createFleet(request({ ownerId: '' }))).toThrow(RangeError)
  })

  it('throws RangeError for an empty or whitespace-only name (finding 2)', () => {
    expect(() => createFleet(request({ name: '' }))).toThrow(RangeError)
    expect(() => createFleet(request({ name: '   ' }))).toThrow(RangeError)
    expect(() => createFleet(request({ name: 'Strike Force' }))).not.toThrow()
  })

  it('throws RangeError for non-finite or non-positive at', () => {
    for (const bad of [0, -100, NaN, Infinity, -Infinity]) {
      expect(() => createFleet(request({ at: bad })), String(bad)).toThrow(RangeError)
    }
  })

  it('throws RangeError for negative and fractional composition counts', () => {
    expect(() => createFleet(request({ composition: composition({ scout: -1 }) }))).toThrow(RangeError)
    expect(() => createFleet(request({ composition: composition({ corvette: 0.5 }) }))).toThrow(RangeError)
  })

  it('throws RangeError for a non-finite or negative fleet', () => {
    expect(() => createFleet(request({ fleet: -1 }))).toThrow(RangeError)
    expect(() => createFleet(request({ fleet: NaN }))).toThrow(RangeError)
  })

  it('throws RangeError for a non-finite wallet', () => {
    expect(() => createFleet(request({ wallet: wallet(NaN, 0) }))).toThrow(RangeError)
    expect(() => createFleet(request({ wallet: wallet(0, Infinity) }))).toThrow(RangeError)
  })

  it('throws RangeError for a negative or fractional shipyard level', () => {
    for (const bad of [-1, 0.5, NaN]) {
      expect(() => createFleet(request({ shipyardLevel: bad })), String(bad)).toThrow(RangeError)
    }
  })

  it('throws RangeError for an invalid location (kind outside union, empty bodyId)', () => {
    const badKind = { ...request(), location: { kind: 'moon', bodyId: 'x' } } as unknown as FleetCreationRequest
    const emptyBody = {
      ...request(),
      location: { kind: 'planet' as const, bodyId: '' },
    }
    expect(() => createFleet(badKind)).toThrow(RangeError)
    expect(() => createFleet(emptyBody)).toThrow(RangeError)
  })
})

describe('createFleet shipyard eligibility ladder', () => {
  it('no-shipyard fires first at shipyard level 0', () => {
    expect(() => createFleet(request({ shipyardLevel: 0 }))).toThrow(/no-shipyard/)
  })

  it('fleet-cap fires only when fleet + size exceeds the cap, and scales with level', () => {
    expect(() => createFleet(request({ fleet: 999, composition: composition({ scout: 2 }) }))).toThrow(/fleet-cap/)
    expect(createFleet(request({ fleet: 998, composition: composition({ scout: 2 }) })).fleet.id).toBeTruthy()
    expect(() =>
      createFleet(request({ shipyardLevel: 2, fleet: 1_999, composition: composition({ scout: 2 }) })),
    ).toThrow(/fleet-cap/)
    expect(shipyardStateFor(2).fleetCap).toBe(2_000)
    const atCap = request({ shipyardLevel: 3, fleet: 3_000, composition: composition({ scout: 1 }) })
    expect(() => createFleet(atCap)).toThrow(/fleet-cap/)
    expect(shipyardStateFor(3).fleetCap).toBe(3_000)
  })

  it('not-enough-credits fires before not-enough-alloys', () => {
    expect(() => createFleet(request({ wallet: wallet(1_000, 1_000_000) }))).toThrow(/not-enough-credits/)
  })

  it('not-enough-alloys fires only when credits are sufficient', () => {
    expect(() => createFleet(request({ wallet: wallet(9_000, 199) }))).toThrow(/not-enough-alloys/)
  })

  it('exact funds pass the ladder', () => {
    expect(createFleet(request({ wallet: wallet(9_000, 200) })).fleet.id).toBeTruthy()
  })
})

describe('fleetInvariants', () => {
  it('passes for a fleet produced by createFleet', () => {
    const { fleet } = createFleet(request())
    expect(fleetInvariants(fleet)).toEqual({ ok: true, problems: [] })
  })

  it('flags an empty id and empty ownerId', () => {
    const { fleet } = createFleet(request())
    const badId: Fleet = { ...fleet, id: '' }
    const badOwner: Fleet = { ...fleet, ownerId: '' }
    expect(fleetInvariants(badId).problems.some((p) => p.includes('id'))).toBe(true)
    expect(fleetInvariants(badOwner).problems.some((p) => p.includes('ownerId'))).toBe(true)
  })

  it('flags an empty or whitespace-only name (finding 2)', () => {
    const { fleet } = createFleet(request())
    const emptyName: Fleet = { ...fleet, name: '' }
    const spacesName: Fleet = { ...fleet, name: '   ' }
    expect(fleetInvariants(emptyName).problems).toContain(
      'fleet name must be a non-empty string',
    )
    expect(fleetInvariants(spacesName).ok).toBe(false)
  })

  it('flags negative and fractional composition counts', () => {
    const { fleet } = createFleet(request())
    const negative: Fleet = { ...fleet, composition: { ...fleet.composition, scout: -1 } }
    const fractional: Fleet = { ...fleet, composition: { ...fleet.composition, frigate: 1.5 } }
    expect(fleetInvariants(negative).ok).toBe(false)
    expect(fleetInvariants(fractional).ok).toBe(false)
  })

  it('flags a location kind outside the union and an empty bodyId', () => {
    const { fleet } = createFleet(request())
    const badKind = { ...fleet, location: { kind: 'moon', bodyId: 'x' } } as unknown as Fleet
    const emptyBody: Fleet = { ...fleet, location: { ...fleet.location, bodyId: '' } }
    expect(fleetInvariants(badKind).problems.some((p) => p.includes('kind'))).toBe(true)
    expect(fleetInvariants(emptyBody).problems.some((p) => p.includes('bodyId'))).toBe(true)
  })

  it('flags a status outside the union and non-finite/non-positive createdAt', () => {
    const { fleet } = createFleet(request())
    const badStatus = { ...fleet, status: 'flying' } as unknown as Fleet
    expect(fleetInvariants(badStatus).problems.some((p) => p.includes('status'))).toBe(true)
    for (const bad of [0, -5, NaN, Infinity]) {
      const badCreated: Fleet = { ...fleet, createdAt: bad }
      expect(fleetInvariants(badCreated).ok, String(bad)).toBe(false)
    }
  })
})

describe('createFleet immutability and determinism', () => {
  it('does not mutate the request inputs', () => {
    const req = request()
    const before = {
      ownerId: req.ownerId,
      name: req.name,
      composition: { ...req.composition },
      at: req.at,
      shipyardLevel: req.shipyardLevel,
      fleet: req.fleet,
      wallet: { ...req.wallet },
      location: { ...req.location },
    }
    createFleet(req)
    expect(req.ownerId).toBe(before.ownerId)
    expect(req.name).toBe(before.name)
    expect(req.composition).toEqual(before.composition)
    expect(req.at).toBe(before.at)
    expect(req.shipyardLevel).toBe(before.shipyardLevel)
    expect(req.fleet).toBe(before.fleet)
    expect(req.wallet).toEqual(before.wallet)
    expect(req.location).toEqual(before.location)
  })

  it('returns fresh fleet and cost objects per call, deterministic across calls', () => {
    const a = createFleet(request())
    const b = createFleet(request())
    expect(a.fleet).toEqual(b.fleet)
    expect(a.cost).toEqual(b.cost)
    expect(a.fleet).not.toBe(b.fleet)
    expect(a.fleet.composition).not.toBe(b.fleet.composition)
    expect(a.fleet.location).not.toBe(b.fleet.location)
    expect(a.cost).not.toBe(b.cost)
  })
})
