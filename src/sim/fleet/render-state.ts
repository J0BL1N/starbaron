/**
 * Fleet render-state contract (P5-T06) — the DRAW DATA derived from fleet
 * state (composition, position, phase) that the renderer consumes once per
 * frame. This module is PURE: it never touches a rendering-library graph,
 * never imports rendering code (the renderer CONSUMES this data; the contract
 * never builds the display graph), never reads the current time (every
 * timestamp is an INPUT), and has no module-level mutable state.
 *
 * CONTRACT:
 * - `fleetRenderState` is the per-frame entry point. It takes a
 *   `PositionedFleet` (P5-T05 positionAt — the validated phase + interpolated
 *   position), the fleet's `FleetComposition` (P5-T03), an optional owner
 *   name, the `at` timestamp, and — when the caller has resolved the leg's
 *   world endpoints — optional `origin`/`destination` positions (the heading
 *   source; see `orientation` below). `at` is validated via `assertPositiveAt`
 *   for contract-consistency with positionAt but does NOT influence the
 *   output (documented; deterministic — same state → same render state at
 *   every timestamp).
 * - `label` is the deterministic display label:
 *   `ownerName? + ' ' + 'Fleet ' + fleetId.slice(0, 8)` — ownerName is
 *   included via the spec ternary (`ownerName ? ownerName + ' ' : ''`), so an
 *   empty/undefined owner name yields no prefix. `fleetLabel` is exported
 *   separately for tests/UI reuse and guarantees the same string.
 * - `position` is a validated PASSTHROUGH (coordinates finite, phase in the
 *   union, progress in [0,1]) returned as a FRESH object — never aliased.
 * - `orientation` — the fleet's heading on the world XZ plane (yaw around
 *   the +Y axis; 0° = the +Z axis, 90° = the +X axis, matching the
 *   planetgen3d orbit convention where a heading θ points along
 *   (sin θ, 0, cos θ)). `hasHeading` is true ONLY when the fleet is actively
 *   traveling (leg non-null AND phase 'traveling') with a non-zero
 *   origin→destination vector; every other frame (idle at origin, arrived,
 *   or a zero-length leg) is the documented fallback
 *   `{ headingDegrees: 0, headingRadians: 0, hasHeading: false }`. The
 *   heading is derived deterministically from the leg's resolved endpoints:
 *   `headingDegrees = (atan2(dx, dz) × 180/π + 360) % 360` with dx/dz the
 *   destination−origin difference on the XZ plane. `origin`/`destination`
 *   are OPTIONAL inputs (world `Position`s the caller resolves from the
 *   leg's refs — the leg itself carries no coordinates); when omitted the
 *   fallback applies. Provided endpoints must be finite (RangeError
 *   otherwise).
 *
 * LOD (level-of-detail) draw counts — documented decisions:
 * - Full counts always stay in the MODEL (`draw.perClass[].count`); the LOD
 *   cap only affects the RENDERED count (`drawCount`). The visual LOD is a
 *   DETERMINISTIC CAPPED APPORTIONMENT (largest-remainder method):
 *     (a) floor each class's share = floor(count × ratio), ratio = 1 when
 *         totalShips <= MAX_RENDERED_SHIPS (60), cap/total otherwise;
 *     (b) distribute the remaining slots (cap − sum of floors) to classes in
 *         DESCENDING fractional-remainder order, ties broken by class id
 *         ascending (documented fixed tie-breaker);
 *     (c) the sum of drawCounts equals `min(cap, totalShips)` EXACTLY (the
 *         naive `round(count × ratio)` can overflow the cap — see the
 *         5-class regression in the tests).
 * - Tiny fleets (total <= cap) draw ALL ships; 0-count classes are ABSENT
 *   from `perClass`.
 * - NO minimum of 1 drawn ship per non-empty class: a class that is a tiny
 *   fraction of an oversized fleet can floor to drawCount 0 (pure
 *   proportional math — documented and tested).
 *
 * Hints (both DRAFT):
 * - `scaleHint` — deterministic size cue `1 + log10(totalShips)/10` clamped
 *   to [1.0, 2.0]. 1 ship → 1.0; the 2.0 ceiling is reached at 10^10 ships
 *   (log10 = 10); 1,000,000 ships → 1.6 per the formula. P12 art refines real
 *   ship scaling.
 * - `statusHint` — currently the movement PHASE verbatim (the only status
 *   signal available to this render contract). P12/HUD refines.
 *
 * Pure module — deterministic, no time-source reads, no nondeterministic
 * APIs, no module-level mutable state, strictly typed throughout.
 */

import { SHIP_CLASSES, SHIP_CLASS_IDS } from './ships'
import type { ShipClassId } from './ships'
import { fleetCompositionSize } from './fleet'
import type { Fleet, FleetComposition } from './fleet'
import type { PositionedFleet, FleetPosition } from './positioning'
import type { Position } from './movement'
import { assertPositiveAt } from '../ui/validate'

