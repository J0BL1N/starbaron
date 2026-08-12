import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import {
  buildHostStars,
  hostByPlanetName,
  hostByName,
  countHostPositionSources,
} from '../src/ui/planetgen3d/hosts'
import { buildSolarSystemForHost } from '../src/ui/planetgen3d/system'
import { generatePlanetIdentity } from '../src/sim/planets'

describe('hosts/buildHostStars', () => {
  it('groups every catalogue planet into exactly one host', () => {
    const hosts = buildHostStars(PLANETS)
    const assigned = hosts.reduce((sum, host) => sum + host.entries.length, 0)
    expect(assigned).toBe(PLANETS.length)
  })

  it('produces thousands of host stars for the 6,321-planet catalogue', () => {
    const hosts = buildHostStars(PLANETS)
    // Real catalogue yields ~4,746 hosts; this test just asserts a sane collapse.
    expect(hosts.length).toBeGreaterThan(4000)
    expect(hosts.length).toBeLessThan(PLANETS.length)
  })


  it('gives each host a deterministic representative position', () => {
    const hosts = buildHostStars(PLANETS)
    for (const host of hosts) {
      expect(Number.isFinite(host.representativePosition.x)).toBe(true)
      expect(Number.isFinite(host.representativePosition.y)).toBe(true)
      expect(Number.isFinite(host.representativePosition.z)).toBe(true)
    }
  })

  it('uses the first entry with coordinates as the representative position', () => {
    const hosts = buildHostStars([
      {
        name: 'Test b',
        hostname: 'TestHost',
        systemCount: 2,
        tier: 2,
      },
      {
        name: 'Test c',
        hostname: 'TestHost',
        systemCount: 2,
        ra: 12,
        dec: 34,
        distancePc: 56,
        tier: 3,
      },
    ])
    expect(hosts).toHaveLength(1)
    expect(hosts[0].representativePosition.seeded).toBe(false)
    expect(hosts[0].planetCount).toBe(2)
    expect(hosts[0].bestTier).toBe(3)
  })

  it('falls back to a seeded position when no entry has coordinates', () => {
    const hosts = buildHostStars([
      {
        name: 'NoCoord b',
        hostname: 'NoCoordHost',
        systemCount: 1,
        tier: 4,
      },
    ])
    expect(hosts).toHaveLength(1)
    expect(hosts[0].representativePosition.seeded).toBe(true)
    expect(Number.isFinite(hosts[0].representativePosition.x)).toBe(true)
  })

  it('is deterministic: same catalogue always yields the same hosts', () => {
    const a = buildHostStars(PLANETS)
    const b = buildHostStars(PLANETS)
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      expect(a[i].hostname).toBe(b[i].hostname)
      expect(a[i].planetCount).toBe(b[i].planetCount)
      expect(a[i].representativePosition).toEqual(b[i].representativePosition)
      expect(a[i].bestTier).toBe(b[i].bestTier)
    }
  })

  it('records the best planet tier per host', () => {
    const hosts = buildHostStars([
      { name: 'Multi b', hostname: 'MultiHost', systemCount: 3, tier: 1 },
      { name: 'Multi c', hostname: 'MultiHost', systemCount: 3, tier: 5 },
      { name: 'Multi d', hostname: 'MultiHost', systemCount: 3, tier: 3 },
    ])
    expect(hosts[0].bestTier).toBe(5)
  })

  it('propagates star type from entries to the host', () => {
    const hosts = buildHostStars([
      {
        name: 'Type b',
        hostname: 'TypeHost',
        systemCount: 1,
        starType: 'G2 V',
        tier: 3,
      },
    ])
    expect(hosts[0].starType).toBe('G2 V')
  })
})

describe('hosts/hostByPlanetName', () => {
  it('finds the host for a known planet', () => {
    const hosts = buildHostStars(PLANETS)
    const host = hostByPlanetName(hosts, 'Kepler-452 b')
    expect(host).toBeDefined()
    expect(host!.hostname).toBe('Kepler-452')
    expect(host!.entries.some((e) => e.name === 'Kepler-452 b')).toBe(true)
  })

  it('returns undefined for an unknown planet', () => {
    const hosts = buildHostStars(PLANETS)
    expect(hostByPlanetName(hosts, 'NotARealPlanet')).toBeUndefined()
  })
})

describe('hosts/hostByName', () => {
  it('finds a host by hostname', () => {
    const hosts = buildHostStars(PLANETS)
    const host = hostByName(hosts, 'TRAPPIST-1')
    expect(host).toBeDefined()
    expect(host!.entries.length).toBeGreaterThan(0)
  })
})

describe('hosts/countHostPositionSources', () => {
  it('counts real and seeded host positions', () => {
    const hosts = buildHostStars(PLANETS)
    const counts = countHostPositionSources(hosts)
    expect(counts.count).toBe(hosts.length)
    expect(counts.real + counts.seeded).toBe(hosts.length)
    expect(counts.real).toBeGreaterThan(0)
  })
})

describe('hosts/buildSolarSystemForHost integration', () => {
  it('builds a seeded system for a real host without throwing', () => {
    const hosts = buildHostStars(PLANETS)
    const host = hostByName(hosts, 'Kepler-452')!
    const system = buildSolarSystemForHost(host, new Set(), (entry) =>
      generatePlanetIdentity(entry).visual,
    )
    expect(system.seedName).toBe('Kepler-452')
    expect(system.starType).toBe(host.starType)
    expect(system.planets.length).toBeGreaterThanOrEqual(6)
    expect(system.planets.length).toBeLessThanOrEqual(10)
  })

  it('uses the owned planet as home when present', () => {
    const hosts = buildHostStars(PLANETS)
    const host = hostByName(hosts, 'TRAPPIST-1')!
    const ownedName = host.entries[2].name
    const system = buildSolarSystemForHost(host, new Set([ownedName]), (entry) =>
      generatePlanetIdentity(entry).visual,
    )
    expect(system.homePlanetName).toBe(ownedName)
  })

  it('is deterministic for the same host', () => {
    const hosts = buildHostStars(PLANETS)
    const host = hostByName(hosts, 'Kepler-62')!
    const a = buildSolarSystemForHost(host, new Set(), (entry) =>
      generatePlanetIdentity(entry).visual,
    )
    const b = buildSolarSystemForHost(host, new Set(), (entry) =>
      generatePlanetIdentity(entry).visual,
    )
    expect(a.planets.map((p) => p.name)).toEqual(b.planets.map((p) => p.name))
    expect(a.planets.map((p) => p.tier)).toEqual(b.planets.map((p) => p.tier))
    expect(a.asteroidBelt.innerA).toBeCloseTo(b.asteroidBelt.innerA, 6)
  })
})
