/**
 * Fleet travel ROUTE planning (P5-T09) — multi-leg routes between waypoints:
 * sequential leg planning, distance/duration accumulation and ETA queries.
 *
 * Built on movement.ts (P5-T04): each leg is planned with `planTravel`, so a
 * leg's distance comes from `distanceBetween` and its arrival from
 * `arrivalTime` at the fleet's speed. A route is SEQUENTIAL — leg i departs
 * when leg i-1 arrives, so `legs[i].departureAt === legs[i-1].arrivalAt` and
 * the route arrives when its FINAL leg arrives.
 *
 * POSITION CONTRACT (inherited from movement.ts): this module does NOT query
 * positions — src/sim/world/api.ts does that. The caller supplies concrete
 * `Waypoint` positions; the route math is position-pure.
 *
 * DESIGN decisions (all documented):
 * - **Minimum route:** a route needs at least 2 waypoints. 1 waypoint means no
 *   movement → totalDistance 0 → rejected with a descriptive RangeError ("a
 *   route needs at least 2 waypoints"). Every CONSECUTIVE pair must also be
 *   distinct: identical refs and/or identical positions form a zero-distance
 *   leg (the fleet would arrive exactly when it departs) → rejected, matching
 *   movement.ts's zero-distance rejection. Identical refs at different
 *   positions are also rejected — a single body cannot sit at two coordinates,
 *   so the caller supplied inconsistent positions. Non-consecutive revisits
 *   (home → alpha → home) are fine; only consecutive pairs are checked.
 * - **Timing units:** timestamps are milliseconds, durations are SECONDS,
 *   speed is parsecs per second — matching movement.ts. Leg arrival is
 *   `departureAt + travelDuration × 1000`, overflow-safe via `arrivalTime`
 *   (the arrival must be finite and strictly after the departure), and
 *   `route.arrivalAt` is the final leg's arrivalAt — so
 *   `route.arrivalAt = route.departureAt + totalDurationSec × 1000` under the
 *   same sequential floating-point accumulation.
 * - **routeEta:** a clamped proportional extrapolation — `remainingPc =
 *   totalDistancePc × remainingMs / (arrivalAt − departureAt)`, clamped to
 *   [0, totalDistancePc] (before departure it clamps to the full distance).
 * - **routeLegIndex:** the half-open [departureAt, arrivalAt) window containing
 *   `at` — before departure → 0 (first leg); at a leg's arrivalAt the fleet is
 *   on the NEXT leg; at/after the route arrivalAt → `legs.length` (the
 *   documented 'route complete' sentinel).
 *
 * Pure module — deterministic, no time-source reads (every timestamp is an
 * INPUT), no nondeterministic APIs, no module-level mutable state, strictly
 * typed.
 */

import { planTravel, travelDuration } from './movement'
import type { Position, TravelRef, TravelLeg } from './movement'
import { assertPositiveAt } from '../ui/validate'

/** A route stop: a world body reference plus its resolved position. */
export interface Waypoint {
  ref: TravelRef
  position: Position
}

/** A planned multi-leg fleet route (see the module docstring for invariants). */
export interface TravelRoute {
  fleetId: string
  waypoints: Waypoint[]
  legs: TravelLeg[]
  totalDistancePc: number
  totalDurationSec: number
  departureAt: number
  arrivalAt: number
}

export interface PlanRouteInput {
  fleetId: string
  waypoints: readonly Waypoint[]
  speedPcPerSec: number
  departureAt: number
}

