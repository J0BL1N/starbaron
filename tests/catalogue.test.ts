import { describe, expect, it } from 'vitest'
import { PLANETS, PLANET_SNAPSHOT } from '../src/sim/data/planets'
import type { PlanetCatalogueEntry } from '../src/sim/data/planets'
import {
  buildCatalogueMapping,
  catalogueProvenance,
  worldRadiusFromEarth,
  validateCatalogue,
  CATALOGUE_GALAXY_NAME,
  CATALOGUE_GALAXY_SLUG,
  CATALOGUE_RADIUS_MAX,
  CATALOGUE_RADIUS_MIN,
} from '../src/sim/world/catalogue'
import type {
  CatalogueMappingResult,
  CatalogueSnapshotMeta,
} from '../src/sim/world/catalogue'
import { galaxyId, parseCanonicalId, parentOf, systemId, bodyId } from '../src/sim/world/identity'
import type { GalaxyId, SystemId } from '../src/sim/world/identity'
import { buildSystemRecord } from '../src/sim/world/system'

const PROVENANCE = 'nasa-exoplanet-archive-2026-08-10'

const FIXTURE: PlanetCatalogueEntry[] = [
  {
    name: 'Fixture-1 b',
    hostname: 'Fixture-1',
    systemCount: 1,
    radiusEarth: 1.5,
    massJup: 0.5,
    starType: 'G2 V',
    distancePc: 10,
    ra: 0,
    dec: 0,
    tier: 3,
  },
  {
    name: 'Fixture-1 c',
    hostname: 'Fixture-1',
    systemCount: 1,
    radiusEarth: 2,
    tier: 4,
  },
  {
    name: 'Fixture-2 b',
    hostname: 'Fixture-2',
    systemCount: 1,
    radiusEarth: 200,
    massJup: 10,
    starType: 'M4 V',
    tier: 5,
  },
]

const FIXTURE_META: CatalogueSnapshotMeta = {
  source: 'fixture',
  query: 'fixture',
  fetchedAt: '2026-08-10',
  rows: 3,
  sha: 'fixture',
}

const EMPTY_META: CatalogueSnapshotMeta = {
  source: 'fixture',
  query: 'fixture',
  fetchedAt: '2026-08-10',
  rows: 0,
  sha: 'fixture',
}

function uniqueHostnames(planets: readonly PlanetCatalogueEntry[]): string[] {
  return [...new Set(planets.map((entry) => entry.hostname))].sort()
}

function bodyByName(
  mapping: CatalogueMappingResult,
  name: string,
): CatalogueMappingResult['bodies'][number] | undefined {
  return mapping.bodies.find((body) => body.name === name)
}

