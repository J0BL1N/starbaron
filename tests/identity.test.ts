import { describe, expect, it } from 'vitest'
import { fnv1a } from '../src/sim/planets/hash'
import {
  bodyId,
  canonicalBodyOrder,
  canonicalSystemOrder,
  galaxyId,
  idSeed,
  parentOf,
  parseCanonicalId,
  systemId,
  ORDINAL_MAX,
} from '../src/sim/world/identity'
import type {
  BodyId,
  BodyRef,
  BodyType,
  CanonicalId,
  GalaxyId,
  SystemId,
  SystemRef,
} from '../src/sim/world/identity'

const BODY_TYPES: readonly BodyType[] = ['star', 'planet', 'moon', 'asteroid']

describe('P1-T01 galaxy ids', () => {
  it('galaxyId is stable and branded', () => {
    expect(galaxyId('HD-564')).toBe('gal:HD-564')
    expect(galaxyId('HD-564')).toBe(galaxyId('HD-564'))
  })

  it('parse(galaxyId(x)) round-trips to kind galaxy with the same slug', () => {
    const id = galaxyId('HD-564')
    const parsed = parseCanonicalId(id)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.kind === 'galaxy') {
      expect(parsed.slug).toBe('HD-564')
      expect(parsed.id).toBe(id)
    }
  })
})

describe('P1-T01 system ids', () => {
  it('systemId is stable for string and number seeds', () => {
    expect(systemId('HD-564', 'alpha')).toBe('sys:HD-564|alpha')
    expect(systemId('HD-564', 3)).toBe('sys:HD-564|3')
    expect(systemId('HD-564', 'alpha')).toBe(systemId('HD-564', 'alpha'))
  })

  it('parse(systemId(g, s)) round-trips galaxySlug and systemSeed', () => {
    for (const seed of ['alpha', 7]) {
      const parsed = parseCanonicalId(systemId('HD-564', seed))
      expect(parsed.ok).toBe(true)
      if (parsed.ok && parsed.kind === 'system') {
        expect(parsed.galaxySlug).toBe('HD-564')
        expect(parsed.systemSeed).toBe(String(seed))
        expect(parsed.id).toBe(`sys:HD-564|${seed}`)
      }
    }
  })
})

describe('P1-T01 body ids', () => {
  it('bodyId produces canonical ids for every body type', () => {
    const sys = systemId('HD-564', 'inner')
    expect(bodyId(sys, 'star', 0)).toBe('body:HD-564|inner|star|0')
    expect(bodyId(sys, 'planet', 1)).toBe('body:HD-564|inner|planet|1')
    expect(bodyId(sys, 'moon', 2)).toBe('body:HD-564|inner|moon|2')
    expect(bodyId(sys, 'asteroid', 3)).toBe('body:HD-564|inner|asteroid|3')
  })

  it('parse(bodyId(sys, type, ordinal)) round-trips all four body types', () => {
    const sys = systemId('HD-564', 'inner')
    for (const type of BODY_TYPES) {
      const id = bodyId(sys, type, 2)
      const parsed = parseCanonicalId(id)
      expect(parsed.ok).toBe(true)
      if (parsed.ok && parsed.kind === 'body') {
        expect(parsed.bodyType).toBe(type)
        expect(parsed.ordinal).toBe(2)
        expect(parsed.galaxySlug).toBe('HD-564')
        expect(parsed.systemSeed).toBe('inner')
        expect(parsed.id).toBe(id)
      }
    }
  })
})

describe('P1-T01 parent chains', () => {
  it('body -> system -> galaxy, galaxy has no parent', () => {
    const sys = systemId('HD-564', 7)
    const moon = bodyId(sys, 'moon', 2)
    expect(parentOf(moon)).toBe(sys)
    expect(parentOf(sys)).toBe(galaxyId('HD-564'))
    expect(parentOf(galaxyId('HD-564'))).toBeNull()
  })

  it('SystemRef and BodyRef hold the correct links', () => {
    const galaxy: GalaxyId = galaxyId('HD-564')
    const sys: SystemId = systemId('HD-564', 'alpha')
    const refs: SystemRef = { id: sys, galaxy }
    const moon: BodyId = bodyId(sys, 'moon', 2)
    const bodyRefs: BodyRef = { id: moon, type: 'moon', parent: sys }
    expect(refs.galaxy).toBe('gal:HD-564')
    expect(bodyRefs.parent).toBe(sys)
    expect(parentOf(bodyRefs.id)).toBe(bodyRefs.parent)
  })
})