/** The total number of ships the renderer draws per fleet (LOD cap). */
export const MAX_RENDERED_SHIPS = 60

/** The movement-phase union as a deep-frozen lookup table (runtime-immutable). */
export const PHASES: readonly FleetPosition['phase'][] = Object.freeze([
  'at-origin',
  'traveling',
  'at-destination',
])

/** One class's render entry: model count + LOD draw count. */
export interface DrawClassEntry {
  id: ShipClassId
  name: string
  count: number
  drawCount: number
}

/** The draw data block of the render state: total model ships + per-class. */
export interface FleetDraw {
  totalShips: number
  perClass: DrawClassEntry[]
}

/** The pure render-state contract the renderer consumes per frame. */
export interface FleetRenderState {
  fleetId: string
  label: string
  position: FleetPosition
  draw: FleetDraw
  scaleHint: number
  statusHint: string
  orientation: FleetOrientation
}

/**
 * The fleet's world orientation at a frame: a heading on the world XZ plane
 * (yaw around the +Y axis). 0° = +Z, 90° = +X — the planetgen3d orbit
 * convention, so a heading θ points along (sin θ, 0, cos θ). The IDLE /
 * ZERO-VECTOR fallback is `{ headingDegrees: 0, headingRadians: 0,
 * hasHeading: false }`.
 */
export interface FleetOrientation {
  headingDegrees: number
  headingRadians: number
  hasHeading: boolean
}

export interface FleetRenderStateInput {
  positioned: PositionedFleet
  composition: FleetComposition
  ownerName?: string
  at: number
  origin?: Position
  destination?: Position
}

