/**
 * Fleet PERSISTENCE (P5-T10) — the serialization contract for a fleet
 * snapshot (fleet + orders + route state) to/from JSON, with round-trip,
 * determinism and validation guarantees.
 *
 * ESTABLISHED PATTERN — this module follows the pure-sim serialization
 * contract of src/sim/world/reconstruct.ts (serializeUniverse /
 * deserializeUniverse): strict parse, collect problems, throw a descriptive
 * Error on every violation. The LENIENT "validate-or-default" style of
 * src/ui/save.ts is deliberately NOT used — fleet persistence is a pure
 * round-trip contract, not a tolerant rehydration path. (The brief points
 * at serializePlayer/deserializePlayer in src/sim/player/player.ts, but no
 * such functions exist there; the serialization pattern in the sim layer is
 * reconstruct.ts, which this module mirrors.)
 *
 * DESIGN decisions (all documented):
 * - **Deterministic key order:** serialization builds every object by hand
 *   in a FIXED, documented field order (below) and never relies on JS
 *   insertion order of dynamic maps and never re-sorts. The same snapshot
 *   always serializes to the byte-identical string. Serialized shapes
 *   (key order is the contract):
 *     snapshot : fleet, orders, routes
 *     fleet    : id, ownerId, name, composition{scout,corvette,frigate,
 *                cruiser,battleship}, location{kind,bodyId}, createdAt,
 *                status
 *     orders   : fleetId, activeOrderId, orders
 *     order    : id, fleetId, type, target{kind,id}|null, issuedAt, status,
 *                expiresAt|null
 *     route    : fleetId, waypoints, legs, totalDistancePc, totalDurationSec,
 *                departureAt, arrivalAt
 *     waypoint : ref{kind,bodyId}, position{x,y,z}
 *     leg      : fleetId, from{kind,bodyId}, to{kind,bodyId}, distancePc,
 *                speedPcPerSec, departureAt, arrivalAt, status
 * - **No undefined values (null instead):** JSON.stringify SILENTLY DROPS an
 *   `undefined` key, which would break the round-trip. Every optional field
 *   (orders, order.target, order.expiresAt, orders.activeOrderId) is
 *   serialized as `null`, never omitted, and the serialized tree is walked
 *   to throw if `undefined` ever sneaks in. The invariant pass rejects
 *   `undefined` in required fields before serialization.
 * - **Validate-then-serialize:** serializeFleetSnapshot validates the
 *   snapshot via snapshotInvariants FIRST and throws on invalid input — a
 *   corrupt snapshot can never be persisted.
 * - **Strict deserialize:** deserializeFleetSnapshot uses JSON.parse (which
 *   natively REJECTS trailing content after the value — JSON.parse requires
 *   the whole input to be one complete JSON value) followed by a deep
 *   structural validation pass over the UNKNOWN parsed value (total — it
 *   never throws on garbage input, it reports problems) and finally re-runs
 *   snapshotInvariants on the rebuilt snapshot. Each problem → a descriptive
 *   Error. The shape pass also rejects UNEXPECTED keys (exact-key checks),
 *   so a persisted snapshot with schema drift fails loudly instead of being
 *   silently re-read.
 * - **Round-trip guarantee:** deserialize(serialize(x)) deep-equals x for
 *   every canonical snapshot (one that passes snapshotInvariants). The
 *   hand-built serialized tree carries exactly the validated fields, the
 *   parse pass reconstructs exactly those fields, and the invariant re-check
 *   keeps the round trip closed.
 * - **Cross-fleet composition:** orders (when present), every route, and every
 *   route leg must reference the snapshot's fleet.id (their fleetId equals
 *   fleet.id) — a persisted snapshot must not hold orphaned orders/routes.
 * - **Route shape checks (local, documented — routes.ts exports no invariant
 *   collector; its assertRouteShape throws instead of reporting):** waypoints
 *   >= 2; legs = waypoints − 1; per-leg refs/status/timing validity; legs
 *   chain sequentially (leg i+1 departs when leg i arrives); the first leg
 *   departs at route.departureAt; the final leg arrives at route.arrivalAt;
 *   arrivalAt strictly after departureAt; totalDistancePc equals Σ leg
 *   distancePc and totalDurationSec equals Σ travelDuration(leg.distancePc,
 *   leg.speedPcPerSec) — the EXACT accumulation planRoute performs, so
 *   planRoute-built routes always satisfy the checks.
 * - **Route GEOMETRY checks (persistence finding 4) — legs must connect to
 *   their waypoints:** per leg i, (a) leg[i].from equals waypoint[i].ref and
 *   leg[i].to equals waypoint[i+1].ref (kind + bodyId); (b) leg[i].distancePc
 *   equals `distanceBetween(waypoint[i].position, waypoint[i+1].position)`
 *   within the RELATIVE epsilon `ROUTE_GEOMETRY_EPSILON` (1e-9 of the computed
 *   distance); (c) leg[i].arrivalAt equals `movement.arrivalTime(leg[i]
 *   .departureAt, leg[i].distancePc, leg[i].speedPcPerSec)` recomputed — EXACT
 *   equality, since both the planRoute accumulation and this recomputation are
 *   bit-deterministic on the same doubles. A route whose waypoints say A→B but
 *   whose leg travels A→C now fails even when the totals agree. These checks
 *   run inside snapshotInvariants (which serialize validates up-front and
 *   deserialize re-runs after its deep parse), so both the serialize gate and
 *   the deserialize path enforce the geometry contract.
 *
 * Pure module — deterministic, no time-source reads (every timestamp is an
 * INPUT), no nondeterministic APIs, no module-level mutable state, strictly
 * typed (no untyped escapes).
 */