describe('P1-T05 full catalogue mapping (real PLANETS)', () => {
  const mapping = buildCatalogueMapping(PLANETS)

  it('maps one body per catalogue planet and one system per unique hostname', () => {
    const hosts = uniqueHostnames(PLANETS)
    expect(hosts.length).toBe(4746)
    expect(mapping.systems.length).toBe(hosts.length)
    expect(mapping.bodies.length).toBe(PLANETS.length)
    expect(PLANETS.length).toBe(PLANET_SNAPSHOT.rows)
  })

  it('stats tally every record as real and none as seeded', () => {
    expect(mapping.stats.realSystems).toBe(mapping.systems.length)
    expect(mapping.stats.realBodies).toBe(mapping.bodies.length)
    expect(mapping.stats.seededSystems).toBe(0)
    expect(mapping.stats.seededBodies).toBe(0)
  })

  it('is deterministic: building twice yields deep-equal mappings', () => {
    const again = buildCatalogueMapping(PLANETS)
    expect(again).toEqual(mapping)
  })

  it('is deterministic on a small sample slice', () => {
    const slice = PLANETS.slice(0, 50)
    expect(buildCatalogueMapping(slice)).toEqual(buildCatalogueMapping(slice))
  })

  it('galaxy is the catalogue slug record with realData and provenance', () => {
    expect(mapping.galaxy.id).toBe(`gal:${CATALOGUE_GALAXY_SLUG}`)
    expect(mapping.galaxy.name).toBe(CATALOGUE_GALAXY_NAME)
    expect(mapping.galaxy.realData).toBe(true)
    expect(mapping.galaxy.provenance).toBe(PROVENANCE)
    const parsedGalaxy = parseCanonicalId(mapping.galaxy.id)
    expect(parsedGalaxy.ok).toBe(true)
    if (parsedGalaxy.ok) {
      expect(parsedGalaxy.kind).toBe('galaxy')
    }
  })

  it('every system carries realData true and the exact provenance', () => {
    for (const system of mapping.systems) {
      expect(system.realData).toBe(true)
      expect(system.provenance).toBe(PROVENANCE)
    }
  })

  it('every body carries realData true and the exact provenance', () => {
    for (const body of mapping.bodies) {
      expect(body.realData).toBe(true)
      expect(body.provenance).toBe(PROVENANCE)
    }
  })

  it('systems are ordered by sorted unique hostname', () => {
    const names = mapping.systems.map((system) => system.name)
    expect(names).toEqual(uniqueHostnames(PLANETS))
  })

  it('system ids use the catalogue slug and the hostname as seed', () => {
    expect(mapping.systems[0].id).toBe(systemId(CATALOGUE_GALAXY_SLUG, mapping.systems[0].name))
    for (const system of mapping.systems) {
      const parsed = parseCanonicalId(system.id)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        expect(parsed.kind).toBe('system')
      }
    }
  })

  it('body ordinals equal the index within their host, in catalogue order', () => {
    const byHost = new Map<string, number>()
    for (const body of mapping.bodies) {
      const index = byHost.get(body.system) ?? 0
      expect(body.ordinal).toBe(index)
      byHost.set(body.system, index + 1)
    }
  })

  it('bodies group contiguously by sorted host, in catalogue order', () => {
    let systemIdx = 0
    let current = mapping.systems[0].id
    for (const body of mapping.bodies) {
      if (body.system !== current) {
        systemIdx++
        current = mapping.systems[systemIdx].id
      }
      expect(body.system).toBe(current)
    }
    expect(systemIdx).toBe(mapping.systems.length - 1)
  })

  it('id chains: body -> system -> galaxy via parentOf and parse', () => {
    for (const body of mapping.bodies) {
      const parsed = parseCanonicalId(body.id)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        expect(parsed.kind).toBe('body')
      }
      expect(parentOf(body.id)).toBe(body.system)
    }
    for (const system of mapping.systems) {
      expect(parentOf(system.id)).toBe(mapping.galaxy.id)
    }
  })

  it('galaxy.systemIds registers every system exactly once', () => {
    expect(mapping.galaxy.systemIds.length).toBe(mapping.systems.length)
    expect(new Set(mapping.galaxy.systemIds).size).toBe(mapping.systems.length)
  })

  it('each system bodyIds registers exactly that host planet count', () => {
    const counts = new Map<string, number>()
    for (const entry of PLANETS) {
      counts.set(entry.hostname, (counts.get(entry.hostname) ?? 0) + 1)
    }
    for (const system of mapping.systems) {
      expect(system.bodyIds.length).toBe(counts.get(system.name))
    }
    const total = mapping.systems.reduce((sum, system) => sum + system.bodyIds.length, 0)
    expect(total).toBe(mapping.bodies.length)
  })

  it('converts radiusEarth into the documented world-radius formula', () => {
    const gj238 = bodyByName(mapping, 'GJ 238 b')
    expect(gj238?.radius).toBeCloseTo(1.2 + 0.566 * 0.35, 6)
    const ctCha = bodyByName(mapping, 'CT Cha b')
    expect(ctCha?.radius).toBeCloseTo(1.2 + 24.66 * 0.35, 6)
    for (const body of mapping.bodies) {
      expect(body.radius).toBeGreaterThan(0)
    }
  })

  it('carries massJup as mass in catalogue units and omits mass when absent', () => {
    for (const body of mapping.bodies) {
      const entry = PLANETS.find((e) => e.name === body.name)
      if (entry?.massJup !== undefined) {
        expect(body.mass).toBe(entry.massJup)
      } else {
        expect(body.mass).toBeUndefined()
      }
    }
  })

  it('system starType comes from the host star', () => {
    for (const system of mapping.systems) {
      const entry = PLANETS.find((e) => e.hostname === system.name)
      expect(system.star.starType).toBe(entry?.starType)
      expect(system.star.name).toBe(system.name)
    }
  })

  it('validateCatalogue accepts the real mapping with no problems', () => {
    const validation = validateCatalogue(mapping, PLANET_SNAPSHOT)
    expect(validation.ok).toBe(true)
    expect(validation.problems).toEqual([])
  })

  it('provenance is derived from the snapshot fetchedAt string', () => {
    expect(PROVENANCE).toBe(`nasa-exoplanet-archive-${PLANET_SNAPSHOT.fetchedAt}`)
    expect(catalogueProvenance('2026-08-10')).toBe(PROVENANCE)
  })
})

