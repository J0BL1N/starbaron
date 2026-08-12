import { describe, expect, it } from 'vitest'
import { interpolate, legEvents, positionAt } from '../src/sim/fleet/positioning'
import type { Position, TravelLeg } from '../src/sim/fleet/movement'
import { planTravel } from '../src/sim/fleet/movement'
import type { Fleet } from '../src/sim/fleet/fleet'

const AT = 1_700_000_000_000

function pos(x: number, y: number, z: number): Position {
  return { x, y, z }
}

function fleet(): Fleet {
  return {
    id: 'fleet-1',
    ownerId: 'owner-1',
    name: 'Fleet One',
    composition: { scout: 2, corvette: 0, frigate: 0, cruiser: 0, battleship: 0 },
    location: { kind: 'planet', bodyId: 'home' },
    createdAt: AT,
    status: 'idle',
  }
}

// (0,0,0) → (6,8,0) is distance 10pc; at 1 pc/s the arrival is exactly
// AT + 10_000 ms, so every progress fraction below is exact in floats.
const ORIGIN: Position = pos(0, 0, 0)
const DESTINATION: Position = pos(6, 8, 0)

function leg(): TravelLeg {
  return planTravel({
    fleetId: 'fleet-1',
    from: ORIGIN,
    fromRef: { kind: 'planet', bodyId: 'home' },
    to: DESTINATION,
    toRef: { kind: 'system', bodyId: 'target' },
    speedPcPerSec: 1.0,
    departureAt: AT,
  })
}

describe('positionAt — leg null (idle at origin)', () => {
  it('returns fleetId, phase at-origin, position = origin, progress 0, leg null', () => {
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: null,
      at: AT,
    })
    expect(out.fleetId).toBe('fleet-1')
    expect(out.position).toEqual({
      x: 0,
      y: 0,
      z: 0,
      phase: 'at-origin',
      progress: 0,
    })
    expect(out.leg).toBeNull()
  })

  it('returns a fresh position object (no alias of origin)', () => {
    const origin = pos(3, -2, 5)
    const out = positionAt({
      fleet: fleet(),
      origin,
      destination: DESTINATION,
      leg: null,
      at: AT,
    })
    expect(out.position).toEqual({ x: 3, y: -2, z: 5, phase: 'at-origin', progress: 0 })
    expect(out.position).not.toBe(origin)
    expect(origin).toEqual(pos(3, -2, 5))
  })
})

describe('positionAt — leg present, pre-departure clamp', () => {
  it('at < departureAt → at-origin, progress 0, position = origin, leg copied (no alias)', () => {
    const leg1 = leg()
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg1,
      at: AT - 1000,
    })
    expect(out.position).toEqual({
      x: 0,
      y: 0,
      z: 0,
      phase: 'at-origin',
      progress: 0,
    })
    expect(out.leg).toEqual(leg1)
    expect(out.leg).not.toBe(leg1)
    expect(out.leg?.from).not.toBe(leg1.from)
    expect(out.leg?.to).not.toBe(leg1.to)
  })

  it('exactly one ms before departureAt is still clamped to at-origin', () => {
    const leg1 = leg()
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg1,
      at: leg1.departureAt - 1,
    })
    expect(out.position.phase).toBe('at-origin')
    expect(out.position.progress).toBe(0)
    expect(out.position).toEqual({
      x: 0,
      y: 0,
      z: 0,
      phase: 'at-origin',
      progress: 0,
    })
  })

  it('exactly at departureAt → traveling, progress 0, position = origin (departed)', () => {
    const leg1 = leg()
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg1,
      at: leg1.departureAt,
    })
    expect(out.position.phase).toBe('traveling')
    expect(out.position.progress).toBe(0)
    expect(out.position.x).toBe(0)
    expect(out.position.y).toBe(0)
    expect(out.position.z).toBe(0)
  })
})

describe('positionAt — traveling interpolation', () => {
  it('midpoint (progress 0.5) → midpoint coords (3,4,0)', () => {
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg(),
      at: AT + 5000,
    })
    expect(out.position.phase).toBe('traveling')
    expect(out.position.progress).toBe(0.5)
    expect(out.position).toEqual({ x: 3, y: 4, z: 0, phase: 'traveling', progress: 0.5 })
  })

  it('quarter point (progress 0.25) → hand-computed coords (1.5,2,0)', () => {
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg(),
      at: AT + 2500,
    })
    expect(out.position.progress).toBe(0.25)
    expect(out.position.x).toBe(1.5)
    expect(out.position.y).toBe(2)
    expect(out.position.z).toBe(0)
  })

  it('progress formula: at 3000ms → 0.3 → (1.8, 2.4, 0)', () => {
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg(),
      at: AT + 3000,
    })
    expect(out.position.progress).toBeCloseTo(0.3)
    expect(out.position.x).toBeCloseTo(1.8)
    expect(out.position.y).toBeCloseTo(2.4)
    expect(out.position.z).toBe(0)
  })
})

