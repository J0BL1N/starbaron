/**
 * Fleet positioning (P5-T05) — the PURE position model: the deterministic
 * position of a fleet at each timestamp, computed from a planned leg, with no
 * per-frame state. The renderer calls `positionAt({ fleet, origin,
 * destination, leg, at })` once per frame and gets a complete answer back.
 *
 * POSITION CONTRACT (inherited from movement.ts): this module does NOT query
 * positions — the world layer does. A `TravelLeg` carries travel REFS (kind +
 * bodyId) and timestamps but no coordinates, so the caller resolves the 3-D
 * world positions and passes them in as `origin`/`destination`. `legEvents`
 * follows the same contract and therefore ALSO takes the resolved positions:
 * a leg alone cannot name where departure/arrival happen.
 *
 * TIMING: timestamps are milliseconds (matching movement.ts). `at` is
 * validated as a positive finite number via the shared `assertPositiveAt`
 * validator (../ui/validate) — it is an INPUT, never read from a time source.
 *
 * PHASE MODEL (documented boundaries, all tested):
 * - leg null → 'at-origin', position = origin, progress 0 (idle; no active leg).
 * - leg present, at < departureAt → 'at-origin' (CLAMPED: progress 0,
 *   position = origin — the fleet hasn't left).
 * - at == departureAt → 'traveling', progress 0 (DEPARTED at the boundary).
 * - departureAt < at < arrivalAt → 'traveling', progress = (at - departureAt)
 *   / (arrivalAt - departureAt) clamped to [0,1]; position is LINEARLY
 *   interpolated origin → destination — no easing, deterministic.
 * - at == arrivalAt → 'at-destination', progress 1 (ARRIVED at the boundary).
 * - at > arrivalAt → 'at-destination' (CLAMPED: progress 1, position =
 *   destination).
 *
 * Pure module — deterministic, no time-source reads, no nondeterministic
 * APIs, no module-level mutable state, strictly typed throughout.
 */

import type { Fleet } from './fleet'
import type { Position, TravelLeg } from './movement'
import { assertPositiveAt } from '../ui/validate'

/** A 3-D position plus the fleet's movement phase at a timestamp. */
export interface FleetPosition {
  x: number
  y: number
  z: number
  phase: 'at-origin' | 'traveling' | 'at-destination'
  progress: number
}

/**
 * A fleet's deterministic position at one timestamp. `leg` is the active
 * travel leg (null when the fleet is idle at origin with no active leg).
 */
export interface PositionedFleet {
  fleetId: string
  position: FleetPosition
  leg: TravelLeg | null
}

export interface PositionAtInput {
  fleet: Fleet
  origin: Position
  destination: Position
  leg: TravelLeg | null
  at: number
}

export interface LegEvent {
  at: number
  position: Position
}

/** The departure/arrival EVENT contract for a leg (notifications are wired by
 * the caller, e.g. P4-T07). Positions come from the resolved world positions,
 * not from the leg's refs. */
export interface LegEvents {
  departure: LegEvent
  arrival: LegEvent
}

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} must be finite, got ${value}`)
  }
}

function assertFiniteCoordinate(position: Position, field: string): void {
  assertFinite(position.x, `${field}.x`)
  assertFinite(position.y, `${field}.y`)
  assertFinite(position.z, `${field}.z`)
}

function assertProgress(progress: number): void {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError(
      `progress must be a finite number in [0, 1], got ${progress}`,
    )
  }
}

function assertValidLegTiming(leg: TravelLeg): void {
  assertFinite(leg.departureAt, 'leg.departureAt')
  assertFinite(leg.arrivalAt, 'leg.arrivalAt')
  if (leg.arrivalAt <= leg.departureAt) {
    throw new RangeError(
      `leg.arrivalAt (${leg.arrivalAt}) must be strictly after ` +
        `leg.departureAt (${leg.departureAt})`,
    )
  }
}

/** A fresh deep copy of a leg — its `from` and `to` refs are copied too, so
 * the result never aliases the caller's leg. */
function copyLeg(leg: TravelLeg): TravelLeg {
  return {
    fleetId: leg.fleetId,
    from: { ...leg.from },
    to: { ...leg.to },
    distancePc: leg.distancePc,
    speedPcPerSec: leg.speedPcPerSec,
    departureAt: leg.departureAt,
    arrivalAt: leg.arrivalAt,
    status: leg.status,
  }
}

function clampProgress(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Pure linear interpolation between two positions at a `progress` in [0,1]:
 * `from + (to - from) × progress`. `progress` must be finite and within
 * [0,1] (RangeError otherwise); coordinates must be finite. Returns a fresh
 * position — inputs are never mutated or aliased.
 */
export function interpolate(
  from: Position,
  to: Position,
  progress: number,
): Position {
  assertFiniteCoordinate(from, 'from')
  assertFiniteCoordinate(to, 'to')
  assertProgress(progress)
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    z: from.z + (to.z - from.z) * progress,
  }
}

/**
 * Deterministic fleet position at timestamp `at` (see the module docstring
 * for the phase model). `at` must be a positive finite number
 * (assertPositiveAt); origin/destination coordinates and the leg's
 * departureAt/arrivalAt must be finite with arrivalAt strictly after
 * departureAt (RangeError otherwise). Returns a fresh result — inputs are
 * never mutated. A `fleetId` on the result always comes from `fleet.id`.
 */
export function positionAt(input: PositionAtInput): PositionedFleet {
  const { fleet, origin, destination, leg, at } = input

  assertPositiveAt(at)
  assertFiniteCoordinate(origin, 'origin')
  assertFiniteCoordinate(destination, 'destination')
  if (leg !== null) {
    assertValidLegTiming(leg)
  }

  if (leg === null || at < leg.departureAt) {
    return {
      fleetId: fleet.id,
      position: {
        x: origin.x,
        y: origin.y,
        z: origin.z,
        phase: 'at-origin',
        progress: 0,
      },
      leg: leg === null ? null : copyLeg(leg),
    }
  }

  if (at >= leg.arrivalAt) {
    return {
      fleetId: fleet.id,
      position: {
        x: destination.x,
        y: destination.y,
        z: destination.z,
        phase: 'at-destination',
        progress: 1,
      },
      leg: copyLeg(leg),
    }
  }

  const progress = clampProgress(
    (at - leg.departureAt) / (leg.arrivalAt - leg.departureAt),
  )
  const coord = interpolate(origin, destination, progress)
  return {
    fleetId: fleet.id,
    position: {
      x: coord.x,
      y: coord.y,
      z: coord.z,
      phase: 'traveling',
      progress,
    },
    leg: copyLeg(leg),
  }
}

/**
 * The departure/arrival EVENT contract for a leg: each event carries the leg
 * timestamp and the RESOLVED world position of that endpoint. Positions must
 * be finite; the leg timing must be valid (finite, arrival strictly after
 * departure) — RangeError otherwise. Returns fresh position objects — the
 * inputs are never aliased or mutated.
 */
export function legEvents(
  leg: TravelLeg,
  origin: Position,
  destination: Position,
): LegEvents {
  assertValidLegTiming(leg)
  assertFiniteCoordinate(origin, 'origin')
  assertFiniteCoordinate(destination, 'destination')
  return {
    departure: { at: leg.departureAt, position: { ...origin } },
    arrival: { at: leg.arrivalAt, position: { ...destination } },
  }
}