describe('P1-T05 small fixture (duplicate hostname, missing fields)', () => {
  const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)

  it('dedupes a repeated hostname into one system with the right ordinals', () => {
    expect(mapping.systems.length).toBe(2)
    expect(mapping.systems.map((s) => s.name)).toEqual(['Fixture-1', 'Fixture-2'])
    const fixture1 = mapping.systems[0]
    expect(fixture1.bodyIds.length).toBe(2)
    const bodyIds = mapping.bodies.filter((b) => b.system === fixture1.id)
    expect(bodyIds.map((b) => b.ordinal)).toEqual([0, 1])
  })

  it('handles missing fields deterministically: mass omitted, radius defaulted', () => {
    const fixture1c = bodyByName(mapping, 'Fixture-1 c')
    expect(fixture1c?.mass).toBeUndefined()
    expect(fixture1c?.radius).toBeGreaterThan(0)
    const fixture1b = bodyByName(mapping, 'Fixture-1 b')
    expect(fixture1b?.mass).toBe(0.5)
  })

  it('keeps the host starType from the first entry in catalogue order', () => {
    expect(mapping.systems[0].star.starType).toBe('G2 V')
  })

  it('clamps radiusEarth conversions into [1.2, 40]', () => {
    const fixture2b = bodyByName(mapping, 'Fixture-2 b')
    expect(fixture2b?.radius).toBe(CATALOGUE_RADIUS_MAX)
    expect(worldRadiusFromEarth(200)).toBe(CATALOGUE_RADIUS_MAX)
    expect(worldRadiusFromEarth(-5)).toBe(CATALOGUE_RADIUS_MIN)
    expect(worldRadiusFromEarth(0)).toBe(CATALOGUE_RADIUS_MIN)
    expect(worldRadiusFromEarth(1.5)).toBeCloseTo(1.725, 12)
  })

  it('validateCatalogue accepts the fixture mapping', () => {
    const validation = validateCatalogue(mapping, FIXTURE_META)
    expect(validation.ok).toBe(true)
    expect(validation.problems).toEqual([])
  })

  it('derives provenance from a custom snapshot fetchedAt', () => {
    const custom = buildCatalogueMapping(FIXTURE, {
      ...FIXTURE_META,
      fetchedAt: '2031-05-06',
    })
    expect(custom.galaxy.provenance).toBe('nasa-exoplanet-archive-2031-05-06')
    expect(custom.bodies[0].provenance).toBe('nasa-exoplanet-archive-2031-05-06')
    expect(custom.systems[0].provenance).toBe('nasa-exoplanet-archive-2031-05-06')
  })
})

