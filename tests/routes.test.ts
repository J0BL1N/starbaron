import { describe, expect, it } from 'vitest'
import { planRoute, routeEta, routeLegIndex } from '../src/sim/fleet/routes'
import type {
  PlanRouteInput,
  TravelRoute,
  Waypoint,
} from '../src/sim/fleet/routes'
import type { Position, TravelRef } from '../src/sim/fleet/movement'

const AT = 1_700_000_000_000

function pos(x: number, y: number, z: number): Position {
  return { x, y, z }
}

function ref(kind: 'planet' | 'system', bodyId: string): TravelRef {
  return { kind, bodyId }
}

function wp(
  x: number,
  y: number,
  z: number,
  kind: 'planet' | 'system',
  bodyId: string,
): Waypoint {
  return { ref: ref(kind, bodyId), position: pos(x, y, z) }
}

function routeInput(overrides: Partial<PlanRouteInput> = {}): PlanRouteInput {
  return {
    fleetId: 'fleet-1',
    waypoints: [
      wp(0, 0, 0, 'planet', 'home'),
      wp(3, 0, 0, 'system', 'alpha'),
      wp(3, 0, 5, 'system', 'beta'),
    ],
    speedPcPerSec: 1.0,
    departureAt: AT,
    ...overrides,
  }
}

function standardRoute(): TravelRoute {
  return planRoute(routeInput())
}

// Standard route: legs 0 → 1 = 3pc (3s), 1 → 2 = 5pc (5s); total 8pc / 8s;
// leg0 window [AT, AT+3000), leg1 window [AT+3000, AT+8000), arrival AT+8000.

