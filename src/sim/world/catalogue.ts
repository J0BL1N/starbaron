/**
 * Canonical real-catalogue world mapping (P1-T05).
 *
 * Maps the pinned NASA Exoplanet Archive catalogue (src/sim/data/planets.ts)
 * into the canonical world graph: one GalaxyRecord (the Milky Way analogue),
 * one SystemRecord per unique host star, and one BodyRecord per catalogue
 * planet. Pure and deterministic — every id derives from the catalogue
 * hostname/planets via ./identity, so the same input always yields a
 * deep-equal mapping. No nondeterministic APIs, wall-clock timestamps, shared
 * mutable state, or rendering imports.
 *
 * Real-data provenance discipline: every record produced here is a catalogue
 * entry, so realData is always true and provenance carries the snapshot fetch
 * timestamp. Records are never relabelled procedural. Procedural values are
 * used ONLY for fields the pinned snapshot does not carry (orbital elements
 * and radius/mass when absent), and those defaults derive deterministically
 * from the body id via the P1-T04 band logic — never fabricated as "real".
 */

import { PLANET_SNAPSHOT } from '../data/planets'
import type { PlanetCatalogueEntry } from '../data/planets'
import { parseCanonicalId, parentOf } from './identity'
import type { BodyId, SystemId } from './identity'
import { buildGalaxyRecord, registerSystem } from './galaxy'
import type { GalaxyRecord } from './galaxy'
import { buildSystemRecord, registerBody } from './system'
import type { SystemRecord } from './system'
import { buildBodyRecord } from './body'
import type { BodyRecord } from './body'

/** Slug of the canonical real-catalogue galaxy record. */
export const CATALOGUE_GALAXY_SLUG = 'catalogue'

/** Display name of the canonical real-catalogue galaxy record. */
export const CATALOGUE_GALAXY_NAME = 'Milky Way analogue'

/** radiusEarth -> world-radius conversion: additive offset and scale. */
export const CATALOGUE_RADIUS_OFFSET = 1.2
export const CATALOGUE_RADIUS_SCALE = 0.35

/** World-radius clamp bounds applied to the catalogue conversion. */
export const CATALOGUE_RADIUS_MIN = 1.2
export const CATALOGUE_RADIUS_MAX = 40

/** Shape of the pinned snapshot meta (matches PLANET_SNAPSHOT). */
export interface CatalogueSnapshotMeta {
  source: string
  query: string
  fetchedAt: string
  rows: number
  sha: string
}

/** Provenance string derived from the snapshot fetch timestamp. */
export function catalogueProvenance(fetchedAt: string): string {
  return `nasa-exoplanet-archive-${fetchedAt}`
}

/**
 * World radius from catalogue Earth-radii: offset + scaled, clamped to
 * [CATALOGUE_RADIUS_MIN, CATALOGUE_RADIUS_MAX].
 */
export function worldRadiusFromEarth(radiusEarth: number): number {
  const raw = CATALOGUE_RADIUS_OFFSET + radiusEarth * CATALOGUE_RADIUS_SCALE
  if (raw < CATALOGUE_RADIUS_MIN) return CATALOGUE_RADIUS_MIN
  if (raw > CATALOGUE_RADIUS_MAX) return CATALOGUE_RADIUS_MAX
  return raw
}

/** Real-vs-seeded tallies over a catalogue mapping. */
export interface CatalogueStats {
  realSystems: number
  realBodies: number
  seededSystems: number
  seededBodies: number
}

/** Canonical world graph mapped from the pinned catalogue. */
export interface CatalogueMappingResult {
  galaxy: GalaxyRecord
  systems: SystemRecord[]
  bodies: BodyRecord[]
  stats: CatalogueStats
}

/** starType for a host: the first entry's value in catalogue order. */
function hostStarType(planets: readonly PlanetCatalogueEntry[]): string | undefined {
  return planets[0]?.starType
}

