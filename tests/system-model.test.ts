import { describe, expect, it } from 'vitest'
import { galaxyId, parentOf, parseCanonicalId, bodyId, systemId } from '../src/sim/world/identity'
import { buildGalaxyRecord } from '../src/sim/world/galaxy'
import {
  buildSystemRecord,
  DEFAULT_STAR_COLOR,
  GALAXY_LOCAL_RADIUS_MAX,
  GALAXY_LOCAL_RADIUS_MIN,
  galaxyLocalPositionFor,
  registerBody,
  starColorFor,
  SYSTEM_GENERATION_VERSION,
} from '../src/sim/world/system'

const GALAXY = galaxyId('HD-564')

function record(slug = 'Aurora'): ReturnType<typeof buildSystemRecord> {
  return buildSystemRecord({ galaxy: GALAXY, slug })
}

describe('P1-T03 factory defaults', () => {
  it('applies every documented default', () => {
    const sys = record()
    expect(sys.seed).toBe('Aurora')
    expect(sys.name).toBe('Aurora')
    expect(sys.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(sys.bodyIds).toEqual([])
    expect(sys.generationVersion).toBe(SYSTEM_GENERATION_VERSION)
    expect(sys.realData).toBe(false)
    expect(sys.provenance).toBe('procedural')
    expect(sys.star.name).toBe('Aurora')
    expect(sys.star.starType).toBeUndefined()
    expect(sys.star.color).toBe(DEFAULT_STAR_COLOR)
  })

  it('id is branded, parses as kind system and carries the parent galaxy slug', () => {
    const sys = record('Alpha-Cyg')
    const parsed = parseCanonicalId(sys.id)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.kind === 'system') {
      expect(parsed.galaxySlug).toBe('HD-564')
      expect(parsed.systemSeed).toBe('Alpha-Cyg')
    }
    expect(sys.id).toBe(systemId('HD-564', 'Alpha-Cyg'))
  })

  it('parentOf(system.id) === galaxy', () => {
    const sys = record('Alpha-Cyg')
    expect(parentOf(sys.id)).toBe(GALAXY)
  })

  it('honours overrides for seed, name and starType', () => {
    const sys = buildSystemRecord({
      galaxy: GALAXY,
      slug: 'Alpha-Cyg',
      seed: 'gen-2',
      name: 'Aurora Prime',
      starType: 'G2 V',
    })
    expect(sys.seed).toBe('gen-2')
    expect(sys.name).toBe('Aurora Prime')
    expect(sys.id).toBe(systemId('HD-564', 'gen-2'))
    expect(sys.star.starType).toBe('G2 V')
    expect(sys.star.name).toBe('Aurora Prime')
  })

  it('honours overrides for position', () => {
    const sys = buildSystemRecord({
      galaxy: GALAXY,
      slug: 'Alpha-Cyg',
      position: { x: 1, y: -2, z: 3 },
    })
    expect(sys.position).toEqual({ x: 1, y: -2, z: 3 })
    expect(sys.realData).toBe(false)
    expect(sys.provenance).toBe('procedural')
  })

  it('clones the supplied position so the record is not aliased', () => {
    const position = { x: 5, y: 6, z: 7 }
    const sys = buildSystemRecord({ galaxy: GALAXY, slug: 'A', position })
    position.x = 999
    expect(sys.position).toEqual({ x: 5, y: 6, z: 7 })
  })

  it('throws when the parent id is not a GalaxyId', () => {
    const bad = 'gal-not-branded'
    expect(() => buildSystemRecord({ galaxy: bad as never, slug: 'A' })).toThrow(
      /valid GalaxyId/,
    )
  })
})