describe('positionAt — post-arrival / at-destination', () => {
  it('exactly at arrivalAt → at-destination, progress 1, position = destination', () => {
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg(),
      at: leg().arrivalAt,
    })
    expect(out.position.phase).toBe('at-destination')
    expect(out.position.progress).toBe(1)
    expect(out.position).toEqual({
      x: 6,
      y: 8,
      z: 0,
      phase: 'at-destination',
      progress: 1,
    })
  })

  it('after arrival → at-destination, position = destination, progress 1', () => {
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg(),
      at: leg().arrivalAt + 1,
    })
    expect(out.position.phase).toBe('at-destination')
    expect(out.position.progress).toBe(1)
    expect(out.position.x).toBe(6)
    expect(out.position.y).toBe(8)
    expect(out.position.z).toBe(0)
  })

  it('far post-arrival is clamped to destination / progress 1', () => {
    const out = positionAt({
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg(),
      at: leg().arrivalAt + 1_000_000,
    })
    expect(out.position.phase).toBe('at-destination')
    expect(out.position.progress).toBe(1)
    expect(out.position).toEqual({
      x: 6,
      y: 8,
      z: 0,
      phase: 'at-destination',
      progress: 1,
    })
    expect(out.position).not.toBe(DESTINATION)
  })
})

describe('positionAt — determinism, immutability, identity', () => {
  it('same inputs → deep-equal, distinct result objects', () => {
    const input = {
      fleet: fleet(),
      origin: ORIGIN,
      destination: DESTINATION,
      leg: leg(),
      at: AT + 5000,
    }
    const a = positionAt(input)
    const b = positionAt(input)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.position).not.toBe(b.position)
  })

  it('does not mutate or alias origin/destination/leg inputs', () => {
    const origin = pos(0, 0, 0)
    const destination = pos(6, 8, 0)
    const leg1 = leg()
    const out = positionAt({
      fleet: fleet(),
      origin,
      destination,
      leg: leg1,
      at: AT + 5000,
    })
    expect(out.position).toEqual({ x: 3, y: 4, z: 0, phase: 'traveling', progress: 0.5 })
    expect(out.position).not.toBe(origin)
    expect(out.position).not.toBe(destination)
    expect(out.leg).toEqual(leg1)
    expect(out.leg).not.toBe(leg1)
    expect(out.leg?.from).not.toBe(leg1.from)
    expect(out.leg?.to).not.toBe(leg1.to)
    expect(origin).toEqual(pos(0, 0, 0))
    expect(destination).toEqual(pos(6, 8, 0))
    expect(leg1).toEqual(leg())
  })
})

describe('positionAt — validation', () => {
  it('throws RangeError for non-finite or non-positive at (via assertPositiveAt)', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(
        () =>
          positionAt({
            fleet: fleet(),
            origin: ORIGIN,
            destination: DESTINATION,
            leg: leg(),
            at: bad,
          }),
        String(bad),
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError for bad at even when leg is null', () => {
    expect(() =>
      positionAt({
        fleet: fleet(),
        origin: ORIGIN,
        destination: DESTINATION,
        leg: null,
        at: NaN,
      }),
    ).toThrow(RangeError)
  })

  it('throws RangeError for non-finite origin or destination coordinates', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() =>
        positionAt({
          fleet: fleet(),
          origin: pos(bad, 0, 0),
          destination: DESTINATION,
          leg: leg(),
          at: AT,
        }),
      ).toThrow(RangeError)
      expect(() =>
        positionAt({
          fleet: fleet(),
          origin: ORIGIN,
          destination: pos(0, bad, 0),
          leg: leg(),
          at: AT,
        }),
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError when leg arrivalAt is not strictly after departureAt', () => {
    expect(() =>
      positionAt({
        fleet: fleet(),
        origin: ORIGIN,
        destination: DESTINATION,
        leg: { ...leg(), arrivalAt: leg().departureAt },
        at: AT,
      }),
    ).toThrow(RangeError)
  })

  it('throws RangeError for non-finite leg timestamps', () => {
    expect(() =>
      positionAt({
        fleet: fleet(),
        origin: ORIGIN,
        destination: DESTINATION,
        leg: { ...leg(), departureAt: NaN },
        at: AT,
      }),
    ).toThrow(RangeError)
    expect(() =>
      positionAt({
        fleet: fleet(),
        origin: ORIGIN,
        destination: DESTINATION,
        leg: { ...leg(), arrivalAt: Infinity },
        at: AT,
      }),
    ).toThrow(RangeError)
  })
})