/**
 * Map the pinned catalogue into the canonical world graph.
 *
 * Deterministic: hosts are iterated in SORTED hostname order; planets within a
 * host keep their catalogue (input) order. One system per unique hostname
 * (id = systemId('catalogue', hostname)); one body per catalogue planet
 * (id = bodyId(system, 'planet', ordinal) with ordinal = index within host).
 * Real orbital parameters are NOT present in this snapshot, so orbits use the
 * deterministic id-seeded P1-T04 defaults via buildBodyRecord — a documented
 * future catalogue extension, never a fabricated "real" value.
 *
 * @param meta snapshot meta; defaults to the committed PLANET_SNAPSHOT.
 */
export function buildCatalogueMapping(
  planets: readonly PlanetCatalogueEntry[],
  meta: CatalogueSnapshotMeta = PLANET_SNAPSHOT,
): CatalogueMappingResult {
  const provenance = catalogueProvenance(meta.fetchedAt)

  const galaxy = buildGalaxyRecord({
    slug: CATALOGUE_GALAXY_SLUG,
    name: CATALOGUE_GALAXY_NAME,
    realData: true,
    provenance,
  })

  const planetsByHost = new Map<string, PlanetCatalogueEntry[]>()
  for (const entry of planets) {
    const group = planetsByHost.get(entry.hostname)
    if (group === undefined) {
      planetsByHost.set(entry.hostname, [entry])
    } else {
      group.push(entry)
    }
  }

  const hosts = [...planetsByHost.keys()].sort()

  const systems = hosts.map((hostname) =>
    buildSystemRecord({
      galaxy: galaxy.id,
      slug: hostname,
      name: hostname,
      starType: hostStarType(planetsByHost.get(hostname) ?? []),
      realData: true,
      provenance,
    }),
  )

  const systemByHost = new Map<string, SystemRecord>()
  for (const system of systems) {
    systemByHost.set(system.name, system)
  }

  const bodies: BodyRecord[] = []
  for (const hostname of hosts) {
    const system = systemByHost.get(hostname)
    if (system === undefined) {
      continue
    }
    const hostPlanets = planetsByHost.get(hostname) ?? []
    for (let ordinal = 0; ordinal < hostPlanets.length; ordinal++) {
      const entry = hostPlanets[ordinal]
      bodies.push(
        buildBodyRecord({
          system: system.id,
          type: 'planet',
          ordinal,
          name: entry.name,
          radius:
            entry.radiusEarth === undefined
              ? undefined
              : worldRadiusFromEarth(entry.radiusEarth),
          // BodyRecord.mass is in Jupiter masses (massJup) for catalogue
          // mappings — passed through as-is, no kg conversion.
          mass: entry.massJup,
          realData: true,
          provenance,
        }),
      )
    }
  }

  const bodiesBySystem = new Map<SystemId, BodyId[]>()
  for (const body of bodies) {
    const list = bodiesBySystem.get(body.system)
    if (list === undefined) {
      bodiesBySystem.set(body.system, [body.id])
    } else {
      list.push(body.id)
    }
  }

  const systemsWithBodies = systems.map((system) => {
    const ids = bodiesBySystem.get(system.id) ?? []
    let registered = system
    for (const id of ids) {
      registered = registerBody(registered, id)
    }
    return registered
  })

  let galaxyWithSystems = galaxy
  for (const system of systemsWithBodies) {
    galaxyWithSystems = registerSystem(galaxyWithSystems, system.id)
  }

  let realSystems = 0
  let seededSystems = 0
  for (const system of systemsWithBodies) {
    if (system.realData) {
      realSystems++
    } else {
      seededSystems++
    }
  }
  let realBodies = 0
  let seededBodies = 0
  for (const body of bodies) {
    if (body.realData) {
      realBodies++
    } else {
      seededBodies++
    }
  }

  return {
    galaxy: galaxyWithSystems,
    systems: systemsWithBodies,
    bodies,
    stats: { realSystems, realBodies, seededSystems, seededBodies },
  }
}