import { fleetInvariants } from './fleet'
import type { Fleet, FleetComposition, FleetLocation } from './fleet'
import { ordersInvariants } from './orders'
import type { FleetOrder, FleetOrders, FleetOrderTarget } from './orders'
import type { TravelRoute, Waypoint } from './routes'
import { travelDuration, distanceBetween, arrivalTime } from './movement'
import type { Position, TravelLeg, TravelRef } from './movement'

/** A persistable fleet state: its fleet plus optional orders and routes. */
export interface FleetSnapshot {
  fleet: Fleet
  orders: FleetOrders | null
  routes: TravelRoute[]
}

/**
 * Relative epsilon for the route-geometry invariant: a leg's stored
 * `distancePc` must match `distanceBetween(waypoint[i].position,
 * waypoint[i+1].position)` within this RELATIVE tolerance (1e-9 of the
 * computed distance). The recomputed arrival is compared EXACTLY — planRoute
 * and the recomputation are bit-deterministic on the same doubles.
 */
export const ROUTE_GEOMETRY_EPSILON = 1e-9

/** Deep-frozen lookup tables (module-level tables are runtime-immutable). */
export const FLEET_STATUSES: readonly string[] = Object.freeze([
  'idle',
  'traveling',
  'combat',
  'returning',
])
export const FLEET_LOCATION_KINDS: readonly string[] = Object.freeze([
  'planet',
  'system',
])
export const ORDER_TYPES: readonly string[] = Object.freeze([
  'move',
  'attack',
  'defend',
  'return',
])
export const ORDER_STATUSES: readonly string[] = Object.freeze([
  'issued',
  'active',
  'done',
  'cancelled',
])
export const TARGET_KINDS: readonly string[] = Object.freeze([
  'planet',
  'system',
  'body',
])
export const TRAVEL_REF_KINDS: readonly string[] = Object.freeze([
  'planet',
  'system',
])
export const TRAVEL_STATUSES: readonly string[] = Object.freeze([
  'traveling',
  'arrived',
])
export const COMPOSITION_KEYS: readonly string[] = Object.freeze([
  'scout',
  'corvette',
  'frigate',
  'cruiser',
  'battleship',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------
// Serialization — hand-built objects in the documented key order.
// ---------------------------------------------------------------------

function serializeFleet(fleet: Fleet): Record<string, unknown> {
  return {
    id: fleet.id,
    ownerId: fleet.ownerId,
    name: fleet.name,
    composition: {
      scout: fleet.composition.scout,
      corvette: fleet.composition.corvette,
      frigate: fleet.composition.frigate,
      cruiser: fleet.composition.cruiser,
      battleship: fleet.composition.battleship,
    },
    location: { kind: fleet.location.kind, bodyId: fleet.location.bodyId },
    createdAt: fleet.createdAt,
    status: fleet.status,
  }
}

function serializeTarget(
  target: FleetOrderTarget | null,
): Record<string, string> | null {
  if (target === null) return null
  return { kind: target.kind, id: target.id }
}

function serializeOrder(order: FleetOrder): Record<string, unknown> {
  return {
    id: order.id,
    fleetId: order.fleetId,
    type: order.type,
    target: serializeTarget(order.target),
    issuedAt: order.issuedAt,
    status: order.status,
    expiresAt: order.expiresAt,
  }
}

function serializeOrders(orders: FleetOrders): Record<string, unknown> {
  return {
    fleetId: orders.fleetId,
    activeOrderId: orders.activeOrderId,
    orders: orders.orders.map(serializeOrder),
  }
}

function serializeRef(ref: TravelRef): Record<string, string> {
  return { kind: ref.kind, bodyId: ref.bodyId }
}

function serializeWaypoint(waypoint: Waypoint): Record<string, unknown> {
  return {
    ref: serializeRef(waypoint.ref),
    position: {
      x: waypoint.position.x,
      y: waypoint.position.y,
      z: waypoint.position.z,
    },
  }
}

function serializeLeg(leg: TravelLeg): Record<string, unknown> {
  return {
    fleetId: leg.fleetId,
    from: serializeRef(leg.from),
    to: serializeRef(leg.to),
    distancePc: leg.distancePc,
    speedPcPerSec: leg.speedPcPerSec,
    departureAt: leg.departureAt,
    arrivalAt: leg.arrivalAt,
    status: leg.status,
  }
}

function serializeRoute(route: TravelRoute): Record<string, unknown> {
  return {
    fleetId: route.fleetId,
    waypoints: route.waypoints.map(serializeWaypoint),
    legs: route.legs.map(serializeLeg),
    totalDistancePc: route.totalDistancePc,
    totalDurationSec: route.totalDurationSec,
    departureAt: route.departureAt,
    arrivalAt: route.arrivalAt,
  }
}

/**
 * Walks a serialized tree and throws on every `undefined` value — the "no
 * undefined values" contract made literal. The invariant pass already
 * guarantees this; the walk is belt-and-braces so JSON.stringify can never
 * silently DROP a key.
 */
function assertNoUndefined(value: unknown, path: string): void {
  if (value === undefined) {
    throw new Error(
      `serializeFleetSnapshot: field '${path}' is undefined — serialize null instead`,
    )
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoUndefined(value[i], `${path}[${i}]`)
    }
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      assertNoUndefined((value as Record<string, unknown>)[key], `${path}.${key}`)
    }
  }
}

