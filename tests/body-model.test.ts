import { describe, expect, it } from 'vitest'
import { bodyId, parentOf, parseCanonicalId, systemId } from '../src/sim/world/identity'
import type { BodyType } from '../src/sim/world/identity'
import {
  BODY_GENERATION_VERSION,
  BODY_NAME_POOL,
  buildBodyRecord,
  describeBody,
  seededBodyName,
} from '../src/sim/world/body'
import type { BodyRecord } from '../src/sim/world/body'
import { CATALOGUE_TRUST } from '../src/sim/world/trust'
import type { CatalogueTrust } from '../src/sim/world/trust'

const SYSTEM = systemId('HD-564', 'Aurora')

const BODY_TYPES: readonly BodyType[] = ['star', 'planet', 'moon', 'asteroid']

const REAL_PROVENANCE = 'nasa-exoplanet-archive-2026-08-10'

/** Test-held catalogue capability token (catalogue.ts is the prod issuer). */
const CATALOGUE_TRUST_TOKEN: CatalogueTrust = { [CATALOGUE_TRUST]: true }

type BodyInput = Omit<
  Parameters<typeof buildBodyRecord>[0],
  'system' | 'type' | 'ordinal'
>

function body(
  type: BodyType,
  ordinal = 0,
  overrides: BodyInput = {},
): BodyRecord {
  return buildBodyRecord({ system: SYSTEM, type, ordinal, ...overrides })
}

const ORBIT_KEYS = [
  'semiMajorAxis',
  'eccentricity',
  'inclination',
  'longitudeOfAscendingNode',
  'argumentOfPeriapsis',
  'meanAnomaly',
  'period',
] as const

describe('P1-T04 factory defaults', () => {
  it('star record applies every documented default', () => {
    const star = body('star')
    expect(star.seed).toBe(star.id)
    expect(star.name).toBe('Aurora Prime')
    expect(star.radius).toBeGreaterThanOrEqual(4)
    expect(star.radius).toBeLessThan(8)
    expect(star.mass).toBeUndefined()
    expect(star.realData).toBe(false)
    expect(star.provenance).toBe('procedural')
    expect(star.generationVersion).toBe(BODY_GENERATION_VERSION)
  })

  it('planet record applies every documented default', () => {
    const planet = body('planet')
    expect(BODY_NAME_POOL).toContain(planet.name)
    expect(planet.radius).toBeGreaterThanOrEqual(0.4)
    expect(planet.radius).toBeLessThan(3)
    expect(planet.mass).toBeUndefined()
    expect(planet.realData).toBe(false)
    expect(planet.provenance).toBe('procedural')
    expect(planet.orbit.period).toBeGreaterThanOrEqual(60)
  })

  it('moon record applies every documented default', () => {
    const moon = body('moon')
    expect(moon.name).toBe('Aurora I')
    expect(moon.orbit.semiMajorAxis).toBeGreaterThanOrEqual(1)
    expect(moon.orbit.period).toBeGreaterThanOrEqual(8)
  })

  it('asteroid record applies every documented default', () => {
    const asteroid = body('asteroid')
    expect(asteroid.name).toMatch(/^SB-\d{4}$/)
    expect(asteroid.orbit.semiMajorAxis).toBeGreaterThan(0)
  })

  it('id is branded, parses as kind body and carries type + ordinal', () => {
    const planet = body('planet', 3)
    const parsed = parseCanonicalId(planet.id)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.kind === 'body') {
      expect(parsed.bodyType).toBe('planet')
      expect(parsed.ordinal).toBe(3)
      expect(parsed.galaxySlug).toBe('HD-564')
      expect(parsed.systemSeed).toBe('Aurora')
    }
    expect(planet.id).toBe(bodyId(SYSTEM, 'planet', 3))
  })

  it('parentOf(body.id) === system', () => {
    const planet = body('planet', 2)
    expect(parentOf(planet.id)).toBe(SYSTEM)
    expect(planet.system).toBe(SYSTEM)
  })

  it('throws when the system id is not a SystemId', () => {
    const bad = 'sys-not-branded'
    expect(() => buildBodyRecord({ system: bad as never, type: 'planet', ordinal: 0 })).toThrow(
      /valid SystemId/,
    )
  })

  it('honours overrides for name, seed, radius and mass', () => {
    const planet = body('planet', 0, {
      name: 'Aurorae-2',
      seed: 'gen-7',
      radius: 1.3,
      mass: 0.41,
    })
    expect(planet.name).toBe('Aurorae-2')
    expect(planet.seed).toBe('gen-7')
    expect(planet.id).toBe(bodyId(SYSTEM, 'planet', 0))
    expect(planet.radius).toBe(1.3)
    expect(planet.mass).toBe(0.41)
  })

  it('honours a partial orbit override and merges over the defaults', () => {
    const planet = body('planet', 0, { orbit: { semiMajorAxis: 21 } })
    expect(planet.orbit.semiMajorAxis).toBe(21)
    expect(planet.orbit.period).toBeGreaterThanOrEqual(60)
    expect(planet.orbit.eccentricity).toBeGreaterThanOrEqual(0)
  })

  it('honours overrides for realData and provenance', () => {
    const planet = body('planet', 0, {
      realData: true,
      provenance: REAL_PROVENANCE,
      trust: CATALOGUE_TRUST_TOKEN,
    })
    expect(planet.realData).toBe(true)
    expect(planet.provenance).toBe(REAL_PROVENANCE)
  })

  it('rejects realData true without the CATALOGUE_TRUST token', () => {
    expect(() =>
      body('planet', 0, {
        realData: true,
        provenance: REAL_PROVENANCE,
      }),
    ).toThrow(/CATALOGUE_TRUST/)
  })

  it('rejects realData true when provenance defaults to procedural without trust', () => {
    expect(() => body('planet', 0, { realData: true })).toThrow(/CATALOGUE_TRUST/)
  })

  it('rejects a non-procedural provenance without the trust token', () => {
    expect(() => body('planet', 0, { provenance: REAL_PROVENANCE })).toThrow(
      /CATALOGUE_TRUST/,
    )
  })

  it('rejects realData true without a catalogue provenance even with trust', () => {
    expect(() =>
      body('planet', 0, {
        realData: true,
        provenance: 'procedural',
        trust: CATALOGUE_TRUST_TOKEN,
      }),
    ).toThrow(/catalogue provenance/)
  })

  it('accepts realData true only with the trust token and a catalogue provenance', () => {
    const planet = body('planet', 0, {
      realData: true,
      provenance: REAL_PROVENANCE,
      trust: CATALOGUE_TRUST_TOKEN,
    })
    expect(planet.realData).toBe(true)
    expect(planet.provenance).toBe(REAL_PROVENANCE)
  })

  it('mass is omitted from the record when not supplied', () => {
    expect(body('planet').mass).toBeUndefined()
    expect('mass' in body('planet')).toBe(false)
  })
})

