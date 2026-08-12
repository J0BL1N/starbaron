/**
 * Fleet object model and fleet creation (P5-T03) — composing fleets from the
 * ship classes, the fleet object, cost, validation and eligibility.
 *
 * DESIGN decisions (all documented; DESIGN.md has no fleet-creation section):
 * - **Composition** is a per-class count record over the five roster classes
 *   (scout/corvette/frigate/cruiser/battleship). Every count is a non-negative
 *   integer; the zero-composition {0,0,0,0,0} is VALID and means 'empty'.
 * - **Cost** is the LOCKED per-class cost × count summed across the roster
 *   (`SHIP_CLASSES` — nothing re-derived, P10 owns balancing).
 * - **Size** is the total ship count (sum of the composition), used as the
 *   fleet-cap increment.
 * - **Location contract:** the owner's home body id is NOT derivable inside
 *   this pure module — `PlayerState.homePlanet` is an `OwnedPlanet` carrying
 *   no `bodyId` field, and this request carries no PlayerState. Per the
 *   DESIGN note ("if not derivable, make location REQUIRED in the request")
 *   `FleetCreationRequest.location` is therefore a REQUIRED field: the caller
 *   (boundary) resolves the home body id and passes it. The spec's baseline
 *   request shape is extended with this field.
 * - **Eligibility ladder (approximation, documented):** `canBuildShips`
 *   (P5-T02) is the per-class builder used by the shipyard to construct
 *   individual ships; it accepts a single `ShipBuildRequest` with one class,
 *   so a multi-class composition cannot be passed to it directly. `createFleet`
 *   therefore performs the SAME ladder order directly with the composition's
 *   aggregate numbers: no-shipyard (level 0) → fleet-cap (fleet + size >
 *   fleetCap, where fleetCap = LOCKED `shipyardStateFor(level).fleetCap`) →
 *   not-enough-credits → not-enough-alloys. Validation failures (malformed
 *   at/ownerId/composition/level/fleet/wallet/location) throw RangeError;
 *   the four eligibility reasons throw Error with the reason embedded in the
 *   message (mirroring canBuildShips' outcome reasons).
 * - **Id:** `fnv1a(`${ownerId}|${name}|${at}`).toString(16)` — deterministic,
 *   no wall clock (`at` is an input), exactly the queues.ts id style.
 * - **Wallet:** never debited here. `cost` is the reservation; the caller
 *   debits via transactions.ts after a successful createFleet.
 *
 * Pure module — deterministic, no wall clock, no nondeterministic APIs, no
 * module-level mutable state, strictly typed.
 */

import { SHIP_CLASSES, SHIP_CLASS_IDS } from './ships'
import { shipyardStateFor } from './shipyard'
import { fnv1a } from '../planets/hash'
import type { WalletState } from '../player/types'

export interface FleetComposition {
  scout: number
  corvette: number
  frigate: number
  cruiser: number
  battleship: number
}

export type FleetLocationKind = 'planet' | 'system'

export interface FleetLocation {
  kind: FleetLocationKind
  bodyId: string
}

export type FleetStatus = 'idle' | 'traveling' | 'combat' | 'returning'

export interface Fleet {
  id: string
  ownerId: string
  name: string
  composition: FleetComposition
  location: FleetLocation
  createdAt: number
  status: FleetStatus
}

export interface FleetCreationRequest {
  ownerId: string
  name: string
  composition: FleetComposition
  at: number
  shipyardLevel: number
  fleet: number
  wallet: WalletState
  location: FleetLocation
}

const FLEET_STATUSES: readonly FleetStatus[] = [
  'idle',
  'traveling',
  'combat',
  'returning',
]

const FLEET_LOCATION_KINDS: readonly FleetLocationKind[] = ['planet', 'system']

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
    throw new RangeError(`${field} must be a non-empty string, got ${JSON.stringify(value)}`)
  }
}

function assertValidComposition(composition: FleetComposition): void {
  for (const id of SHIP_CLASS_IDS) {
    const count = composition[id]
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(
        `composition.${id} must be a non-negative integer, got ${String(count)}`,
      )
    }
  }
}

function assertValidLocation(location: FleetLocation): void {
  if (!(FLEET_LOCATION_KINDS as readonly string[]).includes(location.kind)) {
    throw new RangeError(
      `location.kind must be 'planet' or 'system', got ${String(location.kind)}`,
    )
  }
  assertNonEmptyString(location.bodyId, 'location.bodyId')
}

/**
 * The credit/alloy cost of a composition: per-class cost × count summed over
 * the LOCKED `SHIP_CLASSES` roster. Counts must be non-negative integers
 * (RangeError otherwise — the zero-composition is valid and costs 0/0).
 */
export function fleetCompositionCost(composition: FleetComposition): {
  credits: number
  alloys: number
} {
  assertValidComposition(composition)
  let credits = 0
  let alloys = 0
  for (const id of SHIP_CLASS_IDS) {
    credits += SHIP_CLASSES[id].cost.credits * composition[id]
    alloys += SHIP_CLASSES[id].cost.alloys * composition[id]
  }
  return { credits, alloys }
}