// ---------------------------------------------------------------------
// Invariants.
// ---------------------------------------------------------------------

function refProblems(ref: TravelRef, path: string): string[] {
  const problems: string[] = []
  if (!isRecord(ref)) {
    problems.push(`${path} must be an object with kind and bodyId`)
    return problems
  }
  if (!(TRAVEL_REF_KINDS as readonly string[]).includes(ref.kind)) {
    problems.push(
      `${path}.kind must be 'planet' or 'system', got ${String(ref.kind)}`,
    )
  }
  if (typeof ref.bodyId !== 'string' || ref.bodyId.length === 0) {
    problems.push(`${path}.bodyId must be a non-empty string`)
  }
  return problems
}

/** Defensively extracts a TravelRef from unknown — null when the shape is bad. */
function asRef(value: unknown): TravelRef | null {
  if (!isRecord(value)) return null
  if (typeof value.kind !== 'string' || typeof value.bodyId !== 'string') {
    return null
  }
  return { kind: value.kind as TravelRef['kind'], bodyId: value.bodyId }
}

/** Whether an unknown value is a position with finite x/y/z coordinates. */
function isFinitePosition(value: unknown): value is Position {
  return (
    isRecord(value) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  )
}

/**
 * Per-route structural invariants (local — routes.ts exports no invariant
 * collector; its assertRouteShape throws). Total: never throws on garbage.
 * See the module docstring for the full list of checks.
 */
