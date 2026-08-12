import { describe, expect, it } from 'vitest'
import { galaxyId, parseCanonicalId, systemId } from '../src/sim/world/identity'
import {
  buildGalaxyRecord,
  DEFAULT_GALAXY_RADIUS,
  GALAXY_GENERATION_VERSION,
  GALAXY_NAME_POOL,
  registerSystem,
  seededGalaxyClass,
  seededGalaxyName,
  universePositionFor,
  UNIVERSE_POSITION_MAX,
  UNIVERSE_POSITION_MIN,
} from '../src/sim/world/galaxy'
import type { GalaxyClass } from '../src/sim/world/galaxy'

const GALAXY_CLASSES: readonly GalaxyClass[] = [
  'spiral',
  'barred-spiral',
  'elliptical',
  'irregular',
  'dwarf',
]

describe('P1-T02 factory defaults', () => {
  it('applies every documented default', () => {
    const record = buildGalaxyRecord({ slug: 'HD-564' })
    expect(record.seed).toBe('HD-564')
    expect(record.name).toBe('HD-564')
    expect(record.class).toBe('spiral')
    expect(record.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(record.radius).toBe(DEFAULT_GALAXY_RADIUS)
    expect(record.systemIds).toEqual([])
    expect(record.generationVersion).toBe(GALAXY_GENERATION_VERSION)
    expect(record.realData).toBe(false)
    expect(record.provenance).toBe('procedural')
  })

  it('id is the branded slug id and parses as kind galaxy', () => {
    const record = buildGalaxyRecord({ slug: 'HD-564' })
    expect(record.id).toBe(galaxyId('HD-564'))
    const parsed = parseCanonicalId(record.id)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.kind === 'galaxy') {
      expect(parsed.slug).toBe('HD-564')
    }
  })

  it('honours explicit overrides for seed, name and class', () => {
    const record = buildGalaxyRecord({
      slug: 'HD-564',
      seed: 'gen-alpha',
      name: 'Aurelia',
      class: 'barred-spiral',
    })
    expect(record.id).toBe(galaxyId('HD-564'))
    expect(record.seed).toBe('gen-alpha')
    expect(record.name).toBe('Aurelia')
    expect(record.class).toBe('barred-spiral')
  })

  it('honours explicit overrides for position and radius', () => {
    const record = buildGalaxyRecord({
      slug: 'HD-564',
      position: { x: 1, y: -2, z: 3 },
      radius: 900,
    })
    expect(record.position).toEqual({ x: 1, y: -2, z: 3 })
    expect(record.radius).toBe(900)
  })

  it('clones the supplied position so the record is not aliased', () => {
    const position = { x: 5, y: 6, z: 7 }
    const record = buildGalaxyRecord({ slug: 'HD-564', position })
    position.x = 999
    expect(record.position).toEqual({ x: 5, y: 6, z: 7 })
  })
})

describe('P1-T02 real-data construction is impossible via the factory', () => {
  it('the input type has no realData member (compile-time rejection)', () => {
    // @ts-expect-error realData is not part of the factory input contract
    buildGalaxyRecord({ slug: 'HD-564', realData: true })
  })

  it('the input type has no provenance member (compile-time rejection)', () => {
    // @ts-expect-error provenance is not part of the factory input contract
    buildGalaxyRecord({ slug: 'HD-564', provenance: 'nasa-exoplanet-archive-2026-08-10' })
  })

  it('runtime default is always procedural even when extra fields are passed', () => {
    const input = {
      slug: 'HD-564',
      realData: true,
      provenance: 'nasa-exoplanet-archive-2026-08-10',
    }
    const record = buildGalaxyRecord(input)
    expect(record.realData).toBe(false)
    expect(record.provenance).toBe('procedural')
  })

  it('every record stays procedural across many inputs', () => {
    for (const slug of ['a', 'b', 'c']) {
      const record = buildGalaxyRecord({ slug })
      expect(record.realData).toBe(false)
      expect(record.provenance).toBe('procedural')
    }
  })
})