/** A point-in-time ETA read-out for a route. */
export interface RouteEta {
  remainingMs: number
  remainingPc: number
  done: boolean
}

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} must be finite, got ${value}`)
  }
}

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a finite number > 0, got ${value}`)
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} must be a finite non-negative number, got ${value}`,
    )
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (value.length === 0) {
    throw new RangeError(
      `${field} must be a non-empty string, got ${JSON.stringify(value)}`,
    )
  }
}

function assertFiniteCoordinate(position: Position, field: string): void {
  assertFinite(position.x, `${field}.x`)
  assertFinite(position.y, `${field}.y`)
  assertFinite(position.z, `${field}.z`)
}

function refEquals(a: TravelRef, b: TravelRef): boolean {
  return a.kind === b.kind && a.bodyId === b.bodyId
}

function posEquals(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/**
 * Plans a multi-leg route. Validation order (each throws RangeError):
 *   1. `fleetId` non-empty
 *   2. at least 2 waypoints (a 1-waypoint route has no movement)
 *   3. consecutive waypoints distinct — identical refs and/or identical
 *      positions form a zero-distance leg
 *   4. every waypoint position finite
 *   5. `speedPcPerSec` finite > 0 and `departureAt` finite > 0
 *
 * Legs are planned sequentially with `planTravel` (leg i departs when leg i-1
 * arrives); `totalDistancePc = Σ distanceBetween`, `totalDurationSec =
 * Σ travelDuration`, and `arrivalAt` is the final leg's arrivalAt, which is
 * overflow-safe (each leg's arrival is finite and strictly after its
 * departure). Returns a fresh route — waypoint refs/positions are copied and
 * the inputs are never mutated.
 */
export function planRoute(input: PlanRouteInput): TravelRoute {
  const { fleetId, waypoints, speedPcPerSec, departureAt } = input

  assertNonEmptyString(fleetId, 'fleetId')
  if (waypoints.length < 2) {
    throw new RangeError(
      `planRoute: a route needs at least 2 waypoints, got ${waypoints.length}`,
    )
  }
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    if (refEquals(a.ref, b.ref) || posEquals(a.position, b.position)) {
      throw new RangeError(
        `planRoute: consecutive waypoints ${i} and ${i + 1} are a duplicate ` +
          `(identical ref ${a.ref.kind}/${a.ref.bodyId} or identical ` +
          `position), forming a zero-distance leg`,
      )
    }
  }
  for (let i = 0; i < waypoints.length; i++) {
    assertFiniteCoordinate(waypoints[i].position, `waypoints[${i}].position`)
  }
  assertFinitePositive(speedPcPerSec, 'speedPcPerSec')
  assertPositiveAt(departureAt)

  const legs: TravelLeg[] = []
  let legDepartureAt = departureAt
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const leg = planTravel({
      fleetId,
      from: waypoints[i].position,
      fromRef: waypoints[i].ref,
      to: waypoints[i + 1].position,
      toRef: waypoints[i + 1].ref,
      speedPcPerSec,
      departureAt: legDepartureAt,
    })
    legs.push(leg)
    legDepartureAt = leg.arrivalAt
  }

  let totalDistancePc = 0
  let totalDurationSec = 0
  for (const leg of legs) {
    totalDistancePc += leg.distancePc
    totalDurationSec += travelDuration(leg.distancePc, speedPcPerSec)
  }

  const arrivalAt = legDepartureAt
  if (!Number.isFinite(arrivalAt) || arrivalAt <= departureAt) {
    throw new RangeError(
      `planRoute: arrivalAt (${arrivalAt}) must be finite and strictly after ` +
        `departureAt (${departureAt})`,
    )
  }

  return {
    fleetId,
    waypoints: waypoints.map((waypoint) => ({
      ref: { ...waypoint.ref },
      position: { ...waypoint.position },
    })),
    legs,
    totalDistancePc,
    totalDurationSec,
    departureAt,
    arrivalAt,
  }
}

/**
 * Structural timing invariants of a planned route (defensive — a route built
 * by planRoute always satisfies these): departureAt positive finite; arrivalAt
 * finite and strictly after departureAt; totalDistancePc finite non-negative;
 * at least one leg; the first leg departs at the route departureAt; the final
 * leg arrives at the route arrivalAt; consecutive legs chain (leg i+1 departs
 * when leg i arrives).
 */
function assertRouteShape(route: TravelRoute): void {
  assertPositiveAt(route.departureAt)
  assertFinite(route.arrivalAt, 'route.arrivalAt')
  if (route.arrivalAt <= route.departureAt) {
    throw new RangeError(
      `route.arrivalAt (${route.arrivalAt}) must be strictly after ` +
        `route.departureAt (${route.departureAt})`,
    )
  }
  assertFiniteNonNegative(route.totalDistancePc, 'route.totalDistancePc')
  if (route.legs.length < 1) {
    throw new RangeError('route must have at least one leg')
  }
  if (route.legs[0].departureAt !== route.departureAt) {
    throw new RangeError(
      'route.legs[0].departureAt must equal route.departureAt',
    )
  }
  const lastLeg = route.legs[route.legs.length - 1]
  if (lastLeg.arrivalAt !== route.arrivalAt) {
    throw new RangeError(
      'route.arrivalAt must equal the final leg arrivalAt',
    )
  }
  for (let i = 0; i + 1 < route.legs.length; i++) {
    if (route.legs[i + 1].departureAt !== route.legs[i].arrivalAt) {
      throw new RangeError(
        `route.legs[${i + 1}].departureAt must equal route.legs[${i}].arrivalAt ` +
          `(sequential legs)`,
      )
    }
  }
}

/**
 * ETA read-out for a route at timestamp `at` (`at` must be positive finite —
 * assertPositiveAt; the route shape must be valid — see assertRouteShape).
 * `remainingMs = max(0, arrivalAt − at)`; `done = at >= arrivalAt`;
 * `remainingPc = totalDistancePc × remainingMs / (arrivalAt − departureAt)`,
 * clamped to [0, totalDistancePc] (before departure it clamps to the full
 * route distance; at/after arrival it is 0).
 */
export function routeEta(route: TravelRoute, at: number): RouteEta {
  assertPositiveAt(at)
  assertRouteShape(route)
  const totalMs = route.arrivalAt - route.departureAt
  const remainingMs = Math.max(0, route.arrivalAt - at)
  const done = at >= route.arrivalAt
  const remainingPc = Math.min(
    Math.max(0, route.totalDistancePc * (remainingMs / totalMs)),
    route.totalDistancePc,
  )
  return { remainingMs, remainingPc, done }
}

/**
 * Which leg of the route the fleet is on at timestamp `at` (0-based; `at`
 * must be positive finite — assertPositiveAt; the route shape must be valid).
 * Before departure → 0 (the first leg). Within the route, the leg whose
 * half-open [departureAt, arrivalAt) window contains `at` — so at a leg's
 * arrivalAt the fleet is on the NEXT leg. At/after the route arrivalAt →
 * `legs.length` (the documented 'route complete' sentinel).
 */
export function routeLegIndex(route: TravelRoute, at: number): number {
  assertPositiveAt(at)
  assertRouteShape(route)
  if (at < route.departureAt) {
    return 0
  }
  if (at >= route.arrivalAt) {
    return route.legs.length
  }
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i]
    if (at >= leg.departureAt && at < leg.arrivalAt) {
      return i
    }
  }
  return route.legs.length
}