function routeInvariantProblems(route: TravelRoute, index: number): string[] {
  const problems: string[] = []
  const p = `routes[${index}]`
  const waypoints = route.waypoints
  const legs = route.legs
  const waypointsOk = Array.isArray(waypoints)
  const legsOk = Array.isArray(legs)

  if (typeof route.fleetId !== 'string' || route.fleetId.length === 0) {
    problems.push(`${p}.fleetId must be a non-empty string`)
  }
  if (!waypointsOk) {
    problems.push(`${p}.waypoints must be an array`)
  } else if (waypoints.length < 2) {
    problems.push(
      `${p} needs at least 2 waypoints (a route with fewer has no movement)`,
    )
  }
  if (!legsOk) {
    problems.push(`${p}.legs must be an array`)
  } else if (waypointsOk && legs.length !== waypoints.length - 1) {
    problems.push(
      `${p} leg count must equal waypoints - 1 (${waypoints.length - 1}), got ${legs.length}`,
    )
  }
  if (!Number.isFinite(route.departureAt) || route.departureAt <= 0) {
    problems.push(`${p}.departureAt must be a finite number > 0`)
  }
  if (!Number.isFinite(route.arrivalAt)) {
    problems.push(`${p}.arrivalAt must be a finite number`)
  } else if (
    Number.isFinite(route.departureAt) &&
    route.arrivalAt <= route.departureAt
  ) {
    problems.push(
      `${p}.arrivalAt (${route.arrivalAt}) must be strictly after departureAt (${route.departureAt})`,
    )
  }
  if (
    typeof route.totalDistancePc !== 'number' ||
    !Number.isFinite(route.totalDistancePc) ||
    route.totalDistancePc < 0
  ) {
    problems.push(`${p}.totalDistancePc must be a finite number >= 0`)
  }
  if (
    typeof route.totalDurationSec !== 'number' ||
    !Number.isFinite(route.totalDurationSec) ||
    route.totalDurationSec < 0
  ) {
    problems.push(`${p}.totalDurationSec must be a finite number >= 0`)
  }

  if (waypointsOk) {
    for (let i = 0; i < waypoints.length; i++) {
      const waypoint = waypoints[i]
      const wp = `${p}.waypoints[${i}]`
      if (!isRecord(waypoint)) {
        problems.push(`${wp} must be an object with ref and position`)
        continue
      }
      problems.push(...refProblems(waypoint.ref as TravelRef, `${wp}.ref`))
      const position = waypoint.position as Position | undefined
      if (!isRecord(position)) {
        problems.push(`${wp}.position must be an object`)
      } else if (
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(position.z)
      ) {
        problems.push(`${wp}.position must have finite x/y/z coordinates`)
      }
    }
  }

  if (legsOk) {
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]
      const lp = `${p}.legs[${i}]`
      if (!isRecord(leg)) {
        problems.push(`${lp} must be an object`)
        continue
      }
      if (typeof leg.fleetId !== 'string' || leg.fleetId.length === 0) {
        problems.push(`${lp}.fleetId must be a non-empty string`)
      } else if (leg.fleetId !== route.fleetId) {
        problems.push(
          `${lp}.fleetId (${JSON.stringify(leg.fleetId)}) must equal ` +
            `route.fleetId (${JSON.stringify(route.fleetId)})`,
        )
      }
      problems.push(...refProblems(leg.from as TravelRef, `${lp}.from`))
      problems.push(...refProblems(leg.to as TravelRef, `${lp}.to`))
      if (
        typeof leg.distancePc !== 'number' ||
        !Number.isFinite(leg.distancePc) ||
        leg.distancePc < 0
      ) {
        problems.push(`${lp}.distancePc must be a finite number >= 0`)
      }
      if (
        typeof leg.speedPcPerSec !== 'number' ||
        !Number.isFinite(leg.speedPcPerSec) ||
        leg.speedPcPerSec <= 0
      ) {
        problems.push(`${lp}.speedPcPerSec must be a finite number > 0`)
      }
      if (
        typeof leg.departureAt !== 'number' ||
        !Number.isFinite(leg.departureAt) ||
        leg.departureAt <= 0
      ) {
        problems.push(`${lp}.departureAt must be a finite number > 0`)
      }
      if (typeof leg.arrivalAt !== 'number' || !Number.isFinite(leg.arrivalAt)) {
        problems.push(`${lp}.arrivalAt must be a finite number`)
      } else if (
        typeof leg.departureAt === 'number' &&
        Number.isFinite(leg.departureAt) &&
        leg.arrivalAt <= leg.departureAt
      ) {
        problems.push(
          `${lp}.arrivalAt (${leg.arrivalAt}) must be strictly after departureAt (${leg.departureAt})`,
        )
      }
      if (!(TRAVEL_STATUSES as readonly string[]).includes(leg.status)) {
        problems.push(
          `${lp}.status must be 'traveling' or 'arrived', got ${String(leg.status)}`,
        )
      }
    }
  }

  if (waypointsOk && legsOk && legs.length === waypoints.length - 1) {
    if (legs.length >= 1) {
      if (legs[0].departureAt !== route.departureAt) {
        problems.push(`${p}.legs[0].departureAt must equal route.departureAt`)
      }
      const lastLeg = legs[legs.length - 1]
      if (lastLeg.arrivalAt !== route.arrivalAt) {
        problems.push(`${p}.arrivalAt must equal the final leg arrivalAt`)
      }
    }
    for (let i = 0; i + 1 < legs.length; i++) {
      if (legs[i + 1].departureAt !== legs[i].arrivalAt) {
        problems.push(
          `${p}.legs[${i + 1}].departureAt must equal legs[${i}].arrivalAt ` +
            '(sequential legs)',
        )
      }
    }
    const allLegsValid = legs.every(
      (leg) =>
        Number.isFinite(leg.distancePc) &&
        leg.distancePc >= 0 &&
        Number.isFinite(leg.speedPcPerSec) &&
        leg.speedPcPerSec > 0,
    )
    if (allLegsValid) {
      const sumDistance = legs.reduce((acc, leg) => acc + leg.distancePc, 0)
      if (route.totalDistancePc !== sumDistance) {
        problems.push(
          `${p}.totalDistancePc (${route.totalDistancePc}) must equal the sum ` +
            `of leg distances (${sumDistance})`,
        )
      }
      let sumDuration = 0
      for (const leg of legs) {
        sumDuration += travelDuration(leg.distancePc, leg.speedPcPerSec)
      }
      if (route.totalDurationSec !== sumDuration) {
        problems.push(
          `${p}.totalDurationSec (${route.totalDurationSec}) must equal ` +
            `Σ travelDuration(leg.distancePc, leg.speedPcPerSec) (${sumDuration})`,
        )
      }
    }

    // Route geometry: legs must connect to their waypoints. Defensive — never
    // throws on garbage; shape problems above already flag malformed entries.
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]
      const wpA = waypoints[i]
      const wpB = waypoints[i + 1]
      const lp = `${p}.legs[${i}]`
      const wpARecord = isRecord(wpA)
      const wpBRecord = isRecord(wpB)
      const legRecord = isRecord(leg)
      if (!wpARecord || !wpBRecord || !legRecord) continue

      const wpARef = asRef(wpA.ref)
      const wpBRef = asRef(wpB.ref)
      const legFromRef = asRef(leg.from)
      const legToRef = asRef(leg.to)
      if (wpARef !== null && wpBRef !== null && legFromRef !== null && legToRef !== null) {
        if (legFromRef.kind !== wpARef.kind || legFromRef.bodyId !== wpARef.bodyId) {
          problems.push(
            `${lp}.from must equal waypoints[${i}].ref ` +
              `(${wpARef.kind}/${wpARef.bodyId}), got ${legFromRef.kind}/${legFromRef.bodyId}`,
          )
        }
        if (legToRef.kind !== wpBRef.kind || legToRef.bodyId !== wpBRef.bodyId) {
          problems.push(
            `${lp}.to must equal waypoints[${i + 1}].ref ` +
              `(${wpBRef.kind}/${wpBRef.bodyId}), got ${legToRef.kind}/${legToRef.bodyId}`,
          )
        }
      }

      const posA = isFinitePosition(wpA.position)
      const posB = isFinitePosition(wpB.position)
      if (posA && posB) {
        let computedDistance: number | null = null
        try {
          computedDistance = distanceBetween(wpA.position, wpB.position)
        } catch {
          computedDistance = null
        }
        if (computedDistance !== null) {
          const stored = leg.distancePc
          const tolerance = ROUTE_GEOMETRY_EPSILON * Math.abs(computedDistance)
          if (
            typeof stored !== 'number' ||
            !Number.isFinite(stored) ||
            Math.abs(stored - computedDistance) > tolerance
          ) {
            problems.push(
              `${lp}.distancePc (${String(stored)}) must equal ` +
                `distanceBetween(waypoints[${i}].position, waypoints[${i + 1}].position) ` +
                `(${computedDistance}) within a relative epsilon of ${ROUTE_GEOMETRY_EPSILON}`,
            )
          }
        }
      }

      const canRecomputeArrival =
        typeof leg.departureAt === 'number' &&
        Number.isFinite(leg.departureAt) &&
        leg.departureAt > 0 &&
        typeof leg.speedPcPerSec === 'number' &&
        Number.isFinite(leg.speedPcPerSec) &&
        leg.speedPcPerSec > 0 &&
        typeof leg.distancePc === 'number' &&
        Number.isFinite(leg.distancePc) &&
        leg.distancePc > 0
      if (canRecomputeArrival) {
        let recomputedArrival: number | null = null
        try {
          recomputedArrival = arrivalTime(
            leg.departureAt,
            leg.distancePc,
            leg.speedPcPerSec,
          )
        } catch {
          recomputedArrival = null
        }
        if (recomputedArrival !== null && leg.arrivalAt !== recomputedArrival) {
          problems.push(
            `${lp}.arrivalAt (${String(leg.arrivalAt)}) must equal ` +
              `arrivalTime(departureAt ${leg.departureAt}, distancePc ${leg.distancePc}, ` +
              `speed ${leg.speedPcPerSec}) recomputed (${recomputedArrival})`,
          )
        }
      }
    }
  }

  return problems
}

