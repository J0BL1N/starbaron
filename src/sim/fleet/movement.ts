/**
 * Fleet movement / travel mechanics (P5-T04) — the travel math for moving a
 * fleet over the world graph, computed from POSITIONS supplied by the caller.
 *
 * POSITION CONTRACT: this module does NOT query positions (src/sim/world/api.ts
 * does that). The caller passes concrete `Position` values and this module
 * computes distance and arrival timing from them. Positions are 3-D world
 * coordinates whose units are PARSECS — the world's spatial unit — so
 * `distanceBetween` returns a distance in parsecs.
 *
 * DESIGN decisions (all documented; DESIGN.md §5a locks travel time as
 * "distancePc × 1 min, floor 10 min, cap 48h" as a balance TUNING, not a
 * formula — this module implements the raw per-class speed model that the
 * balance harness tunes later, and P10 owns the tuning):
 * - **Timing units:** timestamps (departureAt/arrivalAt) are milliseconds,
 *   matching queues.ts/transactions.ts; durations (`travelDuration`,
 *   `fleetTravelTime`) are SECONDS (speed is parsecs per second). Arrival is
 *   `departureAt + durationMs` where `durationMs = duration * 1000`.
 * - **Fleet speed:** a fleet travels at the speed of its SLOWEST ship —
 *   `fleetTravelTime` takes the minimum speedPcPerSec over classes with a
 *   positive count and divides the distance by it. An EMPTY fleet (zero ships)
 *   has no ships to move, so its travel time is 0s (documented; composition
 *   shape is still validated).
 * - **Zero-distance legs:** `arrivalTime` mirrors queues.ts overflow-safety —
 *   the arrival must be FINITE and STRICTLY AFTER departure. A leg with
 *   distance 0 would arrive exactly at departure, so `planTravel` rejects it
 *   (RangeError).
 * - **Status:** `planTravel` emits a leg with status 'traveling'; a leg
 *   transitions to 'arrived' via `isArrived`/caller logic at the boundary —
 *   this module never mutates state (pure, no module-level mutable state).
 *
 * Pure module — deterministic, no wall clock (every timestamp is an INPUT), no
 * nondeterministic APIs, strictly typed.
 */

import { SHIP_CLASSES, SHIP_CLASS_IDS } from './ships'
import { fleetCompositionSize } from './fleet'
import type { FleetComposition } from './fleet'

/** A 3-D world position; coordinates are in parsecs (world units). */
export interface Position {
  x: number
  y: number
  z: number
}

export type TravelRefKind = 'planet' | 'system'

/** A travel endpoint reference: a world body (planet or system) by id. */
export interface TravelRef {
  kind: TravelRefKind
  bodyId: string
}

export type TravelStatus = 'traveling' | 'arrived'

/** A single planned leg of fleet movement between two body references. */
export interface TravelLeg {
  fleetId: string
  from: TravelRef
  to: TravelRef
  distancePc: number
  speedPcPerSec: number
  departureAt: number
  arrivalAt: number
  status: TravelStatus
}

export interface PlanTravelInput {
  fleetId: string
  from: Position
  fromRef: TravelRef
  to: Position
  toRef: TravelRef
  speedPcPerSec: number
  departureAt: number
}

const TRAVEL_REF_KINDS: readonly TravelRefKind[] = ['planet', 'system']

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

function assertValidRef(ref: TravelRef, field: string): void {
  if (!(TRAVEL_REF_KINDS as readonly string[]).includes(ref.kind)) {
    throw new RangeError(
      `${field}.kind must be 'planet' or 'system', got ${String(ref.kind)}`,
    )
  }
  assertNonEmptyString(ref.bodyId, `${field}.bodyId`)
}

/**
 * Euclidean distance between two positions, in parsecs (world units in this
 * model). Coordinates must be finite (RangeError otherwise). Deterministic and
 * symmetric: distanceBetween(a, b) === distanceBetween(b, a).
 */
