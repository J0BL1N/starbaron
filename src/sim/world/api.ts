/**
 * Client-side world-state query + projection layer (P1-T08).
 *
 * PURE module: every function derives only from its arguments and the
 * in-memory UniverseState it is given. No nondeterministic sources, wall-clock
 * timestamps, mutable module-level state, and no rendering
 * imports. The same state always yields the same results, so repeated calls
 * deep-equal.
 *
 * AUTHORISATION BOUNDARY: this module minimises payloads, it never
 * authorises. Server-side permission-gated projections (intel levels,
 * ownership) are implemented at the backend in later phases (P6/P10). Every
 * function here reads a fully-resolved, in-memory state with no auth context;
 * callers gate access to these results separately.
 *
 * PARENT-CHAIN CONTRACT: lookups never trust declared fields or registries
 * blindly. A system is returned only when its id parses, its declared galaxy
 * equals BOTH the canonical parent parsed from its id AND the state galaxy's
 * id, and the id is present in the state galaxy's registry. A body is returned
 * only when its declared system is the canonical parent of its id, it is
 * registered in that system's bodyIds, and that system resolves within the
 * state galaxy. Contradictions yield null for single-id lookups
 * (querySystem/queryBody) and are skipped by list queries
 * (querySystemsByGalaxy/queryBodiesBySystem). List results are derived in
 * canonical registry order (identity.ts 'Canonical registry order' — systems
 * by id, bodies by ordinal then id) and deduplicated by id, so a malformed
 * duplicated registry entry can never emit duplicate records.
 */

import type { UniverseState } from './reconstruct'
import type { GalaxyClass, GalaxyRecord } from './galaxy'
import type { SystemRecord } from './system'
import type { BodyOrbit, BodyRecord } from './body'
import { canonicalSystemOrder, parseCanonicalId, parentOf } from './identity'
import type { BodyId, BodyType, GalaxyId, SystemId } from './identity'

/** Resolve a galaxy record by id, or null when the state holds no such galaxy. */
export function queryGalaxy(state: UniverseState, id: GalaxyId): GalaxyRecord | null {
  return state.galaxy.id === id ? state.galaxy : null
}

/**
 * Canonical system resolution: the id must parse as a system, its declared
 * galaxy must equal BOTH the canonical parent of the id AND the state galaxy's
 * id (a self-consistent sys:<other>|seed registered in the state galaxy is a
 * foreign record, not found here), and the id must be registered in the state
 * galaxy's systemIds. Any contradiction yields null.
 */
function resolveSystem(state: UniverseState, id: SystemId): SystemRecord | null {
  const parsed = parseCanonicalId(id)
  if (!parsed.ok || parsed.kind !== 'system') {
    return null
  }
  const record = state.systems.find((system) => system.id === id)
  if (record === undefined) {
    return null
  }
  if (
    record.galaxy !== parentOf(id) ||
    record.galaxy !== state.galaxy.id ||
    !state.galaxy.systemIds.includes(id)
  ) {
    return null
  }
  return record
}

/**
 * Canonical body resolution: the id must parse as a body, its declared system
 * must equal the canonical parent of the id, the id must be registered in that
 * system's bodyIds, AND the owning system must resolve within the state galaxy
 * (a body whose system is a foreign, self-consistent record is not found).
 * Any contradiction yields null.
 */
function resolveBody(state: UniverseState, id: BodyId): BodyRecord | null {
  const parsed = parseCanonicalId(id)
  if (!parsed.ok || parsed.kind !== 'body') {
    return null
  }
  const record = state.bodies.find((body) => body.id === id)
  if (record === undefined) {
    return null
  }
  if (record.system !== parentOf(id)) {
    return null
  }
  const system = resolveSystem(state, record.system)
  if (system === null || !system.bodyIds.includes(id)) {
    return null
  }
  return record
}

/**
 * Canonical-parent membership of a body under a system: a body belongs to a
 * system exactly when its id parses as a body AND the canonical parent parsed
 * from the id equals the system id. A malformed id that merely shares a string
 * prefix never matches — parse is the gate, never a prefix test.
 */
function bodyBelongsTo(body: BodyRecord, systemId: SystemId): boolean {
  const parsed = parseCanonicalId(body.id)
  if (!parsed.ok || parsed.kind !== 'body') {
    return false
  }
  return parentOf(body.id) === systemId
}

/** Resolve a system record by id, or null when not present in the state. */
export function querySystem(state: UniverseState, id: SystemId): SystemRecord | null {
  return resolveSystem(state, id)
}

/** Resolve a body record by id, or null when not present in the state. */
export function queryBody(state: UniverseState, id: BodyId): BodyRecord | null {
  return resolveBody(state, id)
}

/**
 * All systems belonging to a galaxy, in CANONICAL order (systems sorted by id
 * string — identity.ts 'Canonical registry order'), never trusting the stored
 * registry's array order. Each system passes through resolveSystem first, so a
 * registered system whose id does not parse, whose declared galaxy disagrees
 * with the canonical parent of its id OR with the state galaxy, or which is
 * absent from the registry is skipped. Results are deduplicated by id (a
 * duplicated registry entry can never emit two distinct records). Returns []
 * when the galaxy id is not the state galaxy or the galaxy has no systems.
 */
export function querySystemsByGalaxy(
  state: UniverseState,
  galaxyId: GalaxyId,
): SystemRecord[] {
  if (state.galaxy.id !== galaxyId) {
    return []
  }
  const resolved = new Map<SystemId, SystemRecord>()
  for (const id of state.galaxy.systemIds) {
    const system = resolveSystem(state, id)
    if (system !== null) {
      resolved.set(system.id, system)
    }
  }
  const result: SystemRecord[] = []
  for (const id of canonicalSystemOrder([...resolved.keys()])) {
    const system = resolved.get(id)
    if (system !== undefined) {
      result.push(system)
    }
  }
  return result
}

/**
 * All bodies attached to a system, in CANONICAL order (bodies by ordinal, then
 * id string — identity.ts 'Canonical registry order'), never trusting the
 * stored registry's array order. Bodies whose canonical parent disagrees with
 * their declared system are excluded even when registered. Returns [] when the
 * system id is not in the state or the system has no bodies.
 */
export function queryBodiesBySystem(
  state: UniverseState,
  systemId: SystemId,
): BodyRecord[] {
  const system = resolveSystem(state, systemId)
  if (system === null) {
    return []
  }
  const registeredIds = new Set(system.bodyIds)
  return state.bodies
    .filter(
      (body) =>
        body.system === systemId &&
        registeredIds.has(body.id) &&
        bodyBelongsTo(body, systemId),
    )
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
 * Canonical gating: every candidate system passes through resolveSystem before
 * being emitted, so a registered system whose id does not parse, whose parent
 * chain is invalid (declared galaxy != canonical parent or != the state
 * galaxy, or id absent from the galaxy registry) is excluded from the region
 * results — the same semantics as querySystemsByGalaxy.
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
    .map((system) => resolveSystem(state, system.id))
    .filter((system): system is SystemRecord => system !== null)
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