describe('P1-T02 determinism', () => {
  it('same input produces deep-equal records', () => {
    const a = buildGalaxyRecord({ slug: 'HD-564', seed: 's1' })
    const b = buildGalaxyRecord({ slug: 'HD-564', seed: 's1' })
    expect(a).toEqual(b)
  })

  it('same input produces distinct object identity', () => {
    const a = buildGalaxyRecord({ slug: 'HD-564' })
    const b = buildGalaxyRecord({ slug: 'HD-564' })
    expect(a).not.toBe(b)
  })

  it('different slugs produce different ids', () => {
    const a = buildGalaxyRecord({ slug: 'HD-564' })
    const b = buildGalaxyRecord({ slug: 'Kepler-186' })
    expect(a.id).not.toBe(b.id)
    expect(a).not.toEqual(b)
  })

  it('same slug with different seed keeps the slug id but changes the seed', () => {
    const a = buildGalaxyRecord({ slug: 'HD-564', seed: 'alpha' })
    const b = buildGalaxyRecord({ slug: 'HD-564', seed: 'beta' })
    expect(a.id).toBe(b.id)
    expect(a.seed).not.toBe(b.seed)
    expect(a).not.toEqual(b)
  })
})

describe('P1-T02 generation version', () => {
  it('GALAXY_GENERATION_VERSION is 1', () => {
    expect(GALAXY_GENERATION_VERSION).toBe(1)
  })

  it('every record carries the current generation version', () => {
    for (const slug of ['a', 'b', 'c']) {
      expect(buildGalaxyRecord({ slug }).generationVersion).toBe(1)
    }
  })
})

describe('P1-T02 seededGalaxyClass', () => {
  it('is deterministic for a fixed seed', () => {
    const seed = 'proxima-3'
    const first = seededGalaxyClass(seed)
    for (let i = 0; i < 20; i++) {
      expect(seededGalaxyClass(seed)).toBe(first)
    }
  })

  it('only ever returns members of the union', () => {
    for (let i = 0; i < 300; i++) {
      const cls = seededGalaxyClass(`sample-${i}`)
      expect(GALAXY_CLASSES).toContain(cls)
    }
  })

  it('reaches every union value across a seeded sample (distribution sanity)', () => {
    const seen = new Set<GalaxyClass>()
    for (let i = 0; i < 300; i++) {
      seen.add(seededGalaxyClass(`seed-${i}`))
    }
    expect([...seen].sort()).toEqual([...GALAXY_CLASSES].sort())
  })

  it('different seeds can produce different classes', () => {
    const classes = new Set(
      Array.from({ length: 60 }, (_, i) => seededGalaxyClass(`mix-${i}`)),
    )
    expect(classes.size).toBeGreaterThan(1)
  })
})

describe('P1-T02 seededGalaxyName', () => {
  it('is stable for a fixed seed', () => {
    const seed = 'andromeda-core'
    const first = seededGalaxyName(seed)
    for (let i = 0; i < 10; i++) {
      expect(seededGalaxyName(seed)).toBe(first)
    }
  })

  it('always returns a name from the 20-name pool', () => {
    expect(GALAXY_NAME_POOL.length).toBe(20)
    for (let i = 0; i < 300; i++) {
      expect(GALAXY_NAME_POOL).toContain(seededGalaxyName(`pool-${i}`))
    }
  })

  it('reaches a variety of names across seeds', () => {
    const names = new Set(
      Array.from({ length: 300 }, (_, i) => seededGalaxyName(`pool-${i}`)),
    )
    expect(names.size).toBeGreaterThan(1)
  })
})

