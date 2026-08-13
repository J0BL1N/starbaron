import { describe, expect, it } from 'vitest'
import {
  TRAVEL_REF_KINDS,
  arrivalTime,
  distanceBetween,
  fleetTravelTime,
  isArrived,
  planTravel,
  travelDuration,
} from '../src/sim/fleet/movement'
import type { Position, TravelLeg, TravelRef } from '../src/sim/fleet/movement'
import type { FleetComposition } from '../src/sim/fleet/fleet'

const AT = 1_700_000_000_000

function pos(x: number, y: number, z: number): Position {
  return { x, y, z }
}

function ref(kind: 'planet' | 'system', bodyId: string): TravelRef {
  return { kind, bodyId }
}

function composition(
  overrides: Partial<FleetComposition> = {},
): FleetComposition {
  return {
    scout: 0,
    corvette: 0,
    frigate: 0,
    cruiser: 0,
    battleship: 0,
    ...overrides,
  }
}

function legInput(
  overrides: Partial<Parameters<typeof planTravel>[0]> = {},
): Parameters<typeof planTravel>[0] {
  return {
    fleetId: 'fleet-1',
    from: pos(0, 0, 0),
    fromRef: ref('planet', 'home'),
    to: pos(3, 4, 0),
    toRef: ref('system', 'target'),
    speedPcPerSec: 1.0,
    departureAt: AT,
    ...overrides,
  }
}

describe('module-level lookup tables are deep-frozen (finding 6)', () => {
  it('TRAVEL_REF_KINDS and every element are frozen', () => {
    expect(Object.isFrozen(TRAVEL_REF_KINDS)).toBe(true)
    expect([...TRAVEL_REF_KINDS]).toEqual(['planet', 'system'])
  })

  it('mutating the frozen table throws TypeError (runtime-immutable)', () => {
    expect(() => {
      ;(TRAVEL_REF_KINDS as unknown as string[]).push('moon')
    }).toThrow(TypeError)
  })
})

describe('distanceBetween', () => {  it('hand-computed Euclidean distance: (0,0,0) to (3,4,0) = 5', () => {
    expect(distanceBetween(pos(0, 0, 0), pos(3, 4, 0))).toBe(5)
  })

  it('hand-computed diagonal: (0,0,0) to (1,1,1) = sqrt(3)', () => {
    expect(distanceBetween(pos(0, 0, 0), pos(1, 1, 1))).toBe(Math.sqrt(3))
  })

  it('is symmetric and zero for identical positions', () => {
    const a = pos(-1, 2, -3)
    const b = pos(4, -5, 6)
    expect(distanceBetween(a, b)).toBe(distanceBetween(b, a))
    expect(distanceBetween(a, a)).toBe(0)
  })

  it('hand-computed with negative coordinates: (-1,-2,-3) to (1,2,3) = sqrt(56)', () => {
    expect(distanceBetween(pos(-1, -2, -3), pos(1, 2, 3))).toBe(Math.sqrt(56))
  })

  it('throws RangeError for non-finite coordinates', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => distanceBetween(pos(bad, 0, 0), pos(0, 0, 0))).toThrow(RangeError)
      expect(() => distanceBetween(pos(0, 0, 0), pos(0, bad, 0))).toThrow(RangeError)
      expect(() => distanceBetween(pos(0, 0, 0), pos(0, 0, bad))).toThrow(RangeError)
    }
  })
})

describe('travelDuration', () => {
  it('zero distance is 0 seconds', () => {
    expect(travelDuration(0, 1.0)).toBe(0)
  })

  it('10 pc at 1.0 pc/s is 10 seconds', () => {
    expect(travelDuration(10, 1.0)).toBe(10)
  })

  it('fractional result: 5 pc at 2.0 pc/s is 2.5 seconds', () => {
    expect(travelDuration(5, 2.0)).toBe(2.5)
  })

  it('throws RangeError for non-finite or non-positive speed', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => travelDuration(10, bad), String(bad)).toThrow(RangeError)
    }
  })

  it('throws RangeError for non-finite or negative distance', () => {
    for (const bad of [-1, NaN, Infinity, -Infinity]) {
      expect(() => travelDuration(bad, 1.0), String(bad)).toThrow(RangeError)
    }
  })
})

describe('arrivalTime', () => {
  it('arrival = departure + duration seconds × 1000 ms', () => {
    expect(arrivalTime(AT, 10, 1.0)).toBe(AT + 10 * 1000)
    expect(arrivalTime(AT, 2.5, 0.5)).toBe(AT + 5 * 1000)
  })

  it('fractional durations produce fractional millisecond arrivals', () => {
    expect(arrivalTime(AT, 10, 3.0)).toBe(AT + (10 / 3) * 1000)
  })

  it('is overflow-safe: infinite arrival throws RangeError', () => {
    expect(() => arrivalTime(AT, 1e308, 1)).toThrow(RangeError)
  })

  it('rejects a zero-distance leg (arrival would equal departure)', () => {
    expect(() => arrivalTime(AT, 0, 1.0)).toThrow(RangeError)
  })

  it('throws RangeError for a non-finite or non-positive departureAt', () => {
    for (const bad of [0, -100, NaN, Infinity, -Infinity]) {
      expect(() => arrivalTime(bad, 10, 1.0), String(bad)).toThrow(RangeError)
    }
  })
})