describe('P1-T03 real-data construction is impossible via the factory', () => {
  it('the input type has no realData member (compile-time rejection)', () => {
    // @ts-expect-error realData is not part of the factory input contract
    buildSystemRecord({ galaxy: GALAXY, slug: 'Alpha-Cyg', realData: true })
  })

  it('the input type has no provenance member (compile-time rejection)', () => {
    // @ts-expect-error provenance is not part of the factory input contract
    buildSystemRecord({ galaxy: GALAXY, slug: 'Alpha-Cyg', provenance: 'nasa-exoplanet-archive-2026-08-10' })
  })

  it('runtime default is always procedural even when extra fields are passed', () => {
    const input = {
      galaxy: GALAXY,
      slug: 'Alpha-Cyg',
      realData: true,
      provenance: 'nasa-exoplanet-archive-2026-08-10',
    }
    const sys = buildSystemRecord(input)
    expect(sys.realData).toBe(false)
    expect(sys.provenance).toBe('procedural')
  })

  it('every record stays procedural across many slugs', () => {
    for (const slug of ['a', 'b', 'c']) {
      const sys = buildSystemRecord({ galaxy: GALAXY, slug })
      expect(sys.realData).toBe(false)
      expect(sys.provenance).toBe('procedural')
    }
  })
})