describe('P1-T04 orbit defaults', () => {
  it('planet orbit stays within documented bounds', () => {
    for (let i = 0; i < 100; i++) {
      const o = body('planet', i, { seed: `p-${i}` }).orbit
      expect(o.semiMajorAxis).toBeGreaterThanOrEqual(8)
      expect(o.semiMajorAxis).toBeLessThan(36)
      expect(o.eccentricity).toBeGreaterThanOrEqual(0)
      expect(o.eccentricity).toBeLessThan(0.12)
      expect(o.inclination).toBeGreaterThanOrEqual(0)
      expect(o.inclination).toBeLessThan(0.15)
      expect(o.longitudeOfAscendingNode).toBeGreaterThanOrEqual(0)
      expect(o.longitudeOfAscendingNode).toBeLessThan(Math.PI * 2)
      expect(o.argumentOfPeriapsis).toBeGreaterThanOrEqual(0)
      expect(o.argumentOfPeriapsis).toBeLessThan(Math.PI * 2)
      expect(o.meanAnomaly).toBeGreaterThanOrEqual(0)
      expect(o.meanAnomaly).toBeLessThan(Math.PI * 2)
      expect(o.period).toBeGreaterThanOrEqual(60)
      expect(o.period).toBeLessThan(600)
    }
  })

  it('moon orbit stays within documented bounds', () => {
    for (let i = 0; i < 100; i++) {
      const o = body('moon', i, { seed: `m-${i}` }).orbit
      expect(o.semiMajorAxis).toBeGreaterThanOrEqual(1)
      expect(o.semiMajorAxis).toBeLessThan(3.5)
      expect(o.period).toBeGreaterThanOrEqual(8)
      expect(o.period).toBeLessThan(48)
      expect(o.semiMajorAxis).toBeGreaterThan(0)
    }
  })

  it('asteroid and moon orbits are nonzero', () => {
    for (let i = 0; i < 50; i++) {
      expect(body('asteroid', i, { seed: `a-${i}` }).orbit.semiMajorAxis).toBeGreaterThan(0)
      expect(body('moon', i, { seed: `mo-${i}` }).orbit.semiMajorAxis).toBeGreaterThan(0)
    }
  })

  it('star orbit is all zeros', () => {
    const star = body('star')
    for (const key of ORBIT_KEYS) {
      expect(star.orbit[key]).toBe(0)
    }
  })

  it('every orbit field is finite for every type across many seeds', () => {
    for (const type of BODY_TYPES) {
      for (let i = 0; i < 50; i++) {
        const o = body(type, i, { seed: `fin-${type}-${i}` }).orbit
        for (const key of ORBIT_KEYS) {
          expect(Number.isFinite(o[key])).toBe(true)
        }
      }
    }
  })

  it('semiMajorAxis is never negative and eccentricity stays in [0, 1)', () => {
    for (const type of BODY_TYPES) {
      for (let i = 0; i < 50; i++) {
        const o = body(type, i, { seed: `bnd-${i}` }).orbit
        expect(o.semiMajorAxis).toBeGreaterThanOrEqual(0)
        expect(o.eccentricity).toBeGreaterThanOrEqual(0)
        expect(o.eccentricity).toBeLessThan(1)
      }
    }
  })
})

