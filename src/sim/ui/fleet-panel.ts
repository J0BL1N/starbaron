/**
 * Fleet UI state contract (P5-T08) — the fleet LIST, fleet DETAIL and orders
 * panel projections consumed by the React fleet UI. Pure UI-state projections
 * only: the React components consume these contracts; no rendering wiring
 * exists here. Matches the P4 ui-contract pattern (planet-panel etc.).
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no time-source reads.
 * `at` is a caller-supplied INPUT (positive finite milliseconds) validated via
 * the shared assertPositiveAt; it does not otherwise influence the output. The
 * same inputs always produce the same (deep-equal) output. Inputs are never
 * mutated.
 *
 * Delegation (no re-derived formulas — everything comes from the locked
 * modules):
 * - label → fleetLabel (P5-T06) with NO ownerName: this contract receives no
 *   owner-name input, so every label is the unprefixed
 *   `Fleet <fleetId.slice(0, 8)>` (documented — a caller that wants the owner
 *   prefix passes it through fleetLabel itself).
 * - size → fleetCompositionSize (P5-T03) over the fleet composition.
 * - status → the fleet's status verbatim (FleetStatus).
 * - composition rows → the LOCKED SHIP_CLASS_IDS roster order with the
 *   SHIP_CLASSES names; EVERY roster class appears, zero counts included
 *   (documented — the detail panel lists the full roster, so the row ids
 *   always equal SHIP_CLASS_IDS).
 * - position → the PositionedFleet position (P5-T05) phase/progress verbatim.
 * - queuedOrders → the count of 'issued' orders in the fleet's FleetOrders
 *   (P5-T07); the active order is never counted.
 *
 * LOCATION STRING FORMS (deterministic, documented):
 * - `'<kind>:<bodyId>'` — the fleet occupies a body (kind 'planet'|'system',
 *   bodyId the body's id). Precedence:
 *   (a) positioned phase 'at-destination' with a leg → the leg's `to` ref
 *       (the fleet has ARRIVED — the leg ref is more current than
 *       fleet.location);
 *   (b) otherwise → the fleet's own `location` ref.
 * - `'en route'` (EN_ROUTE_LOCATION) — the fleet is between bodies (positioned
 *   phase 'traveling').
 * - PHASE FALLBACK: a fleet with NO positioned entry (not positioned this
 *   frame) is projected at its location ref with phase 'at-origin' — the same
 *   default positioning.ts applies to a fleet with no active leg.
 *
 * ACTIVE-ORDER TARGET STRING: `'<kind>:<id>'` from the order's target ref for
 * move/attack/defend orders; the literal `'origin'` for a 'return' order
 * (orders.ts: return targets the fleet's origin — its target ref is null, and
 * the panel shows the semantic 'origin').
 *
 * Validation:
 * - `at` positive finite → RangeError via assertPositiveAt in every entry
 *   point (fleetPanelState re-validates through its delegations).
 * - fleetDetailState throws RangeError when `activeOrderId` is non-null but no
 *   matching order exists — an inconsistent FleetOrders entry (structural
 *   invariants are ordersInvariants' contract; this module only guards the
 *   lookup it performs).
 *
 * SELECTION (fleetPanelState): `selectedFleetId` is the input passthrough when
 * it names a fleet in the (sorted) list, else null. `selected` is the fleet's
 * FleetDetail ONLY when the fleet is in the list AND has a positioned entry —
 * a fleet that is not positioned this frame has no derivable detail (null).
 */

import { fleetCompositionSize } from '../fleet/fleet'
import type { Fleet, FleetStatus } from '../fleet/fleet'
import type {
  FleetOrders,
  FleetOrderStatus,
  FleetOrderTargetKind,
  FleetOrderType,
} from '../fleet/orders'
import type { FleetPosition, PositionedFleet } from '../fleet/positioning'
import { fleetLabel } from '../fleet/render-state'
import { SHIP_CLASSES, SHIP_CLASS_IDS } from '../fleet/ships'
import type { ShipClassId } from '../fleet/ships'
import { assertPositiveAt } from './validate'

/** The deterministic location string for a fleet between bodies. */
export const EN_ROUTE_LOCATION = 'en route'

export interface FleetListRow {
  fleetId: string
  label: string
  size: number
  status: FleetStatus
  location: string
  phase: FleetPosition['phase']
}

export interface FleetCompositionRow {
  id: ShipClassId
  name: string
  count: number
}

export interface FleetActiveOrder {
  type: FleetOrderType
  target: string
  status: FleetOrderStatus
}

export interface FleetDetail {
  fleetId: string
  label: string
  size: number
  composition: FleetCompositionRow[]
  status: FleetStatus
  position: { phase: FleetPosition['phase']; progress: number }
  activeOrder: FleetActiveOrder | null
  queuedOrders: number
}

export interface FleetPanelState {
  fleets: FleetListRow[]
  selectedFleetId: string | null
  selected: FleetDetail | null
}