describe('P1-T03 star metadata', () => {
  it('star color is a deterministic pick from the spectral class neighbourhood', () => {
    const a = starColorFor('G2 V', 'seed-1')
    const b = starColorFor('G2 V', 'seed-1')
    expect(a).toBe(b)
    expect(a).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('different seeds can produce different colours for the same starType', () => {
    const colours = new Set(
      Array.from({ length: 40 }, (_, i) => starColorFor('G2 V', `seed-${i}`)),
    )
    expect(colours.size).toBeGreaterThan(1)
  })

  it('unknown spectral class falls back to the default colour', () => {
    expect(starColorFor('XX9', 'seed')).toBe(DEFAULT_STAR_COLOR)
  })

  it('missing starType always uses the default colour', () => {
    expect(starColorFor(undefined, 'seed-a')).toBe(DEFAULT_STAR_COLOR)
    expect(starColorFor(undefined, 'seed-b')).toBe(DEFAULT_STAR_COLOR)
  })

  it('record star.color matches the deterministic picker for its seed', () => {
    const sys = buildSystemRecord({
      galaxy: GALAXY,
      slug: 'Tau',
      seed: 'edge-3',
      starType: 'K0 V',
    })
    expect(sys.star.color).toBe(starColorFor('K0 V', 'edge-3'))
  })
})

describe('P1-T03 determinism', () => {
  it('same input produces deep-equal records', () => {
    const input = {
      galaxy: GALAXY,
      slug: 'HD-564',
      seed: 's1',
      name: 'Aurora',
      starType: 'G2 V',
    }
    expect(buildSystemRecord(input)).toEqual(buildSystemRecord(input))
  })

  it('same input produces distinct object identity', () => {
    expect(record('A')).not.toBe(record('A'))
  })

  it('distinct slugs produce distinct ids', () => {
    expect(record('A').id).not.toBe(record('B').id)
    expect(record('A')).not.toEqual(record('B'))
  })

  it('same slug with a different seed changes the id and the record', () => {
    const a = buildSystemRecord({ galaxy: GALAXY, slug: 'HD-564', seed: 'alpha' })
    const b = buildSystemRecord({ galaxy: GALAXY, slug: 'HD-564', seed: 'beta' })
    expect(a.id).not.toBe(b.id)
    expect(a).not.toEqual(b)
  })
})

describe('P1-T03 galaxyLocalPositionFor', () => {
  it('is deterministic for the same slug and index', () => {
    expect(galaxyLocalPositionFor('HD-564', 0)).toEqual(
      galaxyLocalPositionFor('HD-564', 0),
    )
  })

  it('keeps magnitude inside [0.4, 0.55] * default galaxy radius', () => {
    for (let i = 0; i < 200; i++) {
      const p = galaxyLocalPositionFor(`disk-${i}`, i)
      const magnitude = Math.hypot(p.x, p.y, p.z)
      expect(magnitude).toBeGreaterThanOrEqual(GALAXY_LOCAL_RADIUS_MIN * 600)
      expect(magnitude).toBeLessThanOrEqual(GALAXY_LOCAL_RADIUS_MAX * 600 + 1e-9)
    }
  })

  it('keeps magnitude inside the band for a custom galaxy radius', () => {
    const radius = 1000
    for (let i = 0; i < 100; i++) {
      const p = galaxyLocalPositionFor('custom', i, radius)
      const magnitude = Math.hypot(p.x, p.y, p.z)
      expect(magnitude).toBeGreaterThanOrEqual(GALAXY_LOCAL_RADIUS_MIN * radius)
      expect(magnitude).toBeLessThanOrEqual(GALAXY_LOCAL_RADIUS_MAX * radius + 1e-9)
    }
  })

  it('produces finite numeric coordinates', () => {
    for (const key of ['x', 'y', 'z'] as const) {
      expect(Number.isFinite(galaxyLocalPositionFor('HD-564', 3)[key])).toBe(true)
    }
  })

  it('distinct slugs produce distinct positions', () => {
    expect(galaxyLocalPositionFor('HD-564', 0)).not.toEqual(
      galaxyLocalPositionFor('Kepler-186', 0),
    )
  })

  it('different indices for the same slug produce distinct positions', () => {
    expect(galaxyLocalPositionFor('HD-564', 0)).not.toEqual(
      galaxyLocalPositionFor('HD-564', 1),
    )
  })
})

describe('P1-T03 registerBody', () => {
  it('appends a body and returns a new record without mutating the input', () => {
    const sys = record('A')
    const b = bodyId(sys.id, 'planet', 0)
    const next = registerBody(sys, b)
    expect(next).not.toBe(sys)
    expect(sys.bodyIds).toEqual([])
    expect(next.bodyIds).toEqual([b])
  })

  it('preserves order across multiple appends', () => {
    let sys = record('A')
    const a = bodyId(sys.id, 'planet', 0)
    const b = bodyId(sys.id, 'planet', 1)
    const c = bodyId(sys.id, 'moon', 0)
    sys = registerBody(sys, a)
    sys = registerBody(sys, b)
    sys = registerBody(sys, c)
    expect(sys.bodyIds).toEqual([a, b, c])
  })

  it('skips duplicates so bodyIds never repeat', () => {
    const sys = record('A')
    const b = bodyId(sys.id, 'planet', 0)
    const once = registerBody(sys, b)
    const twice = registerBody(once, b)
    expect(twice.bodyIds).toEqual([b])
    expect(twice.bodyIds.length).toBe(1)
  })

  it('rejected duplicates still return a fresh record and never mutate the input', () => {
    const sys = record('A')
    const b = bodyId(sys.id, 'planet', 0)
    const once = registerBody(sys, b)
    const twice = registerBody(once, b)
    expect(twice).not.toBe(once)
    expect(once.bodyIds).toEqual([b])
  })

  it('returned bodyIds is not aliased to the input array', () => {
    const sys = record('A')
    const b = bodyId(sys.id, 'planet', 0)
    const next = registerBody(sys, b)
    next.bodyIds.push(bodyId(sys.id, 'moon', 0))
    expect(sys.bodyIds).toEqual([])
    expect(next.bodyIds).toEqual([b, bodyId(sys.id, 'moon', 0)])
  })
})

describe('P1-T03 generation version', () => {
  it('SYSTEM_GENERATION_VERSION is 1', () => {
    expect(SYSTEM_GENERATION_VERSION).toBe(1)
  })

  it('every record carries the current generation version', () => {
    for (const slug of ['a', 'b', 'c']) {
      expect(record(slug).generationVersion).toBe(1)
    }
  })

  it('buildGalaxyRecord + buildSystemRecord link cleanly via identity', () => {
    const galaxy = buildGalaxyRecord({ slug: 'HD-564' })
    const sys = buildSystemRecord({ galaxy: galaxy.id, slug: 'Tau' })
    expect(sys.galaxy).toBe(galaxy.id)
    expect(parentOf(sys.id)).toBe(galaxy.id)
  })
})