describe('planRoute', () => {
  it('builds waypoints − 1 legs for a multi-waypoint route', () => {
    const route = standardRoute()
    expect(route.waypoints.length).toBe(3)
    expect(route.legs.length).toBe(2)
  })

  it('chains legs sequentially: leg i+1 departs when leg i arrives', () => {
    const route = standardRoute()
    expect(route.legs[0].departureAt).toBe(AT)
    expect(route.legs[0].arrivalAt).toBe(AT + 3000)
    expect(route.legs[1].departureAt).toBe(AT + 3000)
    expect(route.legs[1].arrivalAt).toBe(AT + 8000)
  })

  it('maps each leg to its waypoint refs and hand-computed distance', () => {
    const route = standardRoute()
    expect(route.legs[0].from).toEqual(ref('planet', 'home'))
    expect(route.legs[0].to).toEqual(ref('system', 'alpha'))
    expect(route.legs[0].distancePc).toBe(3)
    expect(route.legs[1].from).toEqual(ref('system', 'alpha'))
    expect(route.legs[1].to).toEqual(ref('system', 'beta'))
    expect(route.legs[1].distancePc).toBe(5)
  })

  it('preserves fleetId, speed and departureAt on the route and legs', () => {
    const route = standardRoute()
    expect(route.fleetId).toBe('fleet-1')
    expect(route.departureAt).toBe(AT)
    expect(route.legs[0].speedPcPerSec).toBe(1.0)
    expect(route.legs[0].status).toBe('traveling')
  })

  it('accumulates totalDistancePc as the sum of per-leg distances', () => {
    const route = standardRoute()
    expect(route.totalDistancePc).toBe(8)
    expect(route.totalDistancePc).toBe(route.legs[0].distancePc + route.legs[1].distancePc)
  })

  it('accumulates totalDurationSec as the sum of per-leg durations', () => {
    const route = standardRoute()
    expect(route.totalDurationSec).toBe(8)
    expect(route.totalDurationSec).toBe(3 + 5)
  })

  it('computes arrivalAt = departureAt + totalDurationSec × 1000', () => {
    const route = standardRoute()
    expect(route.arrivalAt).toBe(AT + 8 * 1000)
  })

  it('sets the route arrivalAt to the final leg arrivalAt', () => {
    const route = standardRoute()
    expect(route.arrivalAt).toBe(route.legs[route.legs.length - 1].arrivalAt)
  })

  it('is deterministic and does not alias its inputs', () => {
    expect(planRoute(routeInput())).toEqual(planRoute(routeInput()))
    const input = routeInput()
    const route = planRoute(input)
    expect(route.waypoints[0].ref).not.toBe(input.waypoints[0].ref)
    expect(route.waypoints[0].position).not.toBe(input.waypoints[0].position)
    expect(input.waypoints[0].position).toEqual(pos(0, 0, 0))
  })

  it('allows a body to be revisited only non-consecutively (home → alpha → home)', () => {
    const route = planRoute(
      routeInput({
        waypoints: [
          wp(0, 0, 0, 'planet', 'home'),
          wp(3, 0, 0, 'system', 'alpha'),
          wp(0, 0, 0, 'planet', 'home'),
        ],
      }),
    )
    expect(route.legs.length).toBe(2)
    expect(route.legs[0].distancePc).toBe(3)
    expect(route.legs[1].distancePc).toBe(3)
  })

  it('rejects fewer than 2 waypoints', () => {
    expect(() => planRoute(routeInput({ waypoints: [] }))).toThrow(RangeError)
    expect(() =>
      planRoute(
        routeInput({ waypoints: [wp(0, 0, 0, 'planet', 'home')] }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects duplicate consecutive waypoints (identical ref and position)', () => {
    expect(() =>
      planRoute(
        routeInput({
          waypoints: [
            wp(0, 0, 0, 'planet', 'home'),
            wp(0, 0, 0, 'planet', 'home'),
          ],
        }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects a zero-distance leg (identical positions, different refs)', () => {
    expect(() =>
      planRoute(
        routeInput({
          waypoints: [
            wp(0, 0, 0, 'planet', 'home'),
            wp(0, 0, 0, 'system', 'alpha'),
          ],
        }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects identical consecutive refs at different positions', () => {
    expect(() =>
      planRoute(
        routeInput({
          waypoints: [
            wp(0, 0, 0, 'system', 'alpha'),
            wp(3, 0, 0, 'system', 'alpha'),
          ],
        }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects an empty fleetId', () => {
    expect(() => planRoute(routeInput({ fleetId: '' }))).toThrow(RangeError)
  })

  it('rejects non-finite or non-positive speed', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => planRoute(routeInput({ speedPcPerSec: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
  })

  it('rejects non-finite or non-positive departureAt', () => {
    for (const bad of [0, -100, NaN, Infinity, -Infinity]) {
      expect(() => planRoute(routeInput({ departureAt: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
  })

  it('rejects non-finite waypoint coordinates', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() =>
        planRoute(
          routeInput({
            waypoints: [
              wp(bad, 0, 0, 'planet', 'home'),
              wp(3, 0, 0, 'system', 'alpha'),
            ],
          }),
        ),
        String(bad),
      ).toThrow(RangeError)
      expect(() =>
        planRoute(
          routeInput({
            waypoints: [
              wp(0, 0, 0, 'planet', 'home'),
              wp(3, bad, 0, 'system', 'alpha'),
            ],
          }),
        ),
        String(bad),
      ).toThrow(RangeError)
      expect(() =>
        planRoute(
          routeInput({
            waypoints: [
              wp(0, 0, 0, 'planet', 'home'),
              wp(3, 0, bad, 'system', 'alpha'),
            ],
          }),
        ),
        String(bad),
      ).toThrow(RangeError)
    }
  })

  it('rejects invalid refs (bad kind or empty bodyId)', () => {
    expect(() =>
      planRoute(
        routeInput({
          waypoints: [
            { ref: { kind: 'moon' as never, bodyId: 'x' }, position: pos(0, 0, 0) },
            wp(3, 0, 0, 'system', 'alpha'),
          ],
        }),
      ),
    ).toThrow(RangeError)
    expect(() =>
      planRoute(
        routeInput({
          waypoints: [
            wp(0, 0, 0, 'planet', 'home'),
            wp(3, 0, 0, 'system', ''),
          ],
        }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects an unrepresentable distance (coordinate square overflows)', () => {
    expect(() =>
      planRoute(
        routeInput({
          waypoints: [
            wp(0, 0, 0, 'planet', 'home'),
            wp(1e200, 0, 0, 'system', 'far'),
          ],
        }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects an arrival overflow (duration × 1000 overflows to Infinity)', () => {
    expect(() =>
      planRoute(
        routeInput({
          waypoints: [
            wp(0, 0, 0, 'planet', 'home'),
            wp(1.3e154, 0, 0, 'system', 'far'),
          ],
          speedPcPerSec: 1e-160,
        }),
      ),
    ).toThrow(RangeError)
  })
})

describe('routeEta', () => {
  it('before departure: full distance remaining (clamped to total), not done', () => {
    expect(routeEta(standardRoute(), AT - 1000)).toEqual({
      remainingMs: 9000,
      remainingPc: 8,
      done: false,
    })
  })

  it('during the first leg: proportional remaining, hand-computed (3/4 → 6pc)', () => {
    expect(routeEta(standardRoute(), AT + 2000)).toEqual({
      remainingMs: 6000,
      remainingPc: 6,
      done: false,
    })
  })

  it('at a leg boundary: proportional remaining, hand-computed (5/8 → 5pc)', () => {
    expect(routeEta(standardRoute(), AT + 3000)).toEqual({
      remainingMs: 5000,
      remainingPc: 5,
      done: false,
    })
  })

  it('at arrival: zero remaining, done', () => {
    expect(routeEta(standardRoute(), AT + 8000)).toEqual({
      remainingMs: 0,
      remainingPc: 0,
      done: true,
    })
  })

  it('after arrival: clamped to zero, done', () => {
    expect(routeEta(standardRoute(), AT + 9000)).toEqual({
      remainingMs: 0,
      remainingPc: 0,
      done: true,
    })
  })

  it('keeps remainingMs >= 0 and remainingPc clamped to [0, total] across a sweep', () => {
    const route = standardRoute()
    for (const at of [AT - 10000, AT - 1, AT, AT + 1000, AT + 3000, AT + 5000, AT + 8000, AT + 10000]) {
      const eta = routeEta(route, at)
      expect(eta.remainingMs).toBeGreaterThanOrEqual(0)
      expect(eta.remainingPc).toBeGreaterThanOrEqual(0)
      expect(eta.remainingPc).toBeLessThanOrEqual(route.totalDistancePc)
    }
  })

  it('rejects a non-finite or non-positive at', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => routeEta(standardRoute(), bad), String(bad)).toThrow(RangeError)
    }
  })

  it('rejects a malformed route (arrivalAt not after departureAt)', () => {
    expect(() => routeEta({ ...standardRoute(), arrivalAt: AT - 1 }, AT + 1000)).toThrow(
      RangeError,
    )
  })
})

describe('routeLegIndex', () => {
  it('before departure returns 0 (first leg)', () => {
    expect(routeLegIndex(standardRoute(), AT - 1000)).toBe(0)
  })

  it('at departure returns 0 (first leg window start)', () => {
    expect(routeLegIndex(standardRoute(), AT)).toBe(0)
  })

  it('during the first leg returns 0', () => {
    expect(routeLegIndex(standardRoute(), AT + 1000)).toBe(0)
  })

  it('at a leg boundary (leg 0 arrivalAt) returns the NEXT leg', () => {
    expect(routeLegIndex(standardRoute(), AT + 3000)).toBe(1)
  })

  it('during the second leg returns 1', () => {
    expect(routeLegIndex(standardRoute(), AT + 5000)).toBe(1)
  })

  it('at the route arrivalAt returns legs.length (route complete sentinel)', () => {
    expect(routeLegIndex(standardRoute(), AT + 8000)).toBe(2)
  })

  it('after arrival returns legs.length', () => {
    expect(routeLegIndex(standardRoute(), AT + 9000)).toBe(2)
  })

  it('is exhaustive: every timestamp maps to exactly one leg or the sentinel', () => {
    const route = standardRoute()
    const samples = [AT - 1, AT, AT + 2999, AT + 3000, AT + 7999, AT + 8000, AT + 9999]
    for (const at of samples) {
      const index = routeLegIndex(route, at)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThanOrEqual(route.legs.length)
    }
  })

  it('rejects a non-finite or non-positive at', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => routeLegIndex(standardRoute(), bad), String(bad)).toThrow(RangeError)
    }
  })

  it('rejects a malformed route (no legs)', () => {
    expect(() => routeLegIndex({ ...standardRoute(), legs: [] }, AT + 1000)).toThrow(
      RangeError,
    )
  })
})