describe('interpolate', () => {
  it('progress 0 → from, progress 1 → to', () => {
    expect(interpolate(ORIGIN, DESTINATION, 0)).toEqual(pos(0, 0, 0))
    expect(interpolate(ORIGIN, DESTINATION, 1)).toEqual(pos(6, 8, 0))
  })

  it('midpoint (0.5) → midpoint coords (3,4,0)', () => {
    expect(interpolate(ORIGIN, DESTINATION, 0.5)).toEqual(pos(3, 4, 0))
  })

  it('hand-computed: (1,2,3) → (7,14,21) at 1/3 → (3,6,9)', () => {
    expect(interpolate(pos(1, 2, 3), pos(7, 14, 21), 1 / 3)).toEqual(pos(3, 6, 9))
  })

  it('hand-computed with negatives: (-10,-20,-30) → (10,20,30) at 0.25 → (-5,-10,-15)', () => {
    expect(interpolate(pos(-10, -20, -30), pos(10, 20, 30), 0.25)).toEqual(
      pos(-5, -10, -15),
    )
  })

  it('returns fresh objects and never mutates inputs', () => {
    const from = pos(1, 2, 3)
    const to = pos(4, 5, 6)
    const out = interpolate(from, to, 0.5)
    expect(out).toEqual(pos(2.5, 3.5, 4.5))
    expect(out).not.toBe(from)
    expect(out).not.toBe(to)
    expect(from).toEqual(pos(1, 2, 3))
    expect(to).toEqual(pos(4, 5, 6))
  })

  it('is deterministic for identical inputs', () => {
    expect(interpolate(ORIGIN, DESTINATION, 0.25)).toEqual(
      interpolate(ORIGIN, DESTINATION, 0.25),
    )
  })

  it('throws RangeError for progress outside [0,1] or non-finite', () => {
    for (const bad of [-0.01, 1.01, NaN, Infinity, -Infinity]) {
      expect(() => interpolate(ORIGIN, DESTINATION, bad), String(bad)).toThrow(
        RangeError,
      )
    }
  })

  it('throws RangeError for non-finite coordinates', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => interpolate(pos(bad, 0, 0), DESTINATION, 0.5)).toThrow(RangeError)
      expect(() => interpolate(ORIGIN, pos(0, bad, 0), 0.5)).toThrow(RangeError)
    }
  })
})

describe('legEvents', () => {
  it('carries the leg departure/arrival timestamps and resolved positions', () => {
    const events = legEvents(leg(), ORIGIN, DESTINATION)
    expect(events.departure.at).toBe(leg().departureAt)
    expect(events.departure.position).toEqual(pos(0, 0, 0))
    expect(events.arrival.at).toBe(leg().arrivalAt)
    expect(events.arrival.position).toEqual(pos(6, 8, 0))
  })

  it('returns fresh copies of the positions (no aliasing)', () => {
    const origin = pos(3, 4, 5)
    const destination = pos(9, 10, 11)
    const events = legEvents(leg(), origin, destination)
    expect(events.departure.position).toEqual(origin)
    expect(events.arrival.position).toEqual(destination)
    expect(events.departure.position).not.toBe(origin)
    expect(events.arrival.position).not.toBe(destination)
    expect(origin).toEqual(pos(3, 4, 5))
    expect(destination).toEqual(pos(9, 10, 11))
  })

  it('throws RangeError for invalid leg timing (non-finite or arrival <= departure)', () => {
    expect(() => legEvents({ ...leg(), departureAt: NaN }, ORIGIN, DESTINATION)).toThrow(
      RangeError,
    )
    expect(() =>
      legEvents({ ...leg(), arrivalAt: leg().departureAt }, ORIGIN, DESTINATION),
    ).toThrow(RangeError)
  })

  it('throws RangeError for non-finite positions', () => {
    expect(() => legEvents(leg(), pos(NaN, 0, 0), DESTINATION)).toThrow(RangeError)
    expect(() => legEvents(leg(), ORIGIN, pos(0, Infinity, 0))).toThrow(RangeError)
  })
})