describe('P1-T02 universePositionFor', () => {
  it('is deterministic for the same slug and index', () => {
    const a = universePositionFor('HD-564', 0)
    const b = universePositionFor('HD-564', 0)
    expect(a).toEqual(b)
  })

  it('keeps every position inside the [1800, 6000] shell', () => {
    for (let i = 0; i < 200; i++) {
      const p = universePositionFor(`shell-${i}`, i)
      const magnitude = Math.hypot(p.x, p.y, p.z)
      expect(magnitude).toBeGreaterThanOrEqual(UNIVERSE_POSITION_MIN)
      expect(magnitude).toBeLessThanOrEqual(UNIVERSE_POSITION_MAX)
    }
  })

  it('produces finite numeric coordinates', () => {
    for (const key of ['x', 'y', 'z'] as const) {
      expect(Number.isFinite(universePositionFor('HD-564', 3)[key])).toBe(true)
    }
  })

  it('distinct slugs produce distinct positions', () => {
    const a = universePositionFor('HD-564', 0)
    const b = universePositionFor('Kepler-186', 0)
    expect(a).not.toEqual(b)
  })

  it('different indices for the same slug produce distinct positions', () => {
    const a = universePositionFor('HD-564', 0)
    const b = universePositionFor('HD-564', 1)
    expect(a).not.toEqual(b)
  })
})

describe('P1-T02 registerSystem', () => {
  it('appends a system and returns a new record without mutating the input', () => {
    const galaxy = buildGalaxyRecord({ slug: 'HD-564' })
    const sys = systemId('HD-564', 'alpha')
    const next = registerSystem(galaxy, sys)
    expect(next).not.toBe(galaxy)
    expect(galaxy.systemIds).toEqual([])
    expect(next.systemIds).toEqual([sys])
  })

  it('preserves order across multiple appends', () => {
    let galaxy = buildGalaxyRecord({ slug: 'HD-564' })
    const a = systemId('HD-564', 'a')
    const b = systemId('HD-564', 'b')
    const c = systemId('HD-564', 'c')
    galaxy = registerSystem(galaxy, a)
    galaxy = registerSystem(galaxy, b)
    galaxy = registerSystem(galaxy, c)
    expect(galaxy.systemIds).toEqual([a, b, c])
  })

  it('skips duplicates so ids never repeat', () => {
    const galaxy = buildGalaxyRecord({ slug: 'HD-564' })
    const sys = systemId('HD-564', 'alpha')
    const once = registerSystem(galaxy, sys)
    const twice = registerSystem(once, sys)
    expect(twice.systemIds).toEqual([sys])
    expect(twice.systemIds.length).toBe(1)
  })

  it('rejected duplicates still return a fresh record and never mutate the input', () => {
    const galaxy = buildGalaxyRecord({ slug: 'HD-564' })
    const sys = systemId('HD-564', 'alpha')
    const once = registerSystem(galaxy, sys)
    const twice = registerSystem(once, sys)
    expect(twice).not.toBe(once)
    expect(once.systemIds).toEqual([sys])
  })

  it('duplicate path does not alias the returned systemIds to the input array', () => {
    const galaxy = buildGalaxyRecord({ slug: 'HD-564' })
    const sys = systemId('HD-564', 'alpha')
    const once = registerSystem(galaxy, sys)
    const twice = registerSystem(once, sys)
    expect(twice).not.toBe(once)
    twice.systemIds.push(systemId('HD-564', 'beta'))
    expect(once.systemIds).toEqual([sys])
    expect(twice.systemIds).toEqual([sys, systemId('HD-564', 'beta')])
  })

  it('returned systemIds is not aliased to the input array', () => {
    const galaxy = buildGalaxyRecord({ slug: 'HD-564' })
    const sys = systemId('HD-564', 'alpha')
    const next = registerSystem(galaxy, sys)
    next.systemIds.push(systemId('HD-564', 'beta'))
    expect(galaxy.systemIds).toEqual([])
    expect(next.systemIds).toEqual([sys, systemId('HD-564', 'beta')])
  })
})
