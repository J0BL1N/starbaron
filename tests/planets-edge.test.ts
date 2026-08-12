import { describe, expect, it } from 'vitest'
import { expectTypeOf } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  PLANETS,
  PLANET_SNAPSHOT,
  type PlanetCatalogueEntry,
  type PlanetTier,
} from '../src/sim/data/planets'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SNAPSHOT_PATH = join(ROOT, 'scripts', 'data', 'ps-export-2026-08-10.csv')
const COMMITTED_CSV = readFileSync(SNAPSHOT_PATH, 'utf8')

function parseTierTable(block: string): Array<{ max: number; tier: number }> {
  const out: Array<{ max: number; tier: number }> = []
  const re = /\{\s*max:\s*([^,]+),\s*tier:\s*(\d+)\s*\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    out.push({ max: Number(m[1]), tier: Number(m[2]) })
  }
  return out
}

const scriptSource = readFileSync(join(ROOT, 'scripts', 'import-planets.mjs'), 'utf8')
const radiusBlock = scriptSource.match(/const RADIUS_TIERS\s*=\s*\[[\s\S]*?\]/)?.[0] ?? ''
const massBlock = scriptSource.match(/const MASS_TIERS\s*=\s*\[[\s\S]*?\]/)?.[0] ?? ''
const RADIUS_TIERS = parseTierTable(radiusBlock)
const MASS_TIERS = parseTierTable(massBlock)

function tierForValue(value: number, table: Array<{ max: number; tier: number }>): number {
  for (const { max, tier } of table) {
    if (value < max) return tier
  }
  throw new RangeError(`value ${value} matched no tier`)
}

const TIERS: PlanetTier[] = [1, 2, 3, 4, 5]

describe('P2-T01-C planet dataset integrity', () => {
  it('snapshot sha matches the committed pinned CSV (sha256 of raw bytes)', () => {
    const sha = createHash('sha256').update(COMMITTED_CSV).digest('hex')
    expect(PLANET_SNAPSHOT.sha).toBe(sha)
  })

  it('snapshot metadata lines up with the pinned CSV filename', () => {
    expect(PLANET_SNAPSHOT.fetchedAt).toBe('2026-08-10')
    expect(SNAPSHOT_PATH).toContain(PLANET_SNAPSHOT.fetchedAt)
  })

  it('raw CSV holds 6336 data rows; exactly 15 dropped for lack of tier signal', () => {
    const dataRows = COMMITTED_CSV.split(/\r?\n/).filter((line) => line.trim() !== '').length - 1
    expect(dataRows).toBe(6336)
    expect(dataRows - PLANETS.length).toBe(15)
    expect(PLANET_SNAPSHOT.rows).toBe(PLANETS.length)
    expect(PLANETS.length).toBe(6321)
  })

  it('no row lacks both radius and mass; every tier signal is finite and positive', () => {
    let neither = 0
    for (const row of PLANETS) {
      if (row.radiusEarth === undefined && row.massJup === undefined) neither++
      if (row.radiusEarth !== undefined) {
        expect(Number.isFinite(row.radiusEarth)).toBe(true)
        expect(row.radiusEarth).toBeGreaterThan(0)
      }
      if (row.massJup !== undefined) {
        expect(Number.isFinite(row.massJup)).toBe(true)
        expect(row.massJup).toBeGreaterThan(0)
      }
    }
    expect(neither).toBe(0)
  })

  it('field coverage: radius > mass-only fallback, optional starType/distance genuinely optional', () => {
    const radiusPresent = PLANETS.filter((row) => row.radiusEarth !== undefined).length
    const massPresent = PLANETS.filter((row) => row.massJup !== undefined).length
    const both = PLANETS.filter(
      (row) => row.radiusEarth !== undefined && row.massJup !== undefined,
    ).length
    const massOnly = massPresent - both
    const starKnown = PLANETS.filter((row) => row.starType !== undefined).length
    const distKnown = PLANETS.filter((row) => row.distancePc !== undefined).length
    expect(radiusPresent).toBe(4730)
    expect(massPresent).toBe(3136)
    expect(both).toBe(1545)
    expect(massOnly).toBe(1591)
    expect(starKnown).toBeGreaterThan(0)
    expect(starKnown).toBeLessThan(PLANETS.length)
    expect(distKnown).toBeGreaterThan(0)
    expect(distKnown).toBeLessThan(PLANETS.length)
  })

  it('distance, when present, is finite and positive; systemCount integer >= 1 with multi-star rows', () => {
    let multiStar = 0
    for (const row of PLANETS) {
      expect(Number.isInteger(row.systemCount)).toBe(true)
      expect(row.systemCount).toBeGreaterThanOrEqual(1)
      if (row.systemCount > 1) multiStar++
      if (row.distancePc !== undefined) {
        expect(Number.isFinite(row.distancePc)).toBe(true)
        expect(row.distancePc).toBeGreaterThan(0)
      }
      if (row.starType !== undefined) expect(row.starType.length).toBeGreaterThan(0)
    }
    expect(multiStar).toBeGreaterThan(0)
  })

  it('names are unique, non-empty, and emitted in ascending name order (determinism)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < PLANETS.length; i++) {
      const row = PLANETS[i]
      expect(row.name.length).toBeGreaterThan(0)
      expect(seen.has(row.name)).toBe(false)
      seen.add(row.name)
      expect(row.hostname.length).toBeGreaterThan(0)
      if (i > 0) expect(PLANETS[i - 1].name <= row.name).toBe(true)
    }
  })
})

