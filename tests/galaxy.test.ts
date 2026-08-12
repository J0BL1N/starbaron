
/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import { buildSolarSystem } from '../src/ui/planetgen3d/system'
import {
  buildHostStars,
  countHostPositionSources,
} from '../src/ui/planetgen3d/hosts'
import {
  galaxyPositionFor,
  scaleGalaxyPositions,
  solPosition,
  countPositionSources,
  DEFAULT_GALAXY_RADIUS,
} from '../src/ui/planetgen3d/galaxy'

describe('galaxy/galaxyPositionFor', () => {
  it('maps ra=0, dec=0, d=10 to (10,0,0)', () => {
    const p = galaxyPositionFor({
      name: 'Test Origin',
      hostname: 'TestHost',
      systemCount: 1,
      ra: 0,
      dec: 0,
      distancePc: 10,
      tier: 1,
    })
    expect(p.seeded).toBe(false)
    expect(p.x).toBeCloseTo(10, 6)
    expect(p.y).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(0, 6)
  })

  it('maps ra=90, dec=0, d=10 to (0,10,0)', () => {
    const p = galaxyPositionFor({
      name: 'Test Y Axis',
      hostname: 'TestHost',
      systemCount: 1,
      ra: 90,
      dec: 0,
      distancePc: 10,
      tier: 1,
    })
    expect(p.seeded).toBe(false)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(10, 6)
    expect(p.z).toBeCloseTo(0, 6)
  })

  it('maps ra=0, dec=90, d=10 to (0,0,10)', () => {
    const p = galaxyPositionFor({
      name: 'Test Z Axis',
      hostname: 'TestHost',
      systemCount: 1,
      ra: 0,
      dec: 90,
      distancePc: 10,
      tier: 1,
    })
    expect(p.seeded).toBe(false)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(10, 6)
  })

  it('falls back to seeded position when ra is missing', () => {
    const p = galaxyPositionFor({
      name: 'Seeded RA Missing',
      hostname: 'TestHost',
      systemCount: 1,
      dec: 0,
      distancePc: 10,
      tier: 1,
    })
    expect(p.seeded).toBe(true)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(Number.isFinite(p.z)).toBe(true)
  })

  it('falls back to seeded position when dec is missing', () => {
    const p = galaxyPositionFor({
      name: 'Seeded Dec Missing',
      hostname: 'TestHost',
      systemCount: 1,
      ra: 12,
      distancePc: 10,
      tier: 1,
    })
    expect(p.seeded).toBe(true)
  })

  it('falls back to seeded position when distancePc is missing', () => {
    const p = galaxyPositionFor({
      name: 'Seeded Distance Missing',
      hostname: 'TestHost',
      systemCount: 1,
      ra: 12,
      dec: -5,
      tier: 1,
    })
    expect(p.seeded).toBe(true)
  })

  it('seeded fallback is deterministic for the same planet name', () => {
    const entry = {
      name: 'Deterministic Seed Planet',
      hostname: 'TestHost',
      systemCount: 1,
      tier: 3 as const,
    }
    const a = galaxyPositionFor(entry)
    const b = galaxyPositionFor(entry)
    expect(a).toEqual(b)
  })

  it('seeded fallback differs for different planet names', () => {
    const a = galaxyPositionFor({
      name: 'Seed A',
      hostname: 'HostA',
      systemCount: 1,
      tier: 1 as const,
    })
    const b = galaxyPositionFor({
      name: 'Seed B',
      hostname: 'HostB',
      systemCount: 1,
      tier: 1 as const,
    })
    expect(a.x).not.toBe(b.x)
    expect(a.y).not.toBe(b.y)
    expect(a.z).not.toBe(b.z)
  })
})

describe('galaxy/scaleGalaxyPositions', () => {
  it('keeps Sol (0,0,0) at the origin', () => {
    const scaled = scaleGalaxyPositions([solPosition()])
    expect(scaled[0].x).toBe(0)
    expect(scaled[0].y).toBe(0)
    expect(scaled[0].z).toBe(0)
  })

  it('fits all positions inside the target radius', () => {
    const raw = PLANETS.map((entry) => galaxyPositionFor(entry))
    const scaled = scaleGalaxyPositions(raw)
    let maxR = 0
    for (const p of scaled) {
      const r = Math.hypot(p.x, p.y, p.z)
      expect(r).toBeLessThanOrEqual(DEFAULT_GALAXY_RADIUS + 1e-6)
      maxR = Math.max(maxR, r)
    }
    expect(maxR).toBeGreaterThan(0)
    expect(maxR).toBeCloseTo(DEFAULT_GALAXY_RADIUS, 6)
  })

  it('is monotonic in radial distance', () => {
    const raw = [
      { x: 0, y: 0, z: 0, seeded: false },
      { x: 10, y: 0, z: 0, seeded: false },
      { x: 80, y: 0, z: 0, seeded: false },
      { x: 270, y: 0, z: 0, seeded: false },
    ]
    const scaled = scaleGalaxyPositions(raw, 600)
    const radii = scaled.map((p) => Math.hypot(p.x, p.y, p.z))
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1])
    }
  })

  it('keeps far planets visible instead of pushing them to the edge', () => {
    const raw = [
      { x: 1, y: 0, z: 0, seeded: false },
      { x: 1000, y: 0, z: 0, seeded: false },
    ]
    const scaled = scaleGalaxyPositions(raw, 600)
    const near = Math.hypot(scaled[0].x, scaled[0].y, scaled[0].z)
    const far = Math.hypot(scaled[1].x, scaled[1].y, scaled[1].z)
    expect(near).toBeGreaterThan(0)
    expect(far / near).toBeLessThan(20)
  })

  it('is pure: identical input yields identical output', () => {
    const raw = PLANETS.map((entry) => galaxyPositionFor(entry))
    const a = scaleGalaxyPositions(raw)
    const b = scaleGalaxyPositions(raw)
    expect(a).toEqual(b)
  })
})

