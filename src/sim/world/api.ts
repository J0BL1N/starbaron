/**
 * Client-side world-state query + projection layer (P1-T08).
 *
 * PURE module: every function derives only from its arguments and the
 * in-memory UniverseState it is given. No nondeterministic sources, wall-clock
 * timestamps, global state, or mutable module-level state, and no rendering
 * imports. The same state always yields the same results, so repeated calls
 * deep-equal.
 *
 * AUTHORISATION BOUNDARY: this module minimises payloads, it never
 * authorises. Server-side permission-gated projections (intel levels,
 * ownership) are implemented at the backend in later phases (P6/P10). Every
 * function here reads a fully-resolved, in-memory state with no auth context;
 * callers gate access to these results separately.
 */

import type { UniverseState } from './reconstruct'
import type { GalaxyClass, GalaxyRecord } from './galaxy'
import type { SystemRecord } from './system'
import type { BodyOrbit, BodyRecord } from './body'
import type { BodyId, BodyType, GalaxyId, SystemId } from './identity'

/** Resolve a galaxy record by id, or null when the state holds no such galaxy. */
export function queryGalaxy(state: UniverseState, id: GalaxyId): GalaxyRecord | null {
  return state.galaxy.id === id ? state.galaxy : null
}

/** Resolve a system record by id, or null when not present in the state. */
export function querySystem(state: UniverseState, id: SystemId): SystemRecord | null {
  return state.systems.find((system) => system.id === id) ?? null
}

/** Resolve a body record by id, or null when not present in the state. */
export function queryBody(state: UniverseState, id: BodyId): BodyRecord | null {
  return state.bodies.find((body) => body.id === id) ?? null
}

/**
 * All systems belonging to a galaxy, in the galaxy's registry order (stable
 * and deterministic). Returns [] when the galaxy id is not the state galaxy
 * or the galaxy has no systems.
 */
export function querySystemsByGalaxy(
  state: UniverseState,
  galaxyId: GalaxyId,
): SystemRecord[] {
  if (state.galaxy.id !== galaxyId) {
    return []
  }
  const byId = new Map(state.systems.map((system) => [system.id, system]))
  const result: SystemRecord[] = []
  for (const id of state.galaxy.systemIds) {
    const system = byId.get(id)
    if (system !== undefined) {
      result.push(system)
    }
  }
  return result
}

/**
 * All bodies attached to a system, sorted by ordinal (ascending) with an id
 * tie-break so the order is fully deterministic. Returns [] when the system
 * id is not in the state or the system has no bodies.
 */