/** Result of a catalogue-mapping integrity check. */
export interface CatalogueValidation {
  ok: boolean
  problems: string[]
}

/**
 * Validate a catalogue mapping against the snapshot it claims to map.
 *
 * Checks: bodies count matches snapshot rows; galaxy/system/body ids parse;
 * systems count matches unique hostnames; every body's parent system exists;
 * every body's declared system equals the canonical parent of its id;
 * every body ordinal equals its index within its host; no duplicate ids
 * anywhere in the mapping.
 */
export function validateCatalogue(
  mapping: CatalogueMappingResult,
  snapshot: CatalogueSnapshotMeta,
): CatalogueValidation {
  const problems: string[] = []

  if (mapping.bodies.length !== snapshot.rows) {
    problems.push(
      `bodies count ${mapping.bodies.length} does not match snapshot rows ${snapshot.rows}`,
    )
  }

  const galaxyParsed = parseCanonicalId(mapping.galaxy.id)
  if (!galaxyParsed.ok || galaxyParsed.kind !== 'galaxy') {
    problems.push(`galaxy id does not parse as a galaxy: ${mapping.galaxy.id}`)
  }

  const systemIds = new Set<string>()
  for (const system of mapping.systems) {
    const parsed = parseCanonicalId(system.id)
    if (!parsed.ok || parsed.kind !== 'system') {
      problems.push(`system id does not parse as a system: ${system.id}`)
      continue
    }
    if (systemIds.has(system.id)) {
      problems.push(`duplicate system id: ${system.id}`)
    }
    systemIds.add(system.id)
  }

  const bodyIds = new Set<string>()
  const bodiesBySystem = new Map<string, BodyRecord[]>()
  for (const body of mapping.bodies) {
    const parsed = parseCanonicalId(body.id)
    if (!parsed.ok || parsed.kind !== 'body') {
      problems.push(`body id does not parse as a body: ${body.id}`)
      continue
    }
    if (bodyIds.has(body.id)) {
      problems.push(`duplicate body id: ${body.id}`)
    }
    bodyIds.add(body.id)
    const canonicalParent = parentOf(body.id)
    if (canonicalParent !== body.system) {
      problems.push(
        `body ${body.id} declares parent system ${body.system}, but its canonical parent is ${canonicalParent}`,
      )
    }
    if (!systemIds.has(body.system)) {
      problems.push(
        `orphan body ${body.id}: parent system ${body.system} is not in the mapping`,
      )
    }
    const group = bodiesBySystem.get(body.system)
    if (group === undefined) {
      bodiesBySystem.set(body.system, [body])
    } else {
      group.push(body)
    }
  }

  for (const [system, group] of bodiesBySystem) {
    for (let index = 0; index < group.length; index++) {
      if (group[index].ordinal !== index) {
        problems.push(
          `body ${group[index].id} has ordinal ${group[index].ordinal}, expected ${index} within host ${system}`,
        )
      }
    }
  }

  const hostSeeds = new Set<string>()
  for (const id of bodyIds) {
    const parsed = parseCanonicalId(id)
    if (parsed.ok && parsed.kind === 'body') {
      hostSeeds.add(parsed.systemSeed)
    }
  }
  if (mapping.systems.length !== hostSeeds.size) {
    problems.push(
      `systems count ${mapping.systems.length} does not match unique hostnames ${hostSeeds.size}`,
    )
  }

  const allIds = [
    mapping.galaxy.id,
    ...mapping.systems.map((system) => system.id),
    ...mapping.bodies.map((body) => body.id),
  ]
  const seen = new Set<string>()
  for (const id of allIds) {
    if (seen.has(id)) {
      problems.push(`duplicate id across the mapping: ${id}`)
    }
    seen.add(id)
  }

  return { ok: problems.length === 0, problems }
}