describe('P1-T04 orbit override validation', () => {
  it('rejects a negative semiMajorAxis override', () => {
    expect(() => body('planet', 0, { orbit: { semiMajorAxis: -1 } })).toThrow(
      /semiMajorAxis/,
    )
  })

  it('rejects an eccentricity at or above 1', () => {
    expect(() => body('planet', 0, { orbit: { eccentricity: 1 } })).toThrow(
      /eccentricity/,
    )
  })

  it('rejects a NaN period', () => {
    expect(() => body('planet', 0, { orbit: { period: NaN } })).toThrow(
      /period/,
    )
  })

  it('rejects a non-finite angle', () => {
    expect(() => body('planet', 0, { orbit: { meanAnomaly: Infinity } })).toThrow(
      /meanAnomaly/,
    )
    expect(() => body('planet', 0, { orbit: { inclination: NaN } })).toThrow(
      /inclination/,
    )
  })

  it('rejects a period of zero or below', () => {
    expect(() => body('planet', 0, { orbit: { period: 0 } })).toThrow(
      /period/,
    )
    expect(() => body('planet', 0, { orbit: { period: -5 } })).toThrow(
      /period/,
    )
  })

  it('rejects a nonzero orbit override for a star', () => {
    expect(() => body('star', 0, { orbit: { semiMajorAxis: 1 } })).toThrow(
      /must be 0/,
    )
    expect(() => body('star', 0, { orbit: { period: 12 } })).toThrow(
      /must be 0/,
    )
    expect(() => body('star', 0, { orbit: { eccentricity: 0.5 } })).toThrow(
      /must be 0/,
    )
  })

  it('accepts an all-zeros orbit override for a star', () => {
    const star = body('star', 0, {
      orbit: {
        semiMajorAxis: 0,
        eccentricity: 0,
        inclination: 0,
        longitudeOfAscendingNode: 0,
        argumentOfPeriapsis: 0,
        meanAnomaly: 0,
        period: 0,
      },
    })
    for (const key of ORBIT_KEYS) {
      expect(star.orbit[key]).toBe(0)
    }
  })

  it('accepts valid orbit overrides', () => {
    const planet = body('planet', 0, {
      orbit: { semiMajorAxis: 21, eccentricity: 0.5, period: 100 },
    })
    expect(planet.orbit.semiMajorAxis).toBe(21)
    expect(planet.orbit.eccentricity).toBe(0.5)
    expect(planet.orbit.period).toBe(100)
  })
})

describe('P1-T04 moon ordinal validation', () => {
  it('rejects a moon ordinal above 3999', () => {
    expect(() => body('moon', 4000)).toThrow(/ordinal/)
  })

  it('accepts the maximum convertible moon ordinal', () => {
    expect(body('moon', 3998).name).toBe('Aurora MMMCMXCIX')
  })
})