export interface FleetListInput {
  fleets: readonly Fleet[]
  positioned: ReadonlyMap<string, PositionedFleet>
  orders: ReadonlyMap<string, FleetOrders>
  at: number
}

export interface FleetDetailInput {
  fleet: Fleet
  positioned: PositionedFleet
  orders: FleetOrders | null
  at: number
}

export interface FleetPanelInput {
  fleets: readonly Fleet[]
  positioned: ReadonlyMap<string, PositionedFleet>
  orders: ReadonlyMap<string, FleetOrders>
  selectedFleetId?: string | null
  at: number
}

/** A body reference string: `<kind>:<bodyId>` (see the module docstring). */
function refString(kind: FleetOrderTargetKind, id: string): string {
  return `${kind}:${id}`
}

function listRowFor(
  fleet: Fleet,
  positioned: PositionedFleet | undefined,
): FleetListRow {
  const phase = positioned === undefined ? 'at-origin' : positioned.position.phase
  let location: string
  if (phase === 'traveling') {
    location = EN_ROUTE_LOCATION
  } else if (
    positioned !== undefined &&
    phase === 'at-destination' &&
    positioned.leg !== null
  ) {
    location = refString(positioned.leg.to.kind, positioned.leg.to.bodyId)
  } else {
    location = refString(fleet.location.kind, fleet.location.bodyId)
  }
  return {
    fleetId: fleet.id,
    label: fleetLabel(fleet),
    size: fleetCompositionSize(fleet.composition),
    status: fleet.status,
    location,
    phase,
  }
}

/**
 * One list row per fleet, ordered by fleetId ascending. The `orders` map is
 * part of the input contract (kept for signature symmetry with
 * fleetPanelState) but the list projection does not read it. A fleet with no
 * positioned entry falls back to phase 'at-origin' at its location ref (see
 * the module docstring). Inputs are never mutated.
 */
export function fleetListState(input: FleetListInput): FleetListRow[] {
  assertPositiveAt(input.at)
  return [...input.fleets]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((fleet) => listRowFor(fleet, input.positioned.get(fleet.id)))
}

function activeOrderFor(orders: FleetOrders | null): FleetActiveOrder | null {
  if (orders === null || orders.activeOrderId === null) {
    return null
  }
  const order = orders.orders.find((o) => o.id === orders.activeOrderId)
  if (order === undefined) {
    throw new RangeError(
      `activeOrderId '${orders.activeOrderId}' references no order in fleet ${orders.fleetId}`,
    )
  }
  return {
    type: order.type,
    target:
      order.target === null ? 'origin' : refString(order.target.kind, order.target.id),
    status: order.status,
  }
}

/**
 * The full detail projection for a single fleet: roster-ordered composition
 * (zero counts included), the fleet's position passthrough, the active order
 * (from activeOrderId; target string per the module docstring) and the queued
 * 'issued' order count. `at` is validated via assertPositiveAt; a dangling
 * activeOrderId throws RangeError. Inputs are never mutated.
 */
export function fleetDetailState(input: FleetDetailInput): FleetDetail {
  assertPositiveAt(input.at)
  return {
    fleetId: input.fleet.id,
    label: fleetLabel(input.fleet),
    size: fleetCompositionSize(input.fleet.composition),
    composition: SHIP_CLASS_IDS.map((id) => ({
      id,
      name: SHIP_CLASSES[id].name,
      count: input.fleet.composition[id],
    })),
    status: input.fleet.status,
    position: {
      phase: input.positioned.position.phase,
      progress: input.positioned.position.progress,
    },
    activeOrder: activeOrderFor(input.orders),
    queuedOrders:
      input.orders === null
        ? 0
        : input.orders.orders.filter((order) => order.status === 'issued').length,
  }
}

/**
 * The whole fleet panel projection: the sorted list (fleetListState) plus the
 * selection passthrough and detail. `selectedFleetId` is preserved when it
 * names a fleet in the list (else null); `selected` is the FleetDetail only
 * when the selected fleet is also positioned this frame (else null). Inputs
 * are never mutated.
 */
export function fleetPanelState(input: FleetPanelInput): FleetPanelState {
  assertPositiveAt(input.at)
  const fleets = fleetListState({
    fleets: input.fleets,
    positioned: input.positioned,
    orders: input.orders,
    at: input.at,
  })
  const requested = input.selectedFleetId === undefined ? null : input.selectedFleetId
  const selectedFleetId =
    requested !== null && fleets.some((row) => row.fleetId === requested)
      ? requested
      : null

  let selected: FleetDetail | null = null
  if (selectedFleetId !== null) {
    const fleet = input.fleets.find((f) => f.id === selectedFleetId)
    const positioned = input.positioned.get(selectedFleetId)
    if (fleet !== undefined && positioned !== undefined) {
      selected = fleetDetailState({
        fleet,
        positioned,
        orders: input.orders.get(selectedFleetId) ?? null,
        at: input.at,
      })
    }
  }

  return { fleets, selectedFleetId, selected }
}
