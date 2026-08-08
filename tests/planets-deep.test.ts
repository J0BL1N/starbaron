import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { PLANETS } from '../src/sim/data/planets'
import type { PlanetCatalogueEntry } from '../src/sim/data/planets'
import {
  makePlanet,
  generatePlanetIdentity,
  seedFromPlanetName,
  GENERATOR_VERSION,
  effectiveLevel,
  triggeredQuirks,
  densityProxy,
  HIGH_GRAVITY_DENSITY_THRESHOLD,
  DENSE_CORE_DENSITY_THRESHOLD,
  GAS_GIANT_DENSITY_MAX,
  MASSIVE_WORLD_MASS_MIN,
} from '../src/sim/planets'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SIM_DIR = join(ROOT, 'src', 'sim')

function bareEntry(overrides: Partial<PlanetCatalogueEntry> = {}): PlanetCatalogueEntry {
  return {
    name: 'Test World',
    hostname: 'Test Host',
    systemCount: 1,
    tier: 3,
    ...overrides,
  }
}

function quirkIds(entry: PlanetCatalogueEntry): string[] {
  return triggeredQuirks(entry).map((q) => q.id)
}

describe('P2-T02-C generator determinism (deep)', () => {
  const sampleEntries: PlanetCatalogueEntry[] = [
    PLANETS[0],
    ...PLANETS.filter((p) => p.name === 'Kepler-452 b' || p.name === 'Gliese 12 b'),
  ]

  it('same planet -> byte-identical identity across 100 iterations', () => {
    expect(sampleEntries.length).toBeGreaterThanOrEqual(2)
    for (const entry of sampleEntries) {
      const first = JSON.stringify(generatePlanetIdentity(entry))
      for (let i = 0; i < 100; i++) {
        expect(JSON.stringify(generatePlanetIdentity(entry))).toBe(first)
      }
    }
  })

  it('different planets -> distinct PRNG seeds on a 1000-planet sample (FNV-1a collision rate zero)', () => {
    const sample = PLANETS.slice(0, 1000)
    expect(sample.length).toBe(1000)
    expect(new Set(sample.map((e) => e.name)).size).toBe(sample.length)
    const seeds = sample.map((e) => seedFromPlanetName(GENERATOR_VERSION, e.name))
    expect(new Set(seeds).size).toBe(seeds.length)
  })

  it('the SEED, not the name-embedded description, drives visual + quirk variation on the sample', () => {
    const sample = PLANETS.slice(0, 1000)
    const palettes = new Set<string>()
    const emojis = new Set<string>()
    const quirkSets = new Set<string>()
    for (const entry of sample) {
      const identity = generatePlanetIdentity(entry)
      palettes.add(identity.visual.surfacePalette.join('|'))
      emojis.add(identity.visual.emoji)
      quirkSets.add(identity.quirks.map((q) => q.id).sort().join(','))
    }
    expect(palettes.size).toBeGreaterThan(50)
    expect(emojis.size).toBeGreaterThanOrEqual(3)
    expect(quirkSets.size).toBeGreaterThanOrEqual(5)
  })

  it('identity is stable across a fresh module instance (re-require)', async () => {
    const entry = PLANETS[0]
    const before = generatePlanetIdentity(entry)
    vi.resetModules()
    const fresh = await import('../src/sim/planets')
    const after = fresh.generatePlanetIdentity(entry)
    expect(after).toEqual(before)
  })
})

