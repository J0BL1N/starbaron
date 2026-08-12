/**
 * Deterministic universe reconstruction (P1-T07).
 *
 * Pure module: a universe state derives entirely from a string seed (plus the
 * pinned real catalogue), never from wall-clock or nondeterministic sources.
 * The same seed always rebuilds the same universe, so a serialized state can be
 * validated, reloaded, and reconstructed identically.
 *
 * Layout: exactly one procedural home galaxy named from the seed, plus (when
 * catalogue inclusion is enabled) the real catalogue systems and bodies from
 * the P1-T05 mapping. The catalogue mapping is built under the home galaxy
 * slug, so every catalogue system id namespaces under that galaxy and its
 * declared `galaxy` reference already equals the home galaxy id — the parent
 * chain is exact by construction, with no re-homing step: for every system
 * `parentOf(system.id) === state.galaxy.id` and for every body
 * `parentOf(body.id) === body.system`. No existing record is mutated and no
 * state is shared between builds.
 *
 * Procedural systems beyond the catalogue are OUT OF SCOPE for this task — a
 * later task adds seeded procedural expansion to the home galaxy.
 */

import { PLANETS, PLANET_SNAPSHOT } from '../data/planets'
import { parseCanonicalId, parentOf } from './identity'
import type { BodyId, SystemId } from './identity'
import { buildGalaxyRecord, registerSystem, universePositionFor } from './galaxy'
import type { GalaxyRecord } from './galaxy'
import type { SystemRecord } from './system'
import type { BodyRecord } from './body'
import { buildCatalogueMapping } from './catalogue'

export interface UniverseState {
  galaxy: GalaxyRecord
  systems: SystemRecord[]
  bodies: BodyRecord[]
}

export interface UniverseConfig {
  seed: string
  includeCatalogue?: boolean
}

export interface ConsistencyResult {
  ok: boolean
  problems: string[]
}

/**
 * Build the deterministic universe for a seed. The home galaxy always derives
 * from the seed; the real catalogue systems and bodies are appended when
 * catalogue inclusion is enabled (the default). Procedural systems beyond the
 * catalogue are a future task.
 */
export function buildUniverseState(config: UniverseConfig): UniverseState {
  const includeCatalogue = config.includeCatalogue ?? true

  let galaxy = buildGalaxyRecord({
    slug: config.seed,
    seed: config.seed,
    position: universePositionFor(config.seed, 0),
  })

  if (!includeCatalogue) {
    return { galaxy, systems: [], bodies: [] }
  }

  const mapping = buildCatalogueMapping(PLANETS, PLANET_SNAPSHOT, {
    galaxySlug: config.seed,
  })

  for (const system of mapping.systems) {
    galaxy = registerSystem(galaxy, system.id)
  }

  return { galaxy, systems: mapping.systems, bodies: mapping.bodies }
}

/** Deep-copy of JSON data with object keys sorted at every level. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key])
    }
    return sorted
  }
  return value
}

/**
 * Byte-stable serialization: object keys are sorted recursively so the same
 * universe always serializes to the identical string across runs.
 */