/** Runs an invariant collector defensively — never throws on garbage. */
function safeProblems(
  label: string,
  collect: () => { ok: boolean; problems: string[] },
): string[] {
  try {
    return collect().problems
  } catch (error) {
    return [`${label} raised ${String(error)}`]
  }
}

/**
 * Structural invariants of a FleetSnapshot: fleetInvariants + ordersInvariants
 * (when orders is present) + the route shape checks above + the cross-fleet
 * composition check (orders.fleetId and every route.fleetId equal fleet.id).
 * Total — never throws on garbage input.
 */
export function snapshotInvariants(snapshot: FleetSnapshot): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []
  problems.push(...safeProblems('fleet', () => fleetInvariants(snapshot.fleet)))

  const orders = snapshot.orders
  if (orders !== null) {
    problems.push(...safeProblems('orders', () => ordersInvariants(orders)))
    if (orders.fleetId !== snapshot.fleet.id) {
      problems.push(
        `orders.fleetId (${JSON.stringify(orders.fleetId)}) must equal ` +
          `fleet.id (${JSON.stringify(snapshot.fleet.id)})`,
      )
    }
  }

  if (!Array.isArray(snapshot.routes)) {
    problems.push('routes must be an array')
  } else {
    for (let i = 0; i < snapshot.routes.length; i++) {
      const route = snapshot.routes[i]
      problems.push(...routeInvariantProblems(route, i))
      if (route.fleetId !== snapshot.fleet.id) {
        problems.push(
          `routes[${i}].fleetId (${JSON.stringify(route.fleetId)}) must equal ` +
            `fleet.id (${JSON.stringify(snapshot.fleet.id)})`,
        )
      }
    }
  }

  return { ok: problems.length === 0, problems }
}

// ---------------------------------------------------------------------
// Serialize.
// ---------------------------------------------------------------------

/**
 * Deterministically serializes a fleet snapshot to a JSON string. Validates
 * the snapshot via snapshotInvariants first and throws on each violation (a
 * corrupt snapshot is never persisted). The output is byte-stable for the
 * same snapshot and has the documented key order — see the module docstring.
 */