describe('P1-T01 malformed id rejection', () => {
  const invalid: ReadonlyArray<readonly [string, string]> = [
    ['', 'empty id'],
    ['gal:', 'empty galaxy slug'],
    ['gal:a|b', 'extra segments'],
    ['sys:a|', 'empty segment'],
    ['sys:a', 'missing segment'],
    ['body:a|b|comet|1', 'invalid body type'],
    ['body:a|b|planet', 'missing ordinal'],
    ['body:a|b|planet|-1', 'negative ordinal'],
    ['body:a|b|planet|NaN', 'non-numeric ordinal'],
    ['body:a|b|planet|2.5', 'non-integer ordinal'],
    ['body:a|b|planet|01', 'leading-zero ordinal'],
    ['body:a|b|planet|1|extra', 'extra segments'],
    [`body:a|b|planet|${'9'.repeat(400)}`, 'overflowing ordinal'],
    ['planet:HD-564', 'unknown prefix'],
  ]
  for (const [input, why] of invalid) {
    it(`rejects ${JSON.stringify(input)} (${why})`, () => {
      const parsed = parseCanonicalId(input)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) {
        expect(parsed.reason.length).toBeGreaterThan(0)
      }
    })
  }

  it('rejects a digit-only ordinal that overflows to Infinity', () => {
    const parsed = parseCanonicalId(`body:a|b|planet|${'9'.repeat(400)}`)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.reason.length).toBeGreaterThan(0)
    }
  })

  it('accepts a large but finite ordinal', () => {
    const parsed = parseCanonicalId('body:HD-564|inner|planet|9999999')
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.kind === 'body') {
      expect(parsed.ordinal).toBe(9999999)
    }
  })
})

describe('P1-T01 canonical ordinal bounds (ORDINAL_MAX parity)', () => {
  it('rejects a leading-zero ordinal as a distinct id string', () => {
    const parsed = parseCanonicalId('body:gal|sys|planet|01')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.reason).toContain('invalid ordinal')
    }
  })

  it('rejects an ordinal above the PostgreSQL int4 bound', () => {
    const parsed = parseCanonicalId('body:gal|sys|planet|2147483648')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.reason).toContain('invalid ordinal')
    }
  })

  it('accepts exactly the ORDINAL_MAX boundary', () => {
    const parsed = parseCanonicalId(`body:gal|sys|planet|${ORDINAL_MAX}`)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.kind === 'body') {
      expect(parsed.ordinal).toBe(ORDINAL_MAX)
    }
  })

  it('bodyId round-trips the ORDINAL_MAX boundary', () => {
    const sys = systemId('gal', 'sys')
    const id = bodyId(sys, 'planet', ORDINAL_MAX)
    expect(id).toBe(`body:gal|sys|planet|${ORDINAL_MAX}`)
    const parsed = parseCanonicalId(id)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.kind === 'body') {
      expect(parsed.ordinal).toBe(ORDINAL_MAX)
    }
  })
})

describe('P1-T01 factory input validation', () => {
  it('galaxyId("") throws', () => {
    expect(() => galaxyId('')).toThrow(/galaxy slug/)
  })

  it('galaxyId with a delimiter throws', () => {
    expect(() => galaxyId('a|b')).toThrow(/must not contain '\|'/)
  })

  it('systemId("a", "") throws', () => {
    expect(() => systemId('a', '')).toThrow(/must not be empty/)
  })

  it('systemId("a|b", "c") throws', () => {
    expect(() => systemId('a|b', 'c')).toThrow(/galaxy slug must not contain '\|'/)
  })

  it('systemId("a", "b|c") throws', () => {
    expect(() => systemId('a', 'b|c')).toThrow(/system seed must not contain '\|'/)
  })

  it('bodyId(sys, "planet", -1) throws', () => {
    const sys = systemId('HD-564', 'inner')
    expect(() => bodyId(sys, 'planet', -1)).toThrow(/non-negative integer ordinal/)
  })

  it('bodyId(sys, "planet", 2.5) throws', () => {
    const sys = systemId('HD-564', 'inner')
    expect(() => bodyId(sys, 'planet', 2.5)).toThrow(/non-negative integer ordinal/)
  })

  it('bodyId(sys, "planet", NaN) throws', () => {
    const sys = systemId('HD-564', 'inner')
    expect(() => bodyId(sys, 'planet', NaN)).toThrow(/non-negative integer ordinal/)
  })

  it('bodyId(sys, "planet", Infinity) throws', () => {
    const sys = systemId('HD-564', 'inner')
    expect(() => bodyId(sys, 'planet', Infinity)).toThrow(/non-negative integer ordinal/)
  })

  it('bodyId(sys, "planet", ORDINAL_MAX + 1) throws', () => {
    const sys = systemId('HD-564', 'inner')
    expect(() => bodyId(sys, 'planet', ORDINAL_MAX + 1)).toThrow(
      /non-negative integer ordinal/,
    )
  })

  it('every factory output parses back with ok:true (round-trip invariant)', () => {
    const sys = systemId('HD-564', 'inner')
    const ids: readonly string[] = [
      galaxyId('HD-564'),
      systemId('HD-564', 'inner'),
      systemId('HD-564', 7),
      bodyId(sys, 'star', 0),
      bodyId(sys, 'planet', 1),
      bodyId(sys, 'moon', 999),
    ]
    for (const id of ids) {
      const parsed = parseCanonicalId(id)
      expect(parsed.ok, `expected ok:true for ${id}`).toBe(true)
    }
  })
})