export function serializeUniverse(state: UniverseState): string {
  const serialized = JSON.stringify(canonicalize(state))
  if (serialized === undefined) {
    throw new Error('serializeUniverse: state is not JSON-serializable')
  }
  return serialized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * Collect every structural problem in a candidate universe payload: shape,
 * id parsing, parent chains, duplicate ids, and registry consistency. Used by
 * deserializeUniverse (throws when non-empty) and reconstructConsistency
 * (reports as problems).
 */
function collectUniverseProblems(value: unknown): string[] {
  const problems: string[] = []
  if (!isRecord(value)) {
    return ['universe payload is not an object']
  }

  const galaxy = value.galaxy
  const systems = value.systems
  const bodies = value.bodies

  if (!isRecord(galaxy)) {
    return ['universe.galaxy is missing or not an object']
  }
  if (!Array.isArray(systems)) {
    return ['universe.systems is missing or not an array']
  }
  if (!Array.isArray(bodies)) {
    return ['universe.bodies is missing or not an array']
  }

  const galaxyId = galaxy.id
  if (typeof galaxyId !== 'string') {
    problems.push('galaxy.id is missing or not a string')
  } else {
    const parsed = parseCanonicalId(galaxyId)
    if (!parsed.ok || parsed.kind !== 'galaxy') {
      problems.push(`galaxy id does not parse as a galaxy: ${galaxyId}`)
    }
  }

  if (typeof galaxy.seed !== 'string' || galaxy.seed === '') {
    problems.push('galaxy.seed is missing or not a non-empty string')
  }

  const allIds = new Set<string>()
  if (typeof galaxyId === 'string') {
    allIds.add(galaxyId)
  }

  const systemIds = new Set<string>()
  for (let index = 0; index < systems.length; index++) {
    const entry = systems[index]
    if (!isRecord(entry)) {
      problems.push(`systems[${index}] is not an object`)
      continue
    }
    const id = entry.id
    if (typeof id !== 'string') {
      problems.push(`systems[${index}].id is missing or not a string`)
      continue
    }
    const parsed = parseCanonicalId(id)
    if (!parsed.ok || parsed.kind !== 'system') {
      problems.push(`system id does not parse as a system: ${id}`)
    }
    if (systemIds.has(id)) {
      problems.push(`duplicate system id: ${id}`)
    }
    systemIds.add(id)
    if (allIds.has(id)) {
      problems.push(`duplicate id across the universe: ${id}`)
    }
    allIds.add(id)

    if (entry.galaxy !== galaxyId) {
      problems.push(
        `system ${id} declares galaxy ${JSON.stringify(entry.galaxy)}, expected ${galaxyId}`,
      )
    }

    const canonicalParent = parentOf(id as SystemId)
    if (canonicalParent !== entry.galaxy || canonicalParent !== galaxyId) {
      problems.push(
        `system ${id} canonical parent ${canonicalParent} does not match declared galaxy ${JSON.stringify(entry.galaxy)} or universe galaxy ${galaxyId}`,
      )
    }

    if (!isStringArray(entry.bodyIds)) {
      problems.push(`system ${id} has a malformed bodyIds registry`)
    }
  }

  const bodyIds = new Set<string>()
  for (let index = 0; index < bodies.length; index++) {
    const entry = bodies[index]
    if (!isRecord(entry)) {
      problems.push(`bodies[${index}] is not an object`)
      continue
    }
    const id = entry.id
    if (typeof id !== 'string') {
      problems.push(`bodies[${index}].id is missing or not a string`)
      continue
    }
    const parsed = parseCanonicalId(id)
    if (!parsed.ok || parsed.kind !== 'body') {
      problems.push(`body id does not parse as a body: ${id}`)
    }
    if (bodyIds.has(id)) {
      problems.push(`duplicate body id: ${id}`)
    }
    bodyIds.add(id)
    if (allIds.has(id)) {
      problems.push(`duplicate id across the universe: ${id}`)
    }
    allIds.add(id)

    const parent = entry.system
    if (typeof parent !== 'string' || !systemIds.has(parent)) {
      problems.push(
        `orphan body ${id}: parent system ${JSON.stringify(parent)} is not in the state`,
      )
    }
    if (typeof parent === 'string') {
      const canonicalParent = parentOf(id as BodyId)
      if (canonicalParent !== parent) {
        problems.push(
          `body ${id} declares parent system ${parent}, but its canonical parent is ${canonicalParent}`,
        )
      }
    }
  }

  if (isStringArray(galaxy.systemIds)) {
    if (galaxy.systemIds.length !== systemIds.size) {
      problems.push(
        `galaxy systemIds registry count ${galaxy.systemIds.length} does not match systems ${systemIds.size}`,
      )
    }
    for (const registeredId of galaxy.systemIds) {
      if (!systemIds.has(registeredId)) {
        problems.push(`galaxy systemIds references unknown system: ${registeredId}`)
      }
    }
  } else {
    problems.push('galaxy.systemIds is missing or not a string array')
  }

  const bodyCountBySystem = new Map<string, number>()
  for (const body of bodies) {
    if (isRecord(body) && typeof body.system === 'string') {
      bodyCountBySystem.set(body.system, (bodyCountBySystem.get(body.system) ?? 0) + 1)
    }
  }
  for (let index = 0; index < systems.length; index++) {
    const entry = systems[index]
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      continue
    }
    if (!isStringArray(entry.bodyIds)) {
      continue
    }
    const expected = bodyCountBySystem.get(entry.id) ?? 0
    if (entry.bodyIds.length !== expected) {
      problems.push(
        `system ${entry.id} bodyIds registry count ${entry.bodyIds.length} does not match attached bodies ${expected}`,
      )
    }
    for (const registeredId of entry.bodyIds) {
      if (!bodyIds.has(registeredId)) {
        problems.push(`system ${entry.id} bodyIds references unknown body: ${registeredId}`)
      }
    }
  }

  return problems
}

/**
 * Parse a serialized universe and validate it. Throws a descriptive Error on
 * corrupt JSON, ids that do not parse, broken parent chains, duplicate ids, or
 * inconsistent registries.
 */
export function deserializeUniverse(json: string): UniverseState {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('deserializeUniverse: universe payload is not valid JSON')
  }
  const problems = collectUniverseProblems(parsed)
  if (problems.length > 0) {
    throw new Error(
      `deserializeUniverse: invalid universe payload: ${problems.join('; ')}`,
    )
  }
  return parsed as UniverseState
}

/**
 * Rebuild the universe from its galaxy seed with the same catalogue-inclusion
 * flag (derived from whether any system carries real data) and verify the given
 * state matches: deep-equal galaxy/systems/bodies in order, id chains, and
 * counts. Returns problems for every mismatch.
 */
export function reconstructConsistency(state: UniverseState): ConsistencyResult {
  const problems: string[] = collectUniverseProblems(state)

  const includeCatalogue = state.systems.some((system) => system.realData)
  let rebuilt: UniverseState
  try {
    rebuilt = buildUniverseState({ seed: state.galaxy.seed, includeCatalogue })
  } catch (error) {
    problems.push(
      `rebuild from seed ${state.galaxy.seed} failed: ${String(error)}`,
    )
    return { ok: problems.length === 0, problems }
  }

  if (serializeUniverse(rebuilt) !== serializeUniverse(state)) {
    problems.push(
      'rebuilt universe differs from the given state (galaxy, systems, or bodies mismatch)',
    )
  }
  if (state.systems.length !== rebuilt.systems.length) {
    problems.push(
      `systems count ${state.systems.length} does not match rebuilt ${rebuilt.systems.length}`,
    )
  }
  if (state.bodies.length !== rebuilt.bodies.length) {
    problems.push(
      `bodies count ${state.bodies.length} does not match rebuilt ${rebuilt.bodies.length}`,
    )
  }
  if (state.galaxy.systemIds.length !== state.systems.length) {
    problems.push(
      `galaxy systemIds count ${state.galaxy.systemIds.length} does not match systems ${state.systems.length}`,
    )
  }

  return { ok: problems.length === 0, problems }
}