describe('P1-T05 validateCatalogue problem detection (mutated mappings)', () => {
  it('flags a body-count mismatch against snapshot rows', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const mutated: CatalogueMappingResult = {
      ...mapping,
      bodies: mapping.bodies.slice(1),
    }
    const validation = validateCatalogue(mutated, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('bodies count 2')
  })

  it('flags a duplicated body id', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const duplicated: CatalogueMappingResult = {
      ...mapping,
      bodies: [mapping.bodies[0], mapping.bodies[0], mapping.bodies[1], mapping.bodies[2]],
    }
    const validation = validateCatalogue(duplicated, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('duplicate body id')
  })

  it('flags an orphan body whose parent system is missing', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const ghost = systemId('catalogue', 'Ghost-Host')
    const orphaned: CatalogueMappingResult = {
      ...mapping,
      bodies: mapping.bodies.map((body) =>
        body.name === 'Fixture-1 b' ? { ...body, system: ghost } : body,
      ),
    }
    const validation = validateCatalogue(orphaned, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('orphan body')
  })

  it('flags a body ordinal that is not its index within host', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const shifted: CatalogueMappingResult = {
      ...mapping,
      bodies: mapping.bodies.map((body, index) =>
        index === 0 ? { ...body, ordinal: 7 } : body,
      ),
    }
    const validation = validateCatalogue(shifted, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('ordinal 7')
  })

  it('flags a systems count that does not match unique hostnames', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const extraSystem = buildSystemRecord({
      galaxy: mapping.galaxy.id,
      slug: 'Ghost-Host',
      name: 'Ghost-Host',
    })
    const extra: CatalogueMappingResult = {
      ...mapping,
      systems: [...mapping.systems, extraSystem],
    }
    const validation = validateCatalogue(extra, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('systems count 3')
  })

  it('flags a system id that does not parse', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const corrupted: CatalogueMappingResult = {
      ...mapping,
      systems: mapping.systems.map((system, index) =>
        index === 0 ? { ...system, id: 'not-an-id' as SystemId } : system,
      ),
    }
    const validation = validateCatalogue(corrupted, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('does not parse')
  })

  it('flags a galaxy id that does not parse', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const corrupted: CatalogueMappingResult = {
      ...mapping,
      galaxy: { ...mapping.galaxy, id: 'not-galaxy' as GalaxyId },
    }
    const validation = validateCatalogue(corrupted, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('galaxy id')
  })

  it('flags bodies whose declared system is not the canonical parent of their id', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const fixture1Id = mapping.systems.find((system) => system.name === 'Fixture-1')!.id
    const fixture2Id = mapping.systems.find((system) => system.name === 'Fixture-2')!.id
    const swapped: CatalogueMappingResult = {
      ...mapping,
      bodies: mapping.bodies.map((body) => ({
        ...body,
        system: body.system === fixture1Id ? fixture2Id : fixture1Id,
      })),
    }
    const validation = validateCatalogue(swapped, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('canonical parent')
  })

  it('flags a system whose declared galaxy disagrees with the mapping galaxy', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const otherGalaxy = galaxyId('wrong-galaxy')
    const swapped: CatalogueMappingResult = {
      ...mapping,
      systems: mapping.systems.map((system) =>
        system.name === 'Fixture-1' ? { ...system, galaxy: otherGalaxy } : system,
      ),
    }
    const validation = validateCatalogue(swapped, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('declares galaxy')
  })

  it('flags a system whose declared galaxy is not its canonical parent', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const swapped: CatalogueMappingResult = {
      ...mapping,
      systems: mapping.systems.map((system, index) =>
        index === 0 ? { ...system, galaxy: galaxyId('wrong-galaxy') } : system,
      ),
    }
    const validation = validateCatalogue(swapped, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('canonical parent')
  })

  it('flags a system dropped from the galaxy registry', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const mutated: CatalogueMappingResult = {
      ...mapping,
      galaxy: {
        ...mapping.galaxy,
        systemIds: mapping.galaxy.systemIds.slice(0, 1),
      },
    }
    const validation = validateCatalogue(mutated, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain(
      'missing from the galaxy systemIds registry',
    )
  })

  it('flags a galaxy registry entry that no system matches', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const ghost = systemId('catalogue', 'Ghost-Host')
    const mutated: CatalogueMappingResult = {
      ...mapping,
      galaxy: {
        ...mapping.galaxy,
        systemIds: [...mapping.galaxy.systemIds, ghost],
      },
    }
    const validation = validateCatalogue(mutated, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('references unknown system')
  })

  it('flags a system bodyIds registry missing an attached body', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const fixture1 = mapping.systems.find((system) => system.name === 'Fixture-1')!
    const mutated: CatalogueMappingResult = {
      ...mapping,
      systems: mapping.systems.map((system) =>
        system.id === fixture1.id
          ? { ...system, bodyIds: system.bodyIds.slice(0, 1) }
          : system,
      ),
    }
    const validation = validateCatalogue(mutated, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain(
      `missing from the system ${fixture1.id} bodyIds registry`,
    )
  })

  it('flags a system bodyIds registry that references a foreign body id', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const fixture1 = mapping.systems.find((system) => system.name === 'Fixture-1')!
    const foreign = bodyId(fixture1.id, 'moon', 0)
    const mutated: CatalogueMappingResult = {
      ...mapping,
      systems: mapping.systems.map((system) =>
        system.id === fixture1.id
          ? { ...system, bodyIds: [...system.bodyIds, foreign] }
          : system,
      ),
    }
    const validation = validateCatalogue(mutated, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain(
      `references unknown body: ${foreign}`,
    )
  })

  it('flags a system bodyIds registry that repeats an entry', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const fixture1 = mapping.systems.find((system) => system.name === 'Fixture-1')!
    const mutated: CatalogueMappingResult = {
      ...mapping,
      systems: mapping.systems.map((system) =>
        system.id === fixture1.id
          ? { ...system, bodyIds: [system.bodyIds[0], ...system.bodyIds] }
          : system,
      ),
    }
    const validation = validateCatalogue(mutated, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain('contains a duplicate')
  })

  it('flags a system bodyIds registry whose order differs from the mapped bodies', () => {
    const mapping = buildCatalogueMapping(FIXTURE, FIXTURE_META)
    const fixture1 = mapping.systems.find((system) => system.name === 'Fixture-1')!
    const swapped = [fixture1.bodyIds[1], fixture1.bodyIds[0]]
    const mutated: CatalogueMappingResult = {
      ...mapping,
      systems: mapping.systems.map((system) =>
        system.id === fixture1.id ? { ...system, bodyIds: swapped } : system,
      ),
    }
    const validation = validateCatalogue(mutated, FIXTURE_META)
    expect(validation.ok).toBe(false)
    expect(validation.problems.join('\n')).toContain(
      `bodyIds registry order does not match the mapped bodies order`,
    )
  })
})

describe('P1-T05 empty input', () => {
  it('produces an empty mapping with the catalogue galaxy', () => {
    const empty = buildCatalogueMapping([], EMPTY_META)
    expect(empty.systems).toEqual([])
    expect(empty.bodies).toEqual([])
    expect(empty.stats).toEqual({
      realSystems: 0,
      realBodies: 0,
      seededSystems: 0,
      seededBodies: 0,
    })
    expect(empty.galaxy.id).toBe(`gal:${CATALOGUE_GALAXY_SLUG}`)
    expect(empty.galaxy.realData).toBe(true)
    expect(empty.galaxy.provenance).toBe(PROVENANCE)
  })

  it('validateCatalogue accepts an empty mapping against a zero-row snapshot', () => {
    const empty = buildCatalogueMapping([], EMPTY_META)
    const validation = validateCatalogue(empty, EMPTY_META)
    expect(validation.ok).toBe(true)
    expect(validation.problems).toEqual([])
  })
})