describe('P2-T01-C tier boundaries — exact threshold semantics', () => {
  it('script tier tables equal the audited half-open literals (radius)', () => {
    expect(RADIUS_TIERS).toEqual([
      { max: 1, tier: 1 },
      { max: 1.6, tier: 2 },
      { max: 2.5, tier: 3 },
      { max: 4, tier: 4 },
      { max: Number.POSITIVE_INFINITY, tier: 5 },
    ])
  })

  it('script tier tables equal the audited half-open literals (mass)', () => {
    expect(MASS_TIERS).toEqual([
      { max: 0.003, tier: 1 },
      { max: 0.012, tier: 2 },
      { max: 0.1, tier: 3 },
      { max: 1, tier: 4 },
      { max: Number.POSITIVE_INFINITY, tier: 5 },
    ])
  })

  it('radius boundaries: 0.999 -> T1, 1.0 -> T2, 1.599 -> T2, 1.6 -> T3, 2.5 -> T4, 3.999 -> T4, 4.0 -> T5', () => {
    const cases: Array<[number, number]> = [
      [0.999, 1],
      [1.0, 2],
      [1.599, 2],
      [1.6, 3],
      [1.999, 3],
      [2.5, 4],
      [3.999, 4],
      [4.0, 5],
      [4.0 + Number.EPSILON, 5],
      [100, 5],
    ]
    for (const [value, expected] of cases) {
      expect(tierForValue(value, RADIUS_TIERS), `radius ${value}`).toBe(expected)
    }
  })

  it('mass boundaries: 0.002999 -> T1, 0.003 -> T2, 0.012 -> T3, 0.1 -> T4, 1.0 -> T5', () => {
    const cases: Array<[number, number]> = [
      [0.002999, 1],
      [0.003, 2],
      [0.011999, 2],
      [0.012, 3],
      [0.0999, 3],
      [0.1, 4],
      [0.9999, 4],
      [1.0, 5],
    ]
    for (const [value, expected] of cases) {
      expect(tierForValue(value, MASS_TIERS), `mass ${value}`).toBe(expected)
    }
  })

  it('every stored row re-derives to its tier from the script-extracted thresholds', () => {
    for (const row of PLANETS) {
      if (row.radiusEarth !== undefined) {
        expect(tierForValue(row.radiusEarth, RADIUS_TIERS), row.name).toBe(row.tier)
      } else {
        expect(tierForValue(row.massJup as number, MASS_TIERS), row.name).toBe(row.tier)
      }
    }
  })

  it('contract strings the negative-path tests rely on exist in the script', () => {
    for (const needle of [
      'row width mismatch',
      'duplicate pl_name',
      'empty CSV — no header row',
      'schema drift',
      'neither radius nor mass',
      'DRIFT',
    ]) {
      expect(scriptSource).toContain(needle)
    }
  })
})

describe('P2-T01-C planet type shape', () => {
  it('PlanetTier is exactly the narrow 1-5 union', () => {
    expectTypeOf<PlanetTier>().toEqualTypeOf<1 | 2 | 3 | 4 | 5>()
  })

  it('PLANETS is a PlanetCatalogueEntry array with optional fields typed as undefined-union', () => {
    expectTypeOf(PLANETS).toMatchTypeOf<PlanetCatalogueEntry[]>()
    expectTypeOf(PLANETS[0].tier).toEqualTypeOf<PlanetTier>()
    expectTypeOf(PLANETS[0].radiusEarth).toEqualTypeOf<number | undefined>()
    expectTypeOf(PLANETS[0].massJup).toEqualTypeOf<number | undefined>()
    expectTypeOf(PLANETS[0].starType).toEqualTypeOf<string | undefined>()
    expectTypeOf(PLANETS[0].distancePc).toEqualTypeOf<number | undefined>()
    expectTypeOf(PLANETS[0].ra).toEqualTypeOf<number | undefined>()
    expectTypeOf(PLANETS[0].dec).toEqualTypeOf<number | undefined>()
    expectTypeOf(PLANETS[0].systemCount).toEqualTypeOf<number>()
  })

  it('PLANET_SNAPSHOT carries the required metadata fields with correct types', () => {
    expectTypeOf(PLANET_SNAPSHOT).toMatchTypeOf<{
      source: string
      query: string
      fetchedAt: string
      rows: number
      sha: string
    }>()
    expect(PLANET_SNAPSHOT.source).toContain('https://')
    expect(PLANET_SNAPSHOT.query).toContain('SELECT')
    expect(PLANET_SNAPSHOT.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(PLANET_SNAPSHOT.rows).toBe(PLANETS.length)
    expect(PLANET_SNAPSHOT.sha).toMatch(/^[0-9a-f]{64}$/)
  })

  it('every row tier is one of the 5 allowed values', () => {
    for (const row of PLANETS) {
      expect(TIERS).toContain(row.tier)
    }
  })
})