export function serializeFleetSnapshot(snapshot: FleetSnapshot): string {
  const invariants = snapshotInvariants(snapshot)
  if (!invariants.ok) {
    throw new Error(
      `serializeFleetSnapshot: cannot serialize invalid snapshot: ` +
        invariants.problems.join('; '),
    )
  }
  const tree: Record<string, unknown> = {
    fleet: serializeFleet(snapshot.fleet),
    orders: snapshot.orders === null ? null : serializeOrders(snapshot.orders),
    routes: snapshot.routes.map(serializeRoute),
  }
  assertNoUndefined(tree, 'snapshot')
  const json = JSON.stringify(tree)
  if (json === undefined) {
    throw new Error('serializeFleetSnapshot: snapshot is not JSON-serializable')
  }
  return json
}

// ---------------------------------------------------------------------
// Deserialize — strict shape pass + invariant re-validation.
// ---------------------------------------------------------------------

function emptyFleet(): Fleet {
  return {
    id: '',
    ownerId: '',
    name: '',
    composition: { scout: 0, corvette: 0, frigate: 0, cruiser: 0, battleship: 0 },
    location: { kind: 'planet', bodyId: '' },
    createdAt: 0,
    status: 'idle',
  }
}

function expectRecord(
  value: unknown,
  path: string,
  problems: string[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    problems.push(`${path} must be an object`)
    return null
  }
  return value
}

function checkKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  problems: string[],
): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      problems.push(`${path} is missing key '${key}'`)
    }
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      problems.push(`${path} has unexpected key '${key}'`)
    }
  }
}

function expectNonEmptyString(
  value: unknown,
  path: string,
  problems: string[],
): string {
  if (typeof value !== 'string' || value.length === 0) {
    problems.push(`${path} must be a non-empty string`)
    return ''
  }
  return value
}

function expectFiniteNumber(
  value: unknown,
  path: string,
  problems: string[],
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push(`${path} must be a finite number`)
    return 0
  }
  return value
}

function expectFinitePositive(
  value: unknown,
  path: string,
  problems: string[],
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    problems.push(`${path} must be a finite number > 0`)
    return 0
  }
  return value
}

function expectFiniteNonNegative(
  value: unknown,
  path: string,
  problems: string[],
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    problems.push(`${path} must be a finite number >= 0`)
    return 0
  }
  return value
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  problems: string[],
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    problems.push(
      `${path} must be one of ${allowed.map((option) => `'${option}'`).join('|')}`,
    )
    return allowed[0]
  }
  return value as T
}

function parseComposition(
  value: unknown,
  path: string,
  problems: string[],
): FleetComposition {
  const fallback: FleetComposition = {
    scout: 0,
    corvette: 0,
    frigate: 0,
    cruiser: 0,
    battleship: 0,
  }
  const rec = expectRecord(value, path, problems)
  if (rec === null) return fallback
  checkKeys(rec, COMPOSITION_KEYS, path, problems)
  const result: FleetComposition = { ...fallback }
  for (const key of COMPOSITION_KEYS) {
    const count = rec[key]
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      problems.push(`${path}.${key} must be a non-negative integer`)
    } else {
      result[key as keyof FleetComposition] = count
    }
  }
  return result
}

function parseLocation(
  value: unknown,
  path: string,
  problems: string[],
): FleetLocation {
  const rec = expectRecord(value, path, problems)
  if (rec === null) return { kind: 'planet', bodyId: '' }
  checkKeys(rec, ['kind', 'bodyId'], path, problems)
  const kind = expectEnum(rec.kind, FLEET_LOCATION_KINDS as readonly string[], `${path}.kind`, problems)
  const bodyId = expectNonEmptyString(rec.bodyId, `${path}.bodyId`, problems)
  return { kind: kind as FleetLocation['kind'], bodyId }
}

function parseFleet(value: unknown, problems: string[]): Fleet {
  const rec = expectRecord(value, 'fleet', problems)
  if (rec === null) return emptyFleet()
  checkKeys(
    rec,
    ['id', 'ownerId', 'name', 'composition', 'location', 'createdAt', 'status'],
    'fleet',
    problems,
  )
  const id = expectNonEmptyString(rec.id, 'fleet.id', problems)
  const ownerId = expectNonEmptyString(rec.ownerId, 'fleet.ownerId', problems)
  const name = expectNonEmptyString(rec.name, 'fleet.name', problems)
  const composition = parseComposition(rec.composition, 'fleet.composition', problems)
  const location = parseLocation(rec.location, 'fleet.location', problems)
  const createdAt = expectFinitePositive(rec.createdAt, 'fleet.createdAt', problems)
  const status = expectEnum(rec.status, FLEET_STATUSES as readonly string[], 'fleet.status', problems)
  return {
    id,
    ownerId,
    name,
    composition,
    location,
    createdAt,
    status: status as Fleet['status'],
  }
}

function parseOrderTarget(
  value: unknown,
  path: string,
  problems: string[],
): FleetOrderTarget | null {
  if (value === null) return null
  const rec = expectRecord(value, path, problems)
  if (rec === null) return null
  checkKeys(rec, ['kind', 'id'], path, problems)
  const kind = expectEnum(rec.kind, TARGET_KINDS as readonly string[], `${path}.kind`, problems)
  const id = expectNonEmptyString(rec.id, `${path}.id`, problems)
  return { kind: kind as FleetOrderTarget['kind'], id }
}