describe('planTravel', () => {
  it('produces a traveling leg with every field computed', () => {
    const leg = planTravel(legInput())
    expect(leg.fleetId).toBe('fleet-1')
    expect(leg.from).toEqual(ref('planet', 'home'))
    expect(leg.to).toEqual(ref('system', 'target'))
    expect(leg.distancePc).toBe(5)
    expect(leg.speedPcPerSec).toBe(1.0)
    expect(leg.departureAt).toBe(AT)
    expect(leg.arrivalAt).toBe(AT + 5 * 1000)
    expect(leg.status).toBe('traveling')
  })

  it('preserves both planet and system refs exactly', () => {
    const fromPlanet = planTravel(legInput({ fromRef: ref('planet', 'p-body') }))
    const toSystem = planTravel(legInput({ toRef: ref('system', 's-body') }))
    expect(fromPlanet.from).toEqual({ kind: 'planet', bodyId: 'p-body' })
    expect(toSystem.to).toEqual({ kind: 'system', bodyId: 's-body' })
  })

  it('is deterministic and does not mutate or alias its inputs', () => {
    const a = planTravel(legInput())
    const b = planTravel(legInput())
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.from).not.toBe(legInput().fromRef)
    expect(a.to).not.toBe(legInput().toRef)
    expect(legInput().from).toEqual(pos(0, 0, 0))
  })

  it('throws RangeError for an empty fleetId and invalid refs', () => {
    expect(() => planTravel(legInput({ fleetId: '' }))).toThrow(RangeError)
    expect(() =>
      planTravel(
        legInput({ fromRef: { kind: 'moon' as never, bodyId: 'x' } }),
      ),
    ).toThrow(RangeError)
    expect(() => planTravel(legInput({ toRef: ref('system', '') }))).toThrow(
      RangeError,
    )
  })

  it('throws RangeError for bad speed, departureAt and zero-distance legs', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => planTravel(legInput({ speedPcPerSec: bad })), String(bad)).toThrow(RangeError)
    }
    expect(() => planTravel(legInput({ departureAt: NaN }))).toThrow(RangeError)
    expect(() =>
      planTravel(legInput({ to: pos(0, 0, 0) })),
    ).toThrow(RangeError)
  })
})

describe('fleetTravelTime', () => {
  it('mixed fleet uses the slowest class: scout + battleship at 0.6 pc/s', () => {
    expect(fleetTravelTime(composition({ scout: 2, battleship: 1 }), 6)).toBe(10)
  })

  it('slowest wins regardless of count: 100 scouts + 1 battleship', () => {
    expect(fleetTravelTime(composition({ scout: 100, battleship: 1 }), 0.6)).toBe(1)
  })

  it('single class and zero distance are exact', () => {
    expect(fleetTravelTime(composition({ scout: 3 }), 1.5)).toBe(1)
    expect(fleetTravelTime(composition({ scout: 3 }), 0)).toBe(0)
  })

  it('empty fleet (zero ships) has travel time 0s', () => {
    expect(fleetTravelTime(composition(), 100)).toBe(0)
  })

  it('throws RangeError for an invalid composition shape', () => {
    expect(() => fleetTravelTime(composition({ scout: -1 }), 10)).toThrow(RangeError)
    expect(() => fleetTravelTime(composition({ frigate: 1.5 }), 10)).toThrow(RangeError)
  })

  it('throws RangeError for a non-finite or negative distance, and is deterministic', () => {
    for (const bad of [-1, NaN, Infinity]) {
      expect(() => fleetTravelTime(composition({ scout: 1 }), bad), String(bad)).toThrow(RangeError)
    }
    const comp = composition({ scout: 2, battleship: 1 })
    expect(fleetTravelTime(comp, 6)).toBe(fleetTravelTime(comp, 6))
  })
})

describe('isArrived', () => {
  const leg: TravelLeg = planTravel(legInput())

  it('boundary: exactly at arrivalAt is arrived (inclusive)', () => {
    expect(isArrived(leg, leg.arrivalAt)).toBe(true)
  })

  it('before arrival is not arrived', () => {
    expect(isArrived(leg, leg.arrivalAt - 1)).toBe(false)
  })

  it('after arrival is arrived', () => {
    expect(isArrived(leg, leg.arrivalAt + 1_000)).toBe(true)
  })

  it('throws RangeError for a non-finite at or leg arrivalAt', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => isArrived(leg, bad), String(bad)).toThrow(RangeError)
    }
    expect(() => isArrived({ ...leg, arrivalAt: NaN }, leg.arrivalAt)).toThrow(
      RangeError,
    )
  })

  it('rejects a zero or negative at (assertPositiveAt — finding 2)', () => {
    for (const bad of [0, -1, -1_000]) {
      expect(() => isArrived(leg, bad), String(bad)).toThrow(RangeError)
    }
    expect(() => isArrived({ ...leg, arrivalAt: 0 }, leg.arrivalAt)).toThrow(
      RangeError,
    )
    expect(() =>
      isArrived({ ...leg, arrivalAt: -5 }, leg.arrivalAt),
    ).toThrow(RangeError)
  })
})
