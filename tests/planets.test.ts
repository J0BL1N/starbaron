import { describe, expect, it } from 'vitest'
import {
  PLANETS,
  PLANET_SNAPSHOT,
  type PlanetCatalogueEntry,
  type PlanetTier,
} from '../src/sim/data/planets'

const TIERS: PlanetTier[] = [1, 2, 3, 4, 5]

// Mirror of scripts/import-planets.mjs tier derivation (half-open, radius-first,
// mass fallback). Used to independently re-derive the expected tier per row.
const RADIUS_TIERS = [
  { max: 1.0, tier: 1 },
  { max: 1.6, tier: 2 },
  { max: 2.5, tier: 3 },
  { max: 4.0, tier: 4 },
  { max: Number.POSITIVE_INFINITY, tier: 5 },
] as const

const MASS_TIERS = [
  { max: 0.003, tier: 1 },
  { max: 0.012, tier: 2 },
  { max: 0.1, tier: 3 },
  { max: 1.0, tier: 4 },
  { max: Number.POSITIVE_INFINITY, tier: 5 },
] as const

function tierFromRadius(radius: number): number {
  for (const { max, tier } of RADIUS_TIERS) {
    if (radius < max) return tier
  }
  throw new RangeError(`radius ${radius} matched no tier`)
}

function tierFromMass(mass: number): number {
  for (const { max, tier } of MASS_TIERS) {
    if (mass < max) return tier
  }
  throw new RangeError(`mass ${mass} matched no tier`)
}

function expectedTier(row: PlanetCatalogueEntry): number {
  if (row.radiusEarth !== undefined) return tierFromRadius(row.radiusEarth)
  return tierFromMass(row.massJup as number)
}

describe('P2-T01-B planet catalogue dataset', () => {
  it('is non-empty and exposes its snapshot metadata', () => {
    expect(PLANETS.length).toBeGreaterThan(0)
    expect(PLANET_SNAPSHOT.rows).toBe(PLANETS.length)
    expect(PLANET_SNAPSHOT.source).toContain('exoplanetarchive.ipac.caltech.edu/TAP/sync')
    expect(PLANET_SNAPSHOT.query).toContain('default_flag=1')
    expect(PLANET_SNAPSHOT.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(PLANET_SNAPSHOT.sha).toMatch(/^[0-9a-f]{64}$/)
  })

  it('every row has a valid tier 1-5 and a tier signal (radius or mass)', () => {
    for (const row of PLANETS) {
      expect(TIERS).toContain(row.tier)
      expect(row.radiusEarth !== undefined || row.massJup !== undefined).toBe(true)
    }
  })

  it('every planet name is unique', () => {
    const seen = new Set<string>()
    for (const row of PLANETS) {
      expect(seen.has(row.name)).toBe(false)
      seen.add(row.name)
    }
  })

  it('stored tier matches the radius/mass half-open boundaries for every row', () => {
    for (const row of PLANETS) {
      expect(row.tier, row.name).toBe(expectedTier(row))
    }
  })

  it('radius-first: tier derives from radius when both radius and mass are present', () => {
    const both = PLANETS.filter(
      (row) => row.radiusEarth !== undefined && row.massJup !== undefined,
    )
    expect(both.length).toBeGreaterThan(0)
    for (const row of both) {
      expect(row.tier, row.name).toBe(tierFromRadius(row.radiusEarth as number))
    }
  })

  it('mass fallback: mass-only rows tier from the mirrored mass boundaries', () => {
    const massOnly = PLANETS.filter((row) => row.radiusEarth === undefined)
    expect(massOnly.length).toBeGreaterThan(0)
    for (const row of massOnly) {
      expect(row.massJup, row.name).toBeDefined()
      expect(row.tier, row.name).toBe(tierFromMass(row.massJup as number))
    }
  })

  it('matches the audit-tier mix T1 229 / T2 969 / T3 1681 / T4 1437 / T5 2005', () => {
    const counts = [0, 0, 0, 0, 0]
    for (const row of PLANETS) counts[row.tier - 1]++
    expect(counts).toEqual([229, 969, 1681, 1437, 2005])
  })

  it('keeps numeric fields finite and systemCount a positive integer', () => {
    for (const row of PLANETS) {
      expect(Number.isInteger(row.systemCount)).toBe(true)
      expect(row.systemCount).toBeGreaterThanOrEqual(1)
      if (row.radiusEarth !== undefined) expect(Number.isFinite(row.radiusEarth)).toBe(true)
      if (row.massJup !== undefined) expect(Number.isFinite(row.massJup)).toBe(true)
      if (row.distancePc !== undefined) expect(Number.isFinite(row.distancePc)).toBe(true)
      if (row.starType !== undefined) expect(row.starType.length).toBeGreaterThan(0)
    }
  })

  it('sample rows: tier matches radius/mass boundaries', () => {
    const samples = PLANETS.filter((row) =>
      ['11 Com b', 'Kepler-1513 b', 'K2-223 b', 'TOI-1233.01', 'Gliese 667 Cc'].includes(
        row.name,
      ),
    )
    for (const row of samples) {
      expect(row.tier, row.name).toBe(expectedTier(row))
    }
  })
})