export function queryBodiesBySystem(
  state: UniverseState,
  systemId: SystemId,
): BodyRecord[] {
  if (!state.systems.some((system) => system.id === systemId)) {
    return []
  }
  return state.bodies
    .filter((body) => body.system === systemId)
    .sort(
      (a, b) =>
        a.ordinal - b.ordinal || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
}

/** Result of a spatial region query over a single galaxy. */
export interface RegionQueryResult {
  systems: SystemRecord[]
  bodies: BodyRecord[]
}

function squaredDistance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

/**
 * Spatially query a galaxy-local region: systems whose position lies within
 * `radius` of `center` (Euclidean distance, inclusive), plus the bodies of
 * those systems. Bodies do not carry galaxy positions — the world state only
 * stores per-system orbital elements — so a body is included when its SYSTEM
 * is within the radius.
 *
 * Throws a descriptive Error when radius is negative or not finite.
 * Results are deterministic: both arrays are sorted by id.
 */
export function regionQuery(
  state: UniverseState,
  center: { x: number; y: number; z: number },
  radius: number,
): RegionQueryResult {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new Error(
      `regionQuery: radius must be a finite non-negative number, got ${radius}`,
    )
  }
  const radiusSquared = radius * radius
  const systems = state.systems
    .filter((system) => squaredDistance(center, system.position) <= radiusSquared)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const bodies = systems
    .flatMap((system) => queryBodiesBySystem(state, system.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { systems, bodies }
}

/** Compact HUD/hover projection of a galaxy. No registries or provenance. */
export interface GalaxySummary {
  id: GalaxyId
  name: string
  position: { x: number; y: number; z: number }
  class: GalaxyClass
  radius: number
}

/** Compact HUD/hover projection of a system. No registries or provenance. */
export interface SystemSummary {
  id: SystemId
  name: string
  position: { x: number; y: number; z: number }
  starType: string | undefined
}

/** Compact HUD/hover projection of a body. No mass or provenance. */
export interface BodySummary {
  id: BodyId
  name: string
  type: BodyType
  radius: number
}

/** Compact galaxy projection for HUD/hover use. */
export function galaxySummary(galaxy: GalaxyRecord): GalaxySummary {
  return {
    id: galaxy.id,
    name: galaxy.name,
    position: { ...galaxy.position },
    class: galaxy.class,
    radius: galaxy.radius,
  }
}

/** Compact system projection for HUD/hover use. */
export function systemSummary(system: SystemRecord): SystemSummary {
  return {
    id: system.id,
    name: system.name,
    position: { ...system.position },
    starType: system.star.starType,
  }
}

/** Compact body projection for HUD/hover use. */
export function bodySummary(body: BodyRecord): BodySummary {
  return { id: body.id, name: body.name, type: body.type, radius: body.radius }
}

/** Minimal renderer bundle for a single galaxy. */
export interface RendererGalaxy {
  id: GalaxyId
  name: string
  seed: string
  position: { x: number; y: number; z: number }
  radius: number
  class: GalaxyClass
}

/** Minimal renderer bundle for a body: orbit elements only, no mass. */
export interface RendererBody {
  id: BodyId
  name: string
  type: BodyType
  radius: number
  orbit: BodyOrbit
}

/** Minimal renderer bundle for a system: no registries or provenance. */
export interface RendererSystem {
  id: SystemId
  name: string
  seed: string
  position: { x: number; y: number; z: number }
  starColor: string
  bodies: RendererBody[]
}

/**
 * Renderer-friendly projection of one galaxy and everything in it. Response
 * minimisation: no mass, provenance, generation, or registry fields anywhere
 * in the payload.
 */
export interface RendererPayload {
  galaxy: RendererGalaxy
  systems: RendererSystem[]
}

/**
 * Build the minimal renderer bundle for the focused galaxy. The payload
 * always contains every system of the galaxy (in registry order) with its
 * bodies (ordinal-sorted). `focus.systemId`, when provided, is validated to
 * belong to the focused galaxy — a systemId from another galaxy or absent
 * from the state throws a descriptive Error.
 */
export function rendererPayload(
  state: UniverseState,
  focus: { galaxyId: GalaxyId; systemId?: SystemId },
): RendererPayload {
  const galaxy = queryGalaxy(state, focus.galaxyId)
  if (galaxy === null) {
    throw new Error(
      `rendererPayload: no galaxy with id ${focus.galaxyId} in the state`,
    )
  }
  if (focus.systemId !== undefined) {
    const focused = querySystem(state, focus.systemId)
    if (focused === null || focused.galaxy !== galaxy.id) {
      throw new Error(
        `rendererPayload: focus system ${focus.systemId} is not in galaxy ${galaxy.id}`,
      )
    }
  }

  const systems = querySystemsByGalaxy(state, galaxy.id).map((system) => ({
    id: system.id,
    name: system.name,
    seed: system.seed,
    position: { ...system.position },
    starColor: system.star.color,
    bodies: queryBodiesBySystem(state, system.id).map((body) => ({
      id: body.id,
      name: body.name,
      type: body.type,
      radius: body.radius,
      orbit: { ...body.orbit },
    })),
  }))

  return {
    galaxy: {
      id: galaxy.id,
      name: galaxy.name,
      seed: galaxy.seed,
      position: { ...galaxy.position },
      radius: galaxy.radius,
      class: galaxy.class,
    },
    systems,
  }
}