function parseNullableFiniteNumber(
  value: unknown,
  path: string,
  problems: string[],
): number | null {
  if (value === null) return null
  return expectFiniteNumber(value, path, problems)
}

function parseOrder(value: unknown, path: string, problems: string[]): FleetOrder {
  const rec = expectRecord(value, path, problems)
  if (rec === null) {
    return {
      id: '',
      fleetId: '',
      type: 'move',
      target: null,
      issuedAt: 0,
      status: 'issued',
      expiresAt: null,
    }
  }
  checkKeys(
    rec,
    ['id', 'fleetId', 'type', 'target', 'issuedAt', 'status', 'expiresAt'],
    path,
    problems,
  )
  const id = expectNonEmptyString(rec.id, `${path}.id`, problems)
  const fleetId = expectNonEmptyString(rec.fleetId, `${path}.fleetId`, problems)
  const type = expectEnum(rec.type, ORDER_TYPES as readonly string[], `${path}.type`, problems)
  const target = parseOrderTarget(rec.target, `${path}.target`, problems)
  const issuedAt = expectFinitePositive(rec.issuedAt, `${path}.issuedAt`, problems)
  const status = expectEnum(rec.status, ORDER_STATUSES as readonly string[], `${path}.status`, problems)
  const expiresAt = parseNullableFiniteNumber(rec.expiresAt, `${path}.expiresAt`, problems)
  return {
    id,
    fleetId,
    type: type as FleetOrder['type'],
    target,
    issuedAt,
    status: status as FleetOrder['status'],
    expiresAt,
  }
}

function parseOrders(value: unknown, problems: string[]): FleetOrders {
  const rec = expectRecord(value, 'orders', problems)
  if (rec === null) return { fleetId: '', orders: [], activeOrderId: null }
  checkKeys(rec, ['fleetId', 'activeOrderId', 'orders'], 'orders', problems)
  const fleetId = expectNonEmptyString(rec.fleetId, 'orders.fleetId', problems)
  let orders: FleetOrder[] = []
  if (!Array.isArray(rec.orders)) {
    problems.push('orders.orders must be an array')
  } else {
    orders = rec.orders.map((entry, i) =>
      parseOrder(entry, `orders.orders[${i}]`, problems),
    )
  }
  let activeOrderId: string | null = null
  if (rec.activeOrderId !== null) {
    activeOrderId = expectNonEmptyString(
      rec.activeOrderId,
      'orders.activeOrderId',
      problems,
    )
  }
  return { fleetId, orders, activeOrderId }
}

function parseRef(value: unknown, path: string, problems: string[]): TravelRef {
  const rec = expectRecord(value, path, problems)
  if (rec === null) return { kind: 'planet', bodyId: '' }
  checkKeys(rec, ['kind', 'bodyId'], path, problems)
  const kind = expectEnum(rec.kind, TRAVEL_REF_KINDS as readonly string[], `${path}.kind`, problems)
  const bodyId = expectNonEmptyString(rec.bodyId, `${path}.bodyId`, problems)
  return { kind: kind as TravelRef['kind'], bodyId }
}

function parsePosition(value: unknown, path: string, problems: string[]): Position {
  const rec = expectRecord(value, path, problems)
  if (rec === null) return { x: 0, y: 0, z: 0 }
  checkKeys(rec, ['x', 'y', 'z'], path, problems)
  return {
    x: expectFiniteNumber(rec.x, `${path}.x`, problems),
    y: expectFiniteNumber(rec.y, `${path}.y`, problems),
    z: expectFiniteNumber(rec.z, `${path}.z`, problems),
  }
}

function parseWaypoint(value: unknown, path: string, problems: string[]): Waypoint {
  const rec = expectRecord(value, path, problems)
  if (rec === null) {
    return { ref: { kind: 'planet', bodyId: '' }, position: { x: 0, y: 0, z: 0 } }
  }
  checkKeys(rec, ['ref', 'position'], path, problems)
  const ref = parseRef(rec.ref, `${path}.ref`, problems)
  const position = parsePosition(rec.position, `${path}.position`, problems)
  return { ref, position }
}

