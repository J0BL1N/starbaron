/**
 * Empire territory projection (P2-T05): the pure, ownership-aware view of a
 * player's empire over the world state — owned bodies, controlled systems,
 * territory totals, and one aggregated summary.
 *
 * PURE module: every function derives only from its arguments (ownership
 * records + a resolved UniverseState + an owner id). No nondeterministic
 * APIs, no wall-clock, no module-level mutable state, no I/O.
 *
 * OWNERSHIP-INDEPENDENT RENDERING: the renderer never receives ownership
 * inside the world payload. `renderNeutralPayload` emits the universe with NO
 * owner fields — a body's id, name and type only. Ownership overlays arrive
 * through a SEPARATE payload (`ownershipOverlayPayload`), a compact
 * bodyId → ownerId map with no names, so the world render and the ownership
 * overlay stay decoupled (matches the roadmap 'ownership-independent
 * rendering').
 *
 * STATE-MEMBERSHIP SEMANTICS: `controlledSystemsFor` derives controlled
 * systems THROUGH the state (each owned body is resolved via queryBody, so a
 * system counts only when the owned body is actually registered in the
 * state's parent chain). An ownership record that references a body outside
 * the given state still counts toward `ownedBodies`/`ownedBodyIdsFor`
 * (records are the source of who-owns-what), but it can never contribute a
 * controlled system.
 *
 * ORDERING CONTRACT: `ownedBodyIdsFor` and `ownershipOverlayPayload` preserve
 * the input records order (deterministic); `controlledSystemsFor` dedupes
 * systems and emits them in canonical id order (identity.ts 'Canonical
 * registry order').
 */

import type { OwnershipRecord } from './ownership'
import type { UniverseState } from '../world/reconstruct'
import {
  queryBodiesBySystem,
  queryBody,
  querySystemsByGalaxy,
} from '../world/api'
import type { BodyId, BodyType, SystemId } from '../world/identity'
import { canonicalSystemOrder } from '../world/identity'

/** Territory counts for one empire. */
export interface TerritoryTotals {
  ownedBodies: number
  controlledSystems: number
  homeWorlds: number
  colonies: number
}

/** Aggregated territory view of one empire over the world state. */
export interface EmpireSummary {
  ownerId: string
  totals: TerritoryTotals
  ownedBodyIds: BodyId[]
  controlledSystemIds: SystemId[]
}

/** One system in the neutral renderer payload (id + display name only). */
export interface NeutralSystem {
  id: SystemId
  name: string
}

/** One body in the neutral renderer payload (id + display name + type only). */
export interface NeutralBody {
  id: BodyId
  name: string
  type: BodyType
}

/**
 * Ownership-independent renderer payload: every system and body of the state
 * galaxy with identity and display data only — never an owner field. The
 * renderer renders the universe from this; ownership overlays come from
 * `ownershipOverlayPayload` instead.
 */
export interface NeutralPayload {
  systems: NeutralSystem[]
  bodies: NeutralBody[]
}

/** One ownership overlay entry: which player holds a body. No names. */
export interface OwnershipOverlayEntry {
  bodyId: BodyId
  ownerId: string
}

/**
 * All body ids owned by a player, preserving the input records order
 * (deterministic). A record referencing a body outside the state is still
 * included — records are the source of who-owns-what.
 */
export function ownedBodyIdsFor(
  records: readonly OwnershipRecord[],
  ownerId: string,
): BodyId[] {
  return records.filter((record) => record.ownerId === ownerId).map(
    (record) => record.bodyId,
  )
}

/**
 * The systems controlled by a player: systems that contain at least one body
 * owned by the player AND present in the state. Ownership is derived through
 * the state — each owned body is resolved via queryBody, so a record that
 * references a body outside the state can never contribute a system. The
 * result is deduplicated and sorted by system id (canonical id order).
 */
export function controlledSystemsFor(
  records: readonly OwnershipRecord[],
  state: UniverseState,
  ownerId: string,
): SystemId[] {
  const systemIds = new Set<SystemId>()
  for (const bodyId of ownedBodyIdsFor(records, ownerId)) {
    const body = queryBody(state, bodyId)
    if (body !== null) {
      systemIds.add(body.system)
    }
  }
  return canonicalSystemOrder([...systemIds])
}

/** Territory counts for one empire. */
export function territoryTotalsFor(
  records: readonly OwnershipRecord[],
  state: UniverseState,
  ownerId: string,
): TerritoryTotals {
  const ownedRecords = records.filter((record) => record.ownerId === ownerId)
  let homeWorlds = 0
  let colonies = 0
  for (const record of ownedRecords) {
    if (record.isHome) {
      homeWorlds += 1
    } else {
      colonies += 1
    }
  }
  return {
    ownedBodies: ownedRecords.length,
    controlledSystems: controlledSystemsFor(records, state, ownerId).length,
    homeWorlds,
    colonies,
  }
}

/** Aggregated territory summary of one empire over the world state. */
export function empireSummaryFor(
  records: readonly OwnershipRecord[],
  state: UniverseState,
  ownerId: string,
): EmpireSummary {
  return {
    ownerId,
    totals: territoryTotalsFor(records, state, ownerId),
    ownedBodyIds: ownedBodyIdsFor(records, ownerId),
    controlledSystemIds: controlledSystemsFor(records, state, ownerId),
  }
}

/**
 * Ownership-independent renderer payload for the state galaxy: every system
 * (id + name) in canonical registry order and every body (id + name + type)
 * in canonical body order, with NO owner fields anywhere. The renderer draws
 * the universe from this payload alone; ownership overlays are supplied
 * separately by `ownershipOverlayPayload`.
 */
export function renderNeutralPayload(state: UniverseState): NeutralPayload {
  const systems = querySystemsByGalaxy(state, state.galaxy.id).map((system) => ({
    id: system.id,
    name: system.name,
  }))
  const bodies = systems.flatMap(({ id }) =>
    queryBodiesBySystem(state, id).map((body) => ({
      id: body.id,
      name: body.name,
      type: body.type,
    })),
  )
  return { systems, bodies }
}

/**
 * Compact ownership overlay for one player: a bodyId → ownerId map with no
 * names, preserving the input records order (deterministic). This is the ONLY
 * channel through which the renderer learns who owns what — it is never mixed
 * into the neutral world payload.
 */
export function ownershipOverlayPayload(
  records: readonly OwnershipRecord[],
  ownerId: string,
): OwnershipOverlayEntry[] {
  return ownedBodyIdsFor(records, ownerId).map((bodyId) => ({ bodyId, ownerId }))
}