describe('P1-T01 determinism', () => {
  const sample: readonly CanonicalId[] = [
    galaxyId('HD-564'),
    systemId('HD-564', 'alpha'),
    systemId('HD-564', 2),
    bodyId(systemId('HD-564', 'alpha'), 'planet', 0),
    bodyId(systemId('HD-564', 'alpha'), 'moon', 3),
    bodyId(systemId('HD-564', 'beta'), 'asteroid', 1),
  ]

  it('same inputs produce identical ids and idSeed', () => {
    const sys = systemId('HD-564', 'alpha')
    const moon = bodyId(sys, 'moon', 3)
    expect(systemId('HD-564', 'alpha')).toBe(sys)
    expect(bodyId(systemId('HD-564', 'alpha'), 'moon', 3)).toBe(moon)
    expect(idSeed(moon)).toBe(idSeed(moon))
  })

  it('different inputs produce different ids', () => {
    const strings = sample.map(String)
    expect(new Set(strings).size).toBe(strings.length)
  })

  it('different ids produce different idSeed values', () => {
    const seeds = sample.map(idSeed)
    expect(new Set(seeds).size).toBe(seeds.length)
  })

  it('idSeed is stable and equals fnv1a(id)', () => {
    for (const id of sample) {
      expect(idSeed(id)).toBe(fnv1a(id))
      expect(idSeed(id)).toBe(idSeed(id))
    }
  })
})

describe('P1-T01 canonical registry order helpers', () => {
  it('canonicalSystemOrder sorts by id string (lexicographic)', () => {
    const input = ['sys:b|z', 'sys:a|y', 'sys:a|x', 'sys:b|a']
    expect(canonicalSystemOrder(input)).toEqual([
      'sys:a|x',
      'sys:a|y',
      'sys:b|a',
      'sys:b|z',
    ])
  })

  it('canonicalSystemOrder is idempotent and stable', () => {
    const input = ['sys:b|z', 'sys:a|y', 'sys:a|y', 'sys:b|a']
    const once = canonicalSystemOrder(input)
    expect(canonicalSystemOrder(once)).toEqual(once)
  })

  it('canonicalBodyOrder sorts by (ordinal, then id string)', () => {
    const sys = systemId('g', 's')
    const input = [
      bodyId(sys, 'moon', 2),
      bodyId(sys, 'star', 0),
      bodyId(sys, 'planet', 0),
      bodyId(sys, 'planet', 1),
    ]
    expect(canonicalBodyOrder(input)).toEqual([
      bodyId(sys, 'planet', 0),
      bodyId(sys, 'star', 0),
      bodyId(sys, 'planet', 1),
      bodyId(sys, 'moon', 2),
    ])
  })

  it('canonicalBodyOrder sorts ids that do not parse as bodies last by id string', () => {
    expect(
      canonicalBodyOrder(['sys:a|b', 'body:g|s|planet|0', 'sys:z|y']),
    ).toEqual(['body:g|s|planet|0', 'sys:a|b', 'sys:z|y'])
  })
})

describe('P1-T01 branded types', () => {
  it('GalaxyId is assignable where GalaxyId is expected', () => {
    const requireGalaxy = (g: GalaxyId): GalaxyId => g
    expect(requireGalaxy(galaxyId('HD-564'))).toBe('gal:HD-564')
  })

  it('CanonicalId flows through parentOf and idSeed', () => {
    const ids: readonly CanonicalId[] = [
      galaxyId('HD-564'),
      systemId('HD-564', 0),
      bodyId(systemId('HD-564', 0), 'star', 0),
    ]
    expect(ids.map(parentOf).map(p => (p === null ? 'null' : p))).toEqual([
      'null',
      'gal:HD-564',
      'sys:HD-564|0',
    ])
    expect(ids.every(id => Number.isInteger(idSeed(id)))).toBe(true)
  })
})
