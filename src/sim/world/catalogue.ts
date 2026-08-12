/**
 * Canonical real-catalogue world mapping (P1-T05).
 *
 * Maps the pinned NASA Exoplanet Archive catalogue (src/sim/data/planets.ts)
 * into the canonical world graph: one GalaxyRecord (the Milky Way analogue),
 * one SystemRecord per unique host star, and one BodyRecord per catalogue
 * planet. Pure and deterministic — every id derives from the catalogue
 * hostname/planets via ./identity, so the same input always yields a
 * deep-equal mapping. No nondeterministic APIs, wall-clock timestamps,
 * module-level mutable state, or rendering imports.
 *
 * Real-data provenance discipline: every record returned here is a catalogue
 * entry, so realData is true and provenance carries the snapshot fetch
 * timestamp. The factories (./galaxy, ./system, ./body) accept NO real-data
 * or provenance input — they always build procedural records — so this module
 * labels the FULLY BUILT mapping at one post-construction spread
 * ({ ...builtRecord, realData: true, provenance }) just before returning.
 * That single boundary is the ONLY labelled place in the codebase; there is
 * no public elevation path through a factory. Records are never relabelled
 * procedural. Procedural values are used ONLY for fields the pinned snapshot
 * does not carry (orbital elements and radius/mass when absent), and those
 * defaults derive deterministically from the body id via the P1-T04 band logic
 * — never fabricated as "real".
 *
 * Because the returned records are plain data, a direct object spread outside
 * this module could in principle craft a labelled record (plain-data reality).
 * That is out of scope here — the enforcement net for materialized rows is the
 * SQL CHECK set (supabase/migrations/0013_world_schema.sql) and
 * validateCatalogue below.
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

/** Options controlling how the catalogue mapping is rooted. */
export interface CatalogueMappingOptions {
  /**
   * Galaxy slug the mapping is built under. When provided, the mapping's
   * galaxy record uses this slug and every system id is built as
   * systemId(galaxySlug, hostname), so catalogue ids namespace exactly under
   * that galaxy. Defaults to CATALOGUE_GALAXY_SLUG ('catalogue').
   */
  galaxySlug?: string
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
 * (id = systemId(galaxySlug, hostname)); one body per catalogue planet
 * (id = bodyId(system, 'planet', ordinal) with ordinal = index within host).
 * The galaxy slug defaults to CATALOGUE_GALAXY_SLUG; pass opts.galaxySlug to
 * root the mapping's ids and galaxy record under a different slug, keeping the
 * parent chain exact by construction (parentOf(system.id) === galaxy.id).
 * Real orbital parameters are NOT present in this snapshot, so orbits use the
 * deterministic id-seeded P1-T04 defaults via buildBodyRecord — a documented
 * future catalogue extension, never a fabricated "real" value.
 *
 * @param meta snapshot meta; defaults to the committed PLANET_SNAPSHOT.
 * @param opts optional mapping options (see CatalogueMappingOptions).
 */
export function buildCatalogueMapping(
  planets: readonly PlanetCatalogueEntry[],
  meta: CatalogueSnapshotMeta = PLANET_SNAPSHOT,
  opts: CatalogueMappingOptions = {},
): CatalogueMappingResult {
  const galaxySlug = opts.galaxySlug ?? CATALOGUE_GALAXY_SLUG
  const provenance = catalogueProvenance(meta.fetchedAt)

  const galaxy = buildGalaxyRecord({
    slug: galaxySlug,
    name: CATALOGUE_GALAXY_NAME,
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

  // THE single real-data labelling boundary. Every record this module returns
  // is a catalogue entry, so the fully-built mapping is relabelled HERE, after
  // construction, in one place. The factories accept no real-data/provenance
  // input, so no other path can elevate a record; the SQL CHECKs and
  // validateCatalogue are the enforcement net for materialized rows.
  const labelledGalaxy: GalaxyRecord = {
    ...galaxyWithSystems,
    realData: true,
    provenance,
  }
  const labelledSystems: SystemRecord[] = systemsWithBodies.map((system) => ({
    ...system,
    realData: true,
    provenance,
  }))
  const labelledBodies: BodyRecord[] = bodies.map((body) => ({
    ...body,
    realData: true,
    provenance,
  }))

  return {
    galaxy: labelledGalaxy,
    systems: labelledSystems,
    bodies: labelledBodies,
    stats: {
      realSystems: labelledSystems.length,
      realBodies: labelledBodies.length,
      seededSystems: 0,
      seededBodies: 0,
    },
  }
}

/** Result of a catalogue-mapping integrity check. */
export interface CatalogueValidation {
  ok: boolean
  problems: string[]
}

/**
 * Real-data flag/provenance consistency for a record — the exact mirror of the
 * 0013 SQL CHECKs at rest (real_data true requires a catalogue provenance;
 * real_data false requires provenance 'procedural'). Returns a problem string,
 * or null when the pair is consistent. Shared by validateCatalogue and the
 * universe validator in ./reconstruct so the two enforcement nets cannot
 * drift.
 */
export function realDataConsistencyProblem(
  realData: unknown,
  provenance: unknown,
): string | null {
  if (typeof realData !== 'boolean') {
    return `realData must be a boolean, got: ${JSON.stringify(realData)}`
  }
  if (realData) {
    if (
      typeof provenance !== 'string' ||
      !provenance.startsWith('nasa-exoplanet-archive-')
    ) {
      return `realData true requires a catalogue provenance, got: ${JSON.stringify(provenance)}`
    }
    return null
  }
  if (provenance !== 'procedural') {
    return `procedural records require provenance 'procedural', got: ${JSON.stringify(provenance)}`
  }
  return null
}

/**
 * Validate a catalogue mapping against the snapshot it claims to map.
 *
 * Checks: bodies count matches snapshot rows; galaxy/system/body ids parse;
 * systems count matches unique hostnames; every system's declared galaxy
 * equals the mapping galaxy AND its canonical parent; galaxy registry
 * membership is exact in both directions (every system id in galaxy.systemIds
 * and vice versa); every body's parent system exists; every body's declared
 * system equals the canonical parent of its id; every body ordinal equals its
 * index within its host; no duplicate ids anywhere in the mapping; every
 * record's realData/provenance pair is consistent (realData true requires a
 * catalogue provenance, realData false requires 'procedural'); and — for
 * EVERY system — the bodyIds registry is ordered, duplicate-free, and EXACTLY
 * matches the set of mapped child body ids (each body whose parent is that
 * system appears, no extra ids, no duplicates, registry order equals the
 * mapped bodies order).
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
  const galaxyRealDataProblem = realDataConsistencyProblem(
    mapping.galaxy.realData,
    mapping.galaxy.provenance,
  )
  if (galaxyRealDataProblem !== null) {
    problems.push(`galaxy ${mapping.galaxy.id}: ${galaxyRealDataProblem}`)
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
    if (system.galaxy !== mapping.galaxy.id) {
      problems.push(
        `system ${system.id} declares galaxy ${system.galaxy}, expected the mapping galaxy ${mapping.galaxy.id}`,
      )
    }
    const canonicalSystemParent = parentOf(system.id)
    if (canonicalSystemParent !== system.galaxy) {
      problems.push(
        `system ${system.id} declares parent galaxy ${system.galaxy}, but its canonical parent is ${canonicalSystemParent}`,
      )
    }
    const systemRealDataProblem = realDataConsistencyProblem(
      system.realData,
      system.provenance,
    )
    if (systemRealDataProblem !== null) {
      problems.push(`system ${system.id}: ${systemRealDataProblem}`)
    }
  }

  const registeredSystemIds = new Set<string>(mapping.galaxy.systemIds)
  if (registeredSystemIds.size !== systemIds.size) {
    problems.push(
      `galaxy systemIds registry count ${registeredSystemIds.size} does not match systems ${systemIds.size}`,
    )
  }
  for (const registeredId of registeredSystemIds) {
    if (!systemIds.has(registeredId)) {
      problems.push(`galaxy systemIds references unknown system: ${registeredId}`)
    }
  }
  for (const mappedSystemId of systemIds) {
    if (!registeredSystemIds.has(mappedSystemId)) {
      problems.push(
        `system ${mappedSystemId} is missing from the galaxy systemIds registry`,
      )
    }
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
    const bodyRealDataProblem = realDataConsistencyProblem(
      body.realData,
      body.provenance,
    )
    if (bodyRealDataProblem !== null) {
      problems.push(`body ${body.id}: ${bodyRealDataProblem}`)
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

  for (const system of mapping.systems) {
    const childBodies = bodiesBySystem.get(system.id) ?? []
    const expectedIds = childBodies.map((body) => body.id)
    const expectedSet = new Set(expectedIds)
    if (system.bodyIds.length !== expectedIds.length) {
      problems.push(
        `system ${system.id} bodyIds registry count ${system.bodyIds.length} does not match attached bodies ${expectedIds.length}`,
      )
    }
    const seen = new Set<string>()
    for (const id of system.bodyIds) {
      if (!expectedSet.has(id)) {
        problems.push(
          `system ${system.id} bodyIds references unknown body: ${id}`,
        )
      }
      if (seen.has(id)) {
        problems.push(`system ${system.id} bodyIds contains a duplicate: ${id}`)
      }
      seen.add(id)
    }
    for (const id of expectedIds) {
      if (!system.bodyIds.includes(id)) {
        problems.push(
          `body ${id} is missing from the system ${system.id} bodyIds registry`,
        )
      }
    }
    const sameOrder =
      system.bodyIds.length === expectedIds.length &&
      system.bodyIds.every((id, index) => id === expectedIds[index])
    if (!sameOrder) {
      problems.push(
        `system ${system.id} bodyIds registry order does not match the mapped bodies order`,
      )
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