export function distanceBetween(a: Position, b: Position): number {
  assertFiniteCoordinate(a, 'a')
  assertFiniteCoordinate(b, 'b')
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Travel duration in SECONDS for a given distance and speed:
 * `distancePc / speedPcPerSec`. `distancePc` must be a finite number >= 0 and
 * `speedPcPerSec` a finite number > 0 (RangeError otherwise). A distance of 0
 * yields 0s.
 */
export function travelDuration(distancePc: number, speedPcPerSec: number): number {
  assertFiniteNonNegative(distancePc, 'distancePc')
  assertFinitePositive(speedPcPerSec, 'speedPcPerSec')
  return distancePc / speedPcPerSec
}

/**
 * Arrival timestamp in milliseconds: `departureAt + duration * 1000` where
 * `duration` is the travel duration in seconds. `departureAt` must be a finite
 * number > 0. Overflow-safe, mirroring queues.ts: the resulting arrival must be
 * finite AND strictly after departure — otherwise a RangeError is thrown. A
 * zero-distance leg (arrival === departure) is therefore rejected here.
 */
export function arrivalTime(
  departureAt: number,
  distancePc: number,
  speedPcPerSec: number,
): number {
  assertFinitePositive(departureAt, 'departureAt')
  const durationMs = travelDuration(distancePc, speedPcPerSec) * 1000
  const arrivalAt = departureAt + durationMs
  if (!Number.isFinite(arrivalAt) || arrivalAt <= departureAt) {
    throw new RangeError(
      `arrivalAt (${arrivalAt}) must be finite and strictly after ` +
        `departureAt (${departureAt}) for distance ${distancePc}pc at speed ${speedPcPerSec}pc/s`,
    )
  }
  return arrivalAt
}

/**
 * Plans a fleet travel leg: distance computed from the supplied positions,
 * arrival from `arrivalTime`, status 'traveling'. Validates fleetId non-empty,
 * both refs (kind in union, bodyId non-empty), and via `arrivalTime` the
 * departure/speed/distance. A zero-distance leg (from === to) throws because
 * the arrival would equal the departure. Returns a fresh leg; inputs are never
 * mutated and refs are copied.
 */
export function planTravel(input: PlanTravelInput): TravelLeg {
  const { fleetId, from, fromRef, to, toRef, speedPcPerSec, departureAt } = input
  assertNonEmptyString(fleetId, 'fleetId')
  assertValidRef(fromRef, 'from')
  assertValidRef(toRef, 'to')
  const distancePc = distanceBetween(from, to)
  const arrivalAt = arrivalTime(departureAt, distancePc, speedPcPerSec)
  return {
    fleetId,
    from: { ...fromRef },
    to: { ...toRef },
    distancePc,
    speedPcPerSec,
    departureAt,
    arrivalAt,
    status: 'traveling',
  }
}

/**
 * A fleet's travel time in SECONDS for a distance: the fleet moves at its
 * SLOWEST ship — the minimum speedPcPerSec over classes with a positive count —
 * so `distancePc / slowestSpeed`. The composition must be shape-valid
 * (non-negative integer counts, via fleetCompositionSize — RangeError
 * otherwise); `distancePc` must be finite >= 0. An EMPTY fleet (zero ships) has
 * no ships to move and its travel time is 0s.
 */
export function fleetTravelTime(
  composition: FleetComposition,
  distancePc: number,
): number {
  assertFiniteNonNegative(distancePc, 'distancePc')
  const size = fleetCompositionSize(composition)
  if (size === 0) {
    return 0
  }
  let slowestSpeedPcPerSec = Infinity
  for (const id of SHIP_CLASS_IDS) {
    const speed = SHIP_CLASSES[id].speedPcPerSec
    if (composition[id] > 0 && speed < slowestSpeedPcPerSec) {
      slowestSpeedPcPerSec = speed
    }
  }
  return distancePc / slowestSpeedPcPerSec
}

/**
 * Whether a leg has arrived at `at` (inclusive boundary: `at >= arrivalAt`).
 * Both `at` and the leg's `arrivalAt` must be finite (RangeError otherwise).
 */
export function isArrived(leg: TravelLeg, at: number): boolean {
  assertFinite(at, 'at')
  assertFinite(leg.arrivalAt, 'leg.arrivalAt')
  return at >= leg.arrivalAt
}