/**
 * The total ship count of a composition (sum of the per-class counts). Counts
 * must be non-negative integers (RangeError otherwise).
 */
export function fleetCompositionSize(composition: FleetComposition): number {
  assertValidComposition(composition)
  let size = 0
  for (const id of SHIP_CLASS_IDS) {
    size += composition[id]
  }
  return size
}

/**
 * Creates a fleet from a request. Validation order (each throws):
 *   1. `at` finite > 0
 *   2. `ownerId` non-empty
 *   3. composition counts non-negative integers
 *   4. `location` valid (kind in union, bodyId non-empty)
 *   5. `fleet`/`wallet` finite non-negative
 *   6. shipyard eligibility (via shipyardStateFor level validation, then the
 *      documented ladder approximation — see the module docstring): level 0 →
 *      no-shipyard; fleet + size > fleetCap → fleet-cap; wallet short on
 *      credits → not-enough-credits; wallet short on alloys → not-enough-alloys.
 *
 * The fleet id is `fnv1a(`${ownerId}|${name}|${at}`).toString(16)`, its
 * `createdAt` is the request `at` (an input — no wall clock), and its status
 * starts 'idle'. The wallet is never debited — `cost` is the reservation.
 * Returns a fresh fleet; the request is never mutated.
 */
export function createFleet(request: FleetCreationRequest): {
  fleet: Fleet
  cost: { credits: number; alloys: number }
} {
  const { ownerId, name, composition, at, shipyardLevel, fleet, wallet, location } =
    request

  assertFinitePositive(at, 'at')
  assertNonEmptyString(ownerId, 'ownerId')
  assertValidComposition(composition)
  assertValidLocation(location)
  assertFiniteNonNegative(fleet, 'fleet')
  assertFiniteNonNegative(wallet.credits, 'wallet.credits')
  assertFiniteNonNegative(wallet.alloys, 'wallet.alloys')

  const size = fleetCompositionSize(composition)
  const cost = fleetCompositionCost(composition)
  const state = shipyardStateFor(shipyardLevel)

  if (shipyardLevel === 0) {
    throw new Error(
      `cannot create fleet: no-shipyard (shipyard level ${shipyardLevel})`,
    )
  }
  if (fleet + size > state.fleetCap) {
    throw new Error(
      `cannot create fleet: fleet-cap (fleet ${fleet} + new ${size} > cap ${state.fleetCap})`,
    )
  }
  if (wallet.credits < cost.credits) {
    throw new Error(
      `cannot create fleet: not-enough-credits (need ${cost.credits}, have ${wallet.credits})`,
    )
  }
  if (wallet.alloys < cost.alloys) {
    throw new Error(
      `cannot create fleet: not-enough-alloys (need ${cost.alloys}, have ${wallet.alloys})`,
    )
  }

  const id = fnv1a(`${ownerId}|${name}|${at}`).toString(16)

  return {
    fleet: {
      id,
      ownerId,
      name,
      composition: { ...composition },
      location: { ...location },
      createdAt: at,
      status: 'idle',
    },
    cost,
  }
}

/**
 * Structural invariants of a Fleet: id non-empty; ownerId non-empty;
 * composition counts non-negative integers; location kind in the union with a
 * non-empty bodyId; status in the union; createdAt finite > 0.
 */
export function fleetInvariants(fleet: Fleet): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  if (typeof fleet.id !== 'string' || fleet.id.length === 0) {
    problems.push(`fleet.id must be a non-empty string, got ${String(fleet.id)}`)
  }
  if (typeof fleet.ownerId !== 'string' || fleet.ownerId.length === 0) {
    problems.push(
      `fleet.ownerId must be a non-empty string, got ${String(fleet.ownerId)}`,
    )
  }

  for (const id of SHIP_CLASS_IDS) {
    const count = fleet.composition[id]
    if (!Number.isInteger(count) || count < 0) {
      problems.push(
        `fleet.composition.${id} must be a non-negative integer, got ${String(count)}`,
      )
    }
  }

  if (!(FLEET_LOCATION_KINDS as readonly string[]).includes(fleet.location.kind)) {
    problems.push(
      `fleet.location.kind must be 'planet' or 'system', got ${String(fleet.location.kind)}`,
    )
  }
  if (typeof fleet.location.bodyId !== 'string' || fleet.location.bodyId.length === 0) {
    problems.push('fleet.location.bodyId must be a non-empty string')
  }

  if (!(FLEET_STATUSES as readonly string[]).includes(fleet.status)) {
    problems.push(
      `fleet.status must be one of 'idle'|'traveling'|'combat'|'returning', ` +
        `got ${String(fleet.status)}`,
    )
  }

  if (!Number.isFinite(fleet.createdAt) || fleet.createdAt <= 0) {
    problems.push(
      `fleet.createdAt must be a finite number > 0, got ${fleet.createdAt}`,
    )
  }

  return { ok: problems.length === 0, problems }
}