describe('galaxy/catalogue integration', () => {
  it('every catalogue planet has a finite scaled position', () => {
    const raw = PLANETS.map((entry) => galaxyPositionFor(entry))
    const scaled = scaleGalaxyPositions(raw)
    expect(scaled.length).toBe(PLANETS.length)
    for (const p of scaled) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(Number.isFinite(p.z)).toBe(true)
    }
  })

  it('documents the real-vs-seeded position split', () => {
    const raw = PLANETS.map((entry) => galaxyPositionFor(entry))
    const counts = countPositionSources(raw)
    expect(counts.real + counts.seeded).toBe(PLANETS.length)
    expect(counts.real).toBeGreaterThan(0)
    expect(counts.seeded).toBeGreaterThanOrEqual(0)
  })

  it('buildSolarSystem exposes the same precomputed galaxy positions twice', () => {
    const sys1 = buildSolarSystem('Kepler-452 b', 'Kepler-452 b', {
      surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
      atmosphereTint: '#8ab8ff',
      ringed: false,
      moons: 0,
      emoji: '🌍',
    }, 3, 'earthlike', 'G2 V')
    const sys2 = buildSolarSystem('Kepler-452 b', 'Kepler-452 b', {
      surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
      atmosphereTint: '#8ab8ff',
      ringed: false,
      moons: 0,
      emoji: '🌍',
    }, 3, 'earthlike', 'G2 V')

    expect(sys1.galaxy.planetCount).toBe(PLANETS.length)
    expect(sys2.galaxy.planetCount).toBe(PLANETS.length)
    expect(sys1.galaxy.positions).toBe(sys2.galaxy.positions)
    expect(sys1.galaxy.entries).toBe(sys2.galaxy.entries)
  })
})

describe('galaxy/host stars', () => {
  it('buildSolarSystem exposes host stars and host positions', () => {
    const sys = buildSolarSystem('Kepler-452', 'Kepler-452 b', {
      surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
      atmosphereTint: '#8ab8ff',
      ringed: false,
      moons: 0,
      emoji: '🌍',
    }, 3, 'earthlike', 'G2 V', 'Kepler-452')

    expect(sys.galaxy.hosts.length).toBeGreaterThan(4000)
    expect(sys.galaxy.hostPositions.length).toBe(sys.galaxy.hosts.length * 3)
    expect(sys.galaxy.hosts.every((h) => Number.isFinite(h.representativePosition.x))).toBe(true)
  })

  it('host positions are deterministic across systems', () => {
    const sys1 = buildSolarSystem('Kepler-452', 'Kepler-452 b', {
      surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
      atmosphereTint: '#8ab8ff',
      ringed: false,
      moons: 0,
      emoji: '🌍',
    }, 3, 'earthlike', 'G2 V', 'Kepler-452')
    const sys2 = buildSolarSystem('Kepler-62', 'Kepler-62 e', {
      surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
      atmosphereTint: '#8ab8ff',
      ringed: false,
      moons: 0,
      emoji: '🌍',
    }, 3, 'earthlike', 'G2 V', 'Kepler-62')

    expect(sys1.galaxy.hostPositions).toBe(sys2.galaxy.hostPositions)
    expect(sys1.galaxy.hosts).toBe(sys2.galaxy.hosts)
  })

  it('every host star has a finite scaled representative position', () => {
    const hosts = buildHostStars(PLANETS)
    const counts = countHostPositionSources(hosts)
    expect(counts.count).toBe(hosts.length)
    expect(counts.real + counts.seeded).toBe(hosts.length)
    expect(counts.real).toBeGreaterThan(0)
  })
})

describe('galaxy/visual seeds', () => {
  it('buildSolarSystem exposes deterministic galaxy/universe seeds', () => {
    const sys1 = buildSolarSystem('Kepler-452', 'Kepler-452 b', {
      surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
      atmosphereTint: '#8ab8ff',
      ringed: false,
      moons: 0,
      emoji: '🌍',
    }, 3, 'earthlike', 'G2 V', 'Kepler-452')
    const sys2 = buildSolarSystem('Kepler-452', 'Kepler-452 b', {
      surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
      atmosphereTint: '#8ab8ff',
      ringed: false,
      moons: 0,
      emoji: '🌍',
    }, 3, 'earthlike', 'G2 V', 'Kepler-452')

    expect(sys1.galaxy.backdropSeed).toBe(sys2.galaxy.backdropSeed)
    expect(sys1.universe.seed).toBe(sys2.universe.seed)
  })

  it('different system seeds produce different visual seeds', () => {
    const sys1 = buildSolarSystem('Kepler-452', 'Kepler-452 b', {
      surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
      atmosphereTint: '#8ab8ff',
      ringed: false,
      moons: 0,
      emoji: '🌍',
    }, 3, 'earthlike', 'G2 V', 'Kepler-452')
    const sys2 = buildSolarSystem('Kepler-62', 'Kepler-62 e', {
      surfacePalette: ['#2f6fb0', '#3a8a4a', '#c8d8a0', '#2a5c3a'],
      atmosphereTint: '#8ab8ff',
      ringed: false,
      moons: 0,
      emoji: '🌍',
    }, 3, 'earthlike', 'G2 V', 'Kepler-62')

    expect(sys1.galaxy.backdropSeed).not.toBe(sys2.galaxy.backdropSeed)
    expect(sys1.universe.seed).not.toBe(sys2.universe.seed)
  })
})