function assertNonEmpty(value: string, field: string): void {
  if (value.length === 0) {
    throw new RangeError(
      `${field} must be a non-empty string, got ${JSON.stringify(value)}`,
    )
  }
}

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} must be finite, got ${value}`)
  }
}

function assertValidPosition(position: FleetPosition): void {
  assertFinite(position.x, 'position.x')
  assertFinite(position.y, 'position.y')
  assertFinite(position.z, 'position.z')
  if (!(PHASES as readonly string[]).includes(position.phase)) {
    throw new RangeError(
      `position.phase must be 'at-origin'|'traveling'|'at-destination', ` +
        `got ${String(position.phase)}`,
    )
  }
  if (
    !Number.isFinite(position.progress) ||
    position.progress < 0 ||
    position.progress > 1
  ) {
    throw new RangeError(
      `position.progress must be a finite number in [0, 1], got ${position.progress}`,
    )
  }
}

function assertFiniteEndpoint(position: Position | undefined, field: string): void {
  if (position === undefined) return
  assertFinite(position.x, `${field}.x`)
  assertFinite(position.y, `${field}.y`)
  assertFinite(position.z, `${field}.z`)
}

/**
 * The heading derived from an origin→destination vector on the world XZ
 * plane, or null when the vector is zero-length. Convention (documented in
 * the module docstring and the `FleetOrientation` contract): heading θ points
 * along (sin θ, 0, cos θ) — `headingDegrees = (atan2(dx, dz) × 180/π + 360)
 * % 360`, so negative atan2 results wrap into [0, 360).
 */
function headingFromVector(
  origin: Position,
  destination: Position,
): { headingDegrees: number; headingRadians: number } | null {
  const dx = destination.x - origin.x
  const dz = destination.z - origin.z
  if (dx === 0 && dz === 0) {
    return null
  }
  const headingDegrees = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360
  return {
    headingDegrees,
    headingRadians: (headingDegrees * Math.PI) / 180,
  }
}

/**
 * The deterministic orientation block for a frame. A heading exists ONLY for
 * a fleet actively traveling (leg non-null, phase 'traveling') with resolved
 * endpoints whose XZ vector is non-zero; every other frame — idle at origin,
 * arrived, endpoints omitted, or a zero-length leg — is the documented
 * fallback `{ headingDegrees: 0, headingRadians: 0, hasHeading: false }`.
 */
function orientationFor(
  positioned: PositionedFleet,
  origin: Position | undefined,
  destination: Position | undefined,
): FleetOrientation {
  const fallback: FleetOrientation = {
    headingDegrees: 0,
    headingRadians: 0,
    hasHeading: false,
  }
  if (
    positioned.leg === null ||
    positioned.position.phase !== 'traveling' ||
    origin === undefined ||
    destination === undefined
  ) {
    return fallback
  }
  const heading = headingFromVector(origin, destination)
  if (heading === null) {
    return fallback
  }
  return {
    headingDegrees: heading.headingDegrees,
    headingRadians: heading.headingRadians,
    hasHeading: true,
  }
}

/** The LOD ratio applied to each per-class count: 1 when under the cap. */
function lodRatio(totalShips: number): number {
  if (totalShips <= MAX_RENDERED_SHIPS) {
    return 1
  }
  return MAX_RENDERED_SHIPS / totalShips
}

/**
 * Deterministic capped apportionment (largest-remainder method): sets each
 * entry's `drawCount` so the sum EXACTLY equals `min(MAX_RENDERED_SHIPS,
 * totalShips)`. Floors each class's proportional share (`count × ratio`),
 * then hands the remaining slots to classes in DESCENDING fractional-remainder
 * order, ties broken by class id ascending (documented fixed tie-breaker).
 * A sub-integer epsilon guards the floor against float noise at exact
 * integers; fractions are normalized to 9 decimals before the tie-break so
 * comparison is deterministic.
 */
function apportionDrawCounts(
  entries: DrawClassEntry[],
  totalShips: number,
  ratio: number,
): void {
  const cap = Math.min(MAX_RENDERED_SHIPS, totalShips)
  const shares = entries.map((entry) => entry.count * ratio)
  const floors = shares.map((share) => Math.floor(share + 1e-9))
  const fractions = shares.map((share, index) => {
    const fraction = share - floors[index]
    return Math.round(fraction * 1e9) / 1e9
  })
  let remaining = cap - floors.reduce((sum, value) => sum + value, 0)

  const order = entries.map((entry, index) => ({ index, id: entry.id }))
  order.sort((a, b) => {
    const byFraction = fractions[b.index] - fractions[a.index]
    if (byFraction !== 0) {
      return byFraction
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const drawCounts = floors.slice()
  for (const { index } of order) {
    if (remaining <= 0) {
      break
    }
    drawCounts[index] += 1
    remaining -= 1
  }
  entries.forEach((entry, index) => {
    entry.drawCount = drawCounts[index]
  })
}

/** Deterministic size cue `1 + log10(totalShips)/10`, clamped to [1.0, 2.0]. */
function scaleHintFor(totalShips: number): number {
  const hint = 1 + Math.log10(totalShips) / 10
  return Math.max(1, Math.min(2, hint))
}

/** The deterministic label: `[ownerName ]Fleet <fleetId.slice(0, 8)>`. */
function renderLabel(fleetId: string, ownerName?: string): string {
  return `${ownerName ? `${ownerName} ` : ''}Fleet ${fleetId.slice(0, 8)}`
}

/**
 * The deterministic display label for a fleet: `[ownerName ]Fleet
 * <fleetId.slice(0, 8)>`. `ownerName` follows the spec ternary — an
 * empty/undefined owner yields no prefix. `fleet.id` must be a non-empty
 * string (RangeError otherwise).
 */
export function fleetLabel(fleet: Fleet, ownerName?: string): string {
  assertNonEmpty(fleet.id, 'fleet.id')
  return renderLabel(fleet.id, ownerName)
}

/**
 * Builds the per-frame render state for a fleet. Validates (RangeError):
 * `at` positive finite (assertPositiveAt), `fleetId` non-empty, `position`
 * (finite coords, phase in the union, progress in [0,1]), the composition
 * (non-negative integer counts, via fleetCompositionSize), and — when
 * provided — the `origin`/`destination` endpoints (finite coords). The leg is
 * NOT validated here (position already encodes phase/progress; it was
 * validated upstream by positionAt).
 *
 * Output: label (deterministic), position (fresh copy — passthrough, never
 * aliased), draw (totalShips + per-class counts with LOD drawCounts — see the
 * module docstring), scaleHint (draft size cue), statusHint (phase verbatim,
 * draft), and orientation (the heading derived from the leg's resolved
 * endpoints — see the module docstring for the full semantics). `at` is
 * validated but does not influence the output. Inputs are never mutated.
 */
export function fleetRenderState(input: FleetRenderStateInput): FleetRenderState {
  const { positioned, composition, ownerName, at, origin, destination } = input

  assertPositiveAt(at)
  assertNonEmpty(positioned.fleetId, 'fleetId')
  assertValidPosition(positioned.position)
  assertFiniteEndpoint(origin, 'origin')
  assertFiniteEndpoint(destination, 'destination')

  const totalShips = fleetCompositionSize(composition)
  const ratio = lodRatio(totalShips)

  const perClass: DrawClassEntry[] = []
  for (const id of SHIP_CLASS_IDS) {
    const count = composition[id]
    if (count === 0) {
      continue
    }
    perClass.push({
      id,
      name: SHIP_CLASSES[id].name,
      count,
      drawCount: 0,
    })
  }
  apportionDrawCounts(perClass, totalShips, ratio)

  return {
    fleetId: positioned.fleetId,
    label: renderLabel(positioned.fleetId, ownerName),
    position: { ...positioned.position },
    draw: { totalShips, perClass },
    scaleHint: scaleHintFor(totalShips),
    statusHint: positioned.position.phase,
    orientation: orientationFor(positioned, origin, destination),
  }
}