function parseLeg(value: unknown, path: string, problems: string[]): TravelLeg {
  const rec = expectRecord(value, path, problems)
  if (rec === null) {
    return {
      fleetId: '',
      from: { kind: 'planet', bodyId: '' },
      to: { kind: 'planet', bodyId: '' },
      distancePc: 0,
      speedPcPerSec: 0,
      departureAt: 0,
      arrivalAt: 0,
      status: 'traveling',
    }
  }
  checkKeys(
    rec,
    [
      'fleetId',
      'from',
      'to',
      'distancePc',
      'speedPcPerSec',
      'departureAt',
      'arrivalAt',
      'status',
    ],
    path,
    problems,
  )
  const fleetId = expectNonEmptyString(rec.fleetId, `${path}.fleetId`, problems)
  const from = parseRef(rec.from, `${path}.from`, problems)
  const to = parseRef(rec.to, `${path}.to`, problems)
  const distancePc = expectFiniteNonNegative(rec.distancePc, `${path}.distancePc`, problems)
  const speedPcPerSec = expectFinitePositive(rec.speedPcPerSec, `${path}.speedPcPerSec`, problems)
  const departureAt = expectFinitePositive(rec.departureAt, `${path}.departureAt`, problems)
  const arrivalAt = expectFiniteNumber(rec.arrivalAt, `${path}.arrivalAt`, problems)
  const status = expectEnum(rec.status, TRAVEL_STATUSES as readonly string[], `${path}.status`, problems)
  return {
    fleetId,
    from,
    to,
    distancePc,
    speedPcPerSec,
    departureAt,
    arrivalAt,
    status: status as TravelLeg['status'],
  }
}

function parseRoute(value: unknown, path: string, problems: string[]): TravelRoute {
  const rec = expectRecord(value, path, problems)
  if (rec === null) {
    return {
      fleetId: '',
      waypoints: [],
      legs: [],
      totalDistancePc: 0,
      totalDurationSec: 0,
      departureAt: 0,
      arrivalAt: 0,
    }
  }
  checkKeys(
    rec,
    [
      'fleetId',
      'waypoints',
      'legs',
      'totalDistancePc',
      'totalDurationSec',
      'departureAt',
      'arrivalAt',
    ],
    path,
    problems,
  )
  const fleetId = expectNonEmptyString(rec.fleetId, `${path}.fleetId`, problems)
  let waypoints: Waypoint[] = []
  if (!Array.isArray(rec.waypoints)) {
    problems.push(`${path}.waypoints must be an array`)
  } else {
    waypoints = rec.waypoints.map((entry, i) =>
      parseWaypoint(entry, `${path}.waypoints[${i}]`, problems),
    )
  }
  let legs: TravelLeg[] = []
  if (!Array.isArray(rec.legs)) {
    problems.push(`${path}.legs must be an array`)
  } else {
    legs = rec.legs.map((entry, i) =>
      parseLeg(entry, `${path}.legs[${i}]`, problems),
    )
  }
  const totalDistancePc = expectFiniteNonNegative(
    rec.totalDistancePc,
    `${path}.totalDistancePc`,
    problems,
  )
  const totalDurationSec = expectFiniteNonNegative(
    rec.totalDurationSec,
    `${path}.totalDurationSec`,
    problems,
  )
  const departureAt = expectFinitePositive(rec.departureAt, `${path}.departureAt`, problems)
  const arrivalAt = expectFiniteNumber(rec.arrivalAt, `${path}.arrivalAt`, problems)
  return {
    fleetId,
    waypoints,
    legs,
    totalDistancePc,
    totalDurationSec,
    departureAt,
    arrivalAt,
  }
}

function parseSnapshotValue(value: unknown): {
  problems: string[]
  snapshot: FleetSnapshot
} {
  const problems: string[] = []
  const rec = expectRecord(value, 'snapshot', problems)
  if (rec === null) {
    return { problems, snapshot: { fleet: emptyFleet(), orders: null, routes: [] } }
  }
  checkKeys(rec, ['fleet', 'orders', 'routes'], 'snapshot', problems)
  const fleet = parseFleet(rec.fleet, problems)
  const orders =
    rec.orders === null ? null : parseOrders(rec.orders, problems)
  let routes: TravelRoute[] = []
  if (!Array.isArray(rec.routes)) {
    problems.push('routes must be an array')
  } else {
    routes = rec.routes.map((entry, i) =>
      parseRoute(entry, `routes[${i}]`, problems),
    )
  }
  return { problems, snapshot: { fleet, orders, routes } }
}

/**
 * Strictly parses a serialized fleet snapshot. JSON.parse is used as-is (it
 * natively rejects trailing content — the whole input must be one complete
 * JSON value), followed by a deep structural validation pass over the raw
 * value (total, exact-key checks, enum/type/shape validation) and a final
 * snapshotInvariants re-check on the rebuilt snapshot. Throws a descriptive
 * Error on malformed JSON, wrong shapes or each invariant violation.
 * Round-trip guarantee: deserialize(serialize(x)) deep-equals x for every
 * canonical snapshot.
 */
export function deserializeFleetSnapshot(json: string): FleetSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('deserializeFleetSnapshot: payload is not valid JSON')
  }
  const { problems, snapshot } = parseSnapshotValue(parsed)
  if (problems.length > 0) {
    throw new Error(
      `deserializeFleetSnapshot: invalid fleet snapshot: ${problems.join('; ')}`,
    )
  }
  const invariants = snapshotInvariants(snapshot)
  if (!invariants.ok) {
    throw new Error(
      `deserializeFleetSnapshot: invariant violation: ${invariants.problems.join('; ')}`,
    )
  }
  return snapshot
}