describe('P2-T02-C quirk trigger boundaries (>= vs < semantics)', () => {
  it('highGravity fires at densityProxy exactly == HIGH_GRAVITY_DENSITY_THRESHOLD (>=)', () => {
    const exact = bareEntry({
      name: 'HG Exact',
      radiusEarth: 1,
      massJup: HIGH_GRAVITY_DENSITY_THRESHOLD,
    })
    expect(densityProxy(exact)).toBe(HIGH_GRAVITY_DENSITY_THRESHOLD)
    expect(quirkIds(exact)).toContain('highGravity')
    const justBelow = bareEntry({
      name: 'HG Below',
      radiusEarth: 1,
      massJup: HIGH_GRAVITY_DENSITY_THRESHOLD - 0.0000001,
    })
    expect(quirkIds(justBelow)).not.toContain('highGravity')
  })

  it('denseCore fires at densityProxy exactly == DENSE_CORE_DENSITY_THRESHOLD (>=); highGravity does not', () => {
    const exact = bareEntry({
      name: 'DC Exact',
      radiusEarth: 1,
      massJup: DENSE_CORE_DENSITY_THRESHOLD,
    })
    expect(densityProxy(exact)).toBe(DENSE_CORE_DENSITY_THRESHOLD)
    expect(quirkIds(exact)).toContain('denseCore')
    expect(quirkIds(exact)).not.toContain('highGravity')
    const justBelow = bareEntry({
      name: 'DC Below',
      radiusEarth: 1,
      massJup: DENSE_CORE_DENSITY_THRESHOLD - 0.0000001,
    })
    expect(quirkIds(justBelow)).not.toContain('denseCore')
  })

  it('gasGiant is strict <: exactly == GAS_GIANT_DENSITY_MAX does NOT fire, just below fires', () => {
    const exact = bareEntry({
      name: 'GG Exact',
      tier: 5,
      radiusEarth: 1,
      massJup: GAS_GIANT_DENSITY_MAX,
    })
    expect(densityProxy(exact)).toBe(GAS_GIANT_DENSITY_MAX)
    expect(quirkIds(exact)).not.toContain('gasGiant')
    const justBelow = bareEntry({
      name: 'GG Below',
      tier: 5,
      radiusEarth: 1,
      massJup: GAS_GIANT_DENSITY_MAX - 0.0000001,
    })
    expect(quirkIds(justBelow)).toContain('gasGiant')
  })

  it('massiveWorld fires at massJup exactly == MASSIVE_WORLD_MASS_MIN (>=)', () => {
    const exact = bareEntry({ name: 'MW Exact', radiusEarth: 12, massJup: MASSIVE_WORLD_MASS_MIN })
    expect(quirkIds(exact)).toEqual(['massiveWorld'])
    const justBelow = bareEntry({
      name: 'MW Below',
      radiusEarth: 12,
      massJup: MASSIVE_WORLD_MASS_MIN - 0.0001,
    })
    expect(quirkIds(justBelow)).toEqual([])
  })

  it('spectral boundaries: K/M cold, O/B/A hot, G/F neutral', () => {
    for (const starType of ['K0', 'K5 III', 'M0', 'M5.5 V']) {
      const entry = bareEntry({ name: `cold-${starType}`, starType, radiusEarth: 1, massJup: 0.001 })
      expect(quirkIds(entry), starType).toContain('coldStar')
      expect(quirkIds(entry), starType).not.toContain('hotStar')
    }
    for (const starType of ['O9', 'B2 V', 'A0']) {
      const entry = bareEntry({ name: `hot-${starType}`, starType, radiusEarth: 1, massJup: 0.001 })
      expect(quirkIds(entry), starType).toContain('hotStar')
      expect(quirkIds(entry), starType).not.toContain('coldStar')
    }
    for (const starType of ['G2 V', 'F5', 'G8 III']) {
      const entry = bareEntry({ name: `neutral-${starType}`, starType, radiusEarth: 1, massJup: 0.001 })
      expect(quirkIds(entry), starType).not.toContain('coldStar')
      expect(quirkIds(entry), starType).not.toContain('hotStar')
    }
  })
})

describe('P2-T02-C fallback paths (D4 — every entry must generate)', () => {
  it('NO starType -> default neutral palette + unknown spectral clause', () => {
    const entry = bareEntry({ name: 'No Star Type', starType: undefined })
    const identity = generatePlanetIdentity(entry)
    expect(identity.description).toContain('unknown spectral class')
    expect(['#e0e0e0', '#d0d0d0', '#c0c0c0']).toContain(identity.visual.surfacePalette[0])
  })

  it('NO radius -> tier-derived default band drives the visual AND tier is untouched', () => {
    const expectations: Array<[PlanetCatalogueEntry['tier'], string, string]> = [
      [1, '🪨', 'rocky world'],
      [2, '🪨', 'rocky world'],
      [3, '🌍', 'water world'],
      [4, '🌊', 'super-Earth'],
      [5, '🪐', 'gas giant'],
    ]
    for (const [tier, emoji, category] of expectations) {
      const entry = bareEntry({
        name: `No Radius T${tier}`,
        tier,
        radiusEarth: undefined,
        massJup: 1,
      })
      const identity = generatePlanetIdentity(entry)
      expect(identity.visual.emoji, `tier ${tier}`).toBe(emoji)
      expect(identity.description, `tier ${tier}`).toContain(category)
      expect(identity.description, `tier ${tier}`).toContain(`tier-${tier}`)
      expect(makePlanet(entry).tier, `tier ${tier}`).toBe(tier)
    }
  })

  it('NO mass -> density/mass quirks skipped, other quirks still fire, no density adjective', () => {
    const entry = bareEntry({ name: 'No Mass', radiusEarth: 1, massJup: undefined, starType: 'K2' })
    const triggered = quirkIds(entry)
    expect(triggered).toContain('coldStar')
    for (const id of ['highGravity', 'denseCore', 'gasGiant', 'massiveWorld']) {
      expect(triggered, id).not.toContain(id)
    }
    const description = generatePlanetIdentity(entry).description
    expect(description).not.toContain('crushingly dense')
    expect(description).not.toContain('iron-hearted')
    expect(description).not.toContain('thick-crusted')
  })

  it('NO distance -> description omits the distance clause', () => {
    const noDistance = bareEntry({
      name: 'No Distance',
      radiusEarth: 1,
      massJup: 1,
      distancePc: undefined,
    })
    const identity = generatePlanetIdentity(noDistance)
    expect(identity.description).not.toContain(' pc from Sol')
    const withDistance = { ...noDistance, distancePc: 6.3 }
    expect(generatePlanetIdentity(withDistance).description).toContain('6.3 pc from Sol')
  })

  it('ALL FOUR missing -> still generates a complete identity on the zero-quirk path', () => {
    const entry = bareEntry({
      name: 'Bare World',
      tier: 2,
      systemCount: 1,
      starType: undefined,
      radiusEarth: undefined,
      massJup: undefined,
      distancePc: undefined,
    })
    expect(quirkIds(entry)).toEqual([])
    const identity = generatePlanetIdentity(entry)
    expect(identity.quirks).toEqual([])
    expect(identity.visual.surfacePalette.length).toBeGreaterThanOrEqual(3)
    expect(identity.description).toContain('unknown spectral class')
    expect(identity.description).not.toContain(' pc from Sol')
    expect(identity.description.length).toBeGreaterThan(10)
  })
})