describe('P1-T04 seeded names', () => {
  it('seededBodyName is deterministic for every type', () => {
    for (const type of BODY_TYPES) {
      const first = seededBodyName(type, 'Aurora', 1, 'seed-x')
      for (let i = 0; i < 10; i++) {
        expect(seededBodyName(type, 'Aurora', 1, 'seed-x')).toBe(first)
      }
    }
  })

  it('planet names always come from the 16-name pool', () => {
    expect(BODY_NAME_POOL.length).toBe(16)
    for (let i = 0; i < 300; i++) {
      expect(BODY_NAME_POOL).toContain(seededBodyName('planet', 'Aurora', 0, `pool-${i}`))
    }
  })

  it('different seeds produce different planet names', () => {
    const names = new Set(
      Array.from({ length: 300 }, (_, i) => seededBodyName('planet', 'Aurora', 0, `n-${i}`)),
    )
    expect(names.size).toBeGreaterThan(1)
  })

  it('asteroid names are SB-#### and vary with the seed', () => {
    for (let i = 0; i < 100; i++) {
      expect(seededBodyName('asteroid', 'Aurora', i, `sb-${i}`)).toMatch(/^SB-\d{4}$/)
    }
    const names = new Set(
      Array.from({ length: 300 }, (_, i) => seededBodyName('asteroid', 'Aurora', i, `sb-${i}`)),
    )
    expect(names.size).toBeGreaterThan(1)
  })

  it('star name is "<system> Prime"', () => {
    expect(seededBodyName('star', 'Aurora', 0, 'anything')).toBe('Aurora Prime')
  })

  it('moon names use roman numerals from the ordinal', () => {
    expect(body('moon', 0).name).toBe('Aurora I')
    expect(body('moon', 1).name).toBe('Aurora II')
    expect(body('moon', 2).name).toBe('Aurora III')
  })
})

describe('P1-T04 describeBody', () => {
  it('produces a one-line human summary', () => {
    const planet = buildBodyRecord({
      system: SYSTEM,
      type: 'planet',
      ordinal: 2,
      name: 'Aurorae-2',
      radius: 1.3,
      orbit: { period: 212.4 },
    })
    expect(describeBody(planet)).toBe('Planet Aurorae-2 · R 1.30 · P 212s · procedural')
  })

  it('labels every body type and rounds the period', () => {
    expect(describeBody(body('star'))).toMatch(/^Star Aurora Prime · R \d+\.\d{2} · P 0s · procedural$/)
    expect(describeBody(body('asteroid'))).toMatch(/^Asteroid SB-\d{4} · R \d+\.\d{2} · P \d+s · procedural$/)
  })
})

describe('P1-T04 determinism', () => {
  it('same input produces deep-equal records', () => {
    const input: BodyInput = {
      seed: 's1',
      name: 'Aurorae-2',
      radius: 1.3,
      mass: 0.41,
      orbit: { semiMajorAxis: 21 },
      realData: true,
      provenance: REAL_PROVENANCE,
      trust: CATALOGUE_TRUST_TOKEN,
    }
    expect(buildBodyRecord({ system: SYSTEM, type: 'planet', ordinal: 2, ...input })).toEqual(
      buildBodyRecord({ system: SYSTEM, type: 'planet', ordinal: 2, ...input }),
    )
  })

  it('different ordinals produce distinct ids', () => {
    expect(body('planet', 0).id).not.toBe(body('planet', 1).id)
    expect(body('planet', 0)).not.toEqual(body('planet', 1))
  })

  it('distinct ordinals of the same type yield different default orbits', () => {
    const first = body('planet', 1)
    const second = body('planet', 2)
    expect(first.orbit.semiMajorAxis).not.toBe(second.orbit.semiMajorAxis)
  })

  it('different types produce distinct ids', () => {
    expect(body('star').id).not.toBe(body('planet').id)
    expect(body('planet').id).not.toBe(body('moon').id)
    expect(body('planet').id).not.toBe(body('asteroid').id)
  })
})

describe('P1-T04 generation version', () => {
  it('BODY_GENERATION_VERSION is 1', () => {
    expect(BODY_GENERATION_VERSION).toBe(1)
  })

  it('every record carries the current generation version', () => {
    for (const type of BODY_TYPES) {
      expect(body(type).generationVersion).toBe(1)
    }
  })

  it('buildSystemRecord + buildBodyRecord link cleanly via identity', () => {
    const sysId = systemId('HD-564', 'Aurora')
    const planet = body('planet', 0)
    expect(parentOf(planet.id)).toBe(sysId)
    expect(parseCanonicalId(planet.id).ok).toBe(true)
  })
})