describe('P2-T02-C effectiveLevel boundary table', () => {
  it('lands exactly on min(level,10) + max(0,level-10)*0.5 for 0/1/9/10/11/20/100', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [9, 9],
      [10, 10],
      [11, 10.5],
      [20, 15],
      [100, 55],
    ]
    for (const [level, expected] of cases) {
      expect(effectiveLevel(level), `level ${level}`).toBe(expected)
    }
  })

  it('fractional levels throw RangeError — levels are integers, not silently floored (existing policy)', () => {
    expect(() => effectiveLevel(0.5)).toThrow(RangeError)
    expect(() => effectiveLevel(1.5)).toThrow(RangeError)
    expect(() => effectiveLevel(10.1)).toThrow(RangeError)
    expect(() => effectiveLevel(100.999)).toThrow(RangeError)
  })
})

describe('P2-T02-C makePlanet immutability (deep snapshot)', () => {
  it('mutating the returned state leaves the source catalogue entry unchanged (name + nested fields)', () => {
    const source = PLANETS.find(
      (p) =>
        p.radiusEarth !== undefined &&
        p.massJup !== undefined &&
        p.starType !== undefined &&
        p.distancePc !== undefined,
    )
    if (source === undefined) throw new Error('expected a fully-populated catalogue entry')
    const snapshot = JSON.stringify(source)
    const planet = makePlanet(source)
    planet.entry.name = 'MUTATED'
    planet.entry.hostname = 'MUTATED'
    planet.entry.systemCount = 99
    planet.entry.radiusEarth = 123.456
    planet.entry.massJup = 789.012
    planet.entry.starType = 'MUT'
    planet.entry.distancePc = 999.9
    planet.entry.tier = 5
    expect(JSON.stringify(source)).toBe(snapshot)
    expect(PLANETS.includes(source)).toBe(true)
    expect(planet.tier).toBe(5)
  })

  it('each makePlanet call returns an independent snapshot', () => {
    const source = PLANETS[0]
    const a = makePlanet(source)
    const b = makePlanet(source)
    expect(a.entry).toEqual(b.entry)
    expect(a.entry).not.toBe(b.entry)
    a.entry.name = 'ONLY-A'
    expect(b.entry.name).toBe(source.name)
    expect(source.name).not.toBe('ONLY-A')
  })
})

describe('P2-T02-C sim purity covers the new planets modules', () => {
  const PLANETS_MODULES = [
    'generator.ts',
    'types.ts',
    'visual.ts',
    'quirks.ts',
    'description.ts',
    'prng.ts',
    'hash.ts',
    'levels.ts',
    'index.ts',
  ]

  function listSimTs(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) files.push(...listSimTs(full))
      else if (entry.endsWith('.ts')) files.push(full)
    }
    return files.sort()
  }

  it('every src/sim/planets/*.ts module is in the recursive src/sim scan the purity suite runs', () => {
    const scanned = listSimTs(SIM_DIR)
    for (const module of PLANETS_MODULES) {
      expect(scanned, module).toContain(join(SIM_DIR, 'planets', module))
    }
  })

  it('the purity suite iterates every scanned file (it.each over the recursive listing)', () => {
    const puritySource = readFileSync(join(ROOT, 'tests', 'sim-purity.test.ts'), 'utf8')
    expect(puritySource).toContain('readdirSync')
    expect(puritySource).toContain('isDirectory')
    expect(puritySource).toContain('../src/sim')
    expect(puritySource).toMatch(/it\.each\(simFiles\)/)
  })
})
