/**
 * Deterministic solar-system assembler.
 * Returns plain data describing the star, planets, moons, rings, asteroid belt,
 * galaxy and universe. No THREE dependency.
 */

import type { PlanetVisualProfile } from '../../sim/planets/types'
import { PLANETS, type PlanetCatalogueEntry } from '../../sim/data/planets'
import type { RadiusBand } from '../../sim/planets/visual'
import {
  generateVisualProfile,
  radiusBandOf,
  resolveRadius,
} from '../../sim/planets'
import { rngFrom } from './random'
import type { OrbitalElements } from './orbits'
import { seededOrbitalElements, seededMoonElements } from './orbits'
import { starModelFromType, type StarModel } from './spectral'
import { scaleGalaxyPositions, galaxyPositionFor } from './galaxy'
import { buildHostStars, type HostStar } from './hosts'

export interface MoonData {
  index: number
  seed: string
  elements: OrbitalElements
}

export interface PlanetData {
  name: string
  seed: string
  radius: number
  band: RadiusBand
  profile: PlanetVisualProfile
  tier: number
  elements: OrbitalElements
  moons: MoonData[]
  textureSize: number
  hasClouds: boolean
  hasAtmosphere: boolean
}

export interface AsteroidData {
  seed: string
  elements: OrbitalElements
}

export interface SolarSystemData {
  seedName: string
  starType: string | undefined
  starModel: StarModel
  starSeed: string
  planets: PlanetData[]
  homePlanetName: string
  asteroidBelt: {
    innerA: number
    outerA: number
    asteroids: AsteroidData[]
  }
  galaxy: {
    planetCount: number
    entries: readonly PlanetCatalogueEntry[]
    positions: Float32Array
    backdropSeed: string
    hosts: HostStar[]
    hostPositions: Float32Array
  }
  universe: {
    count: number
    seed: string
  }
}

const VERSION = 'pg3d-v1'

let cachedGalaxyPositions: Float32Array | null = null
let cachedHostStars: HostStar[] | null = null
let cachedHostPositions: Float32Array | null = null

function allGalaxyPositions(): Float32Array {
  if (cachedGalaxyPositions !== null) {
    return cachedGalaxyPositions
  }
  const raw = PLANETS.map((entry) => galaxyPositionFor(entry))
  const scaled = scaleGalaxyPositions(raw)
  const arr = new Float32Array(scaled.length * 3)
  for (let i = 0; i < scaled.length; i++) {
    const p = scaled[i]
    arr[i * 3] = p.x
    arr[i * 3 + 1] = p.y
    arr[i * 3 + 2] = p.z
  }
  cachedGalaxyPositions = arr
  return arr
}

function allHostStars(): HostStar[] {
  if (cachedHostStars !== null) {
    return cachedHostStars
  }
  cachedHostStars = buildHostStars(PLANETS)
  return cachedHostStars
}

function allHostPositions(): Float32Array {
  if (cachedHostPositions !== null) {
    return cachedHostPositions
  }
  const hosts = allHostStars()
  const arr = new Float32Array(hosts.length * 3)
  for (let i = 0; i < hosts.length; i++) {
    const p = hosts[i].representativePosition
    arr[i * 3] = p.x
    arr[i * 3 + 1] = p.y
    arr[i * 3 + 2] = p.z
  }
  cachedHostPositions = arr
  return arr
}

function systemRng(seedName: string): () => number {
  return rngFrom(`${VERSION}|sys|${seedName}`)
}

function planetSeed(systemSeed: string, name: string): string {
  return `${VERSION}|orb|${name}|${systemSeed}`
}

function syntheticPlanetName(hostName: string, homeName: string, index: number): string {
  const suffixes = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']
  if (index === 0) return homeName
  const suffix = suffixes[index - 1] ?? String.fromCharCode(97 + index)
  return `${hostName} ${suffix}`
}

function syntheticEntry(
  name: string,
  tier: number,
  starType: string | undefined,
  r: () => number,
): PlanetCatalogueEntry {
  const radius = resolveRadius({ name, hostname: name, systemCount: 1, tier } as PlanetCatalogueEntry, r)
  return {
    name,
    hostname: name,
    systemCount: 1,
    radiusEarth: radius,
    starType,
    tier: tier as 1 | 2 | 3 | 4 | 5,
  }
}

function shouldHaveClouds(band: RadiusBand, atmosphereTint: string | null): boolean {
  return (band === 'earthlike' || band === 'superearth') && atmosphereTint !== null
}

function shouldHaveAtmosphere(atmosphereTint: string | null): boolean {
  return atmosphereTint !== null
}

/**
 * Build a deterministic solar system around a home planet.
 *
 * @param seedName Usually the home star name / host name used to seed the whole system.
 * @param homePlanetName The player's current planet name.
 * @param homeProfile Visual profile for the home planet.
 * @param homeTier Tier of the home planet.
 * @param _homeBand Radius band of the home planet (reserved for future size hints).
 * @param starType Optional spectral type string (e.g. "G2 V").
 */
export function buildSolarSystem(
  seedName: string,
  homePlanetName: string,
  homeProfile: PlanetVisualProfile,
  homeTier: number,
  _homeBand: RadiusBand,
  starType?: string,
  hostName?: string,
): SolarSystemData {
  const systemHostName = hostName ?? seedName
  const r = systemRng(seedName)
  const starModel = starModelFromType(starType)

  // Generate 6–10 planets with the home planet at a deterministic slot.
  const planetCount = 6 + Math.floor(r() * 5)
  const homeIndex = Math.floor(r() * planetCount)

  const baseDistances = [5.5, 7.5, 9.5, 12, 17.5, 24, 31, 38, 48, 58].slice(0, planetCount)

  const planets: PlanetData[] = []
  for (let i = 0; i < planetCount; i++) {
    const isHome = i === homeIndex
    const name = isHome
      ? homePlanetName
      : syntheticPlanetName(systemHostName, homePlanetName, i)
    const tier = isHome
      ? homeTier
      : (Math.floor(r() * 5) + 1)
    const entry = syntheticEntry(name, tier, starType, r)
    const profile = isHome
      ? homeProfile
      : generateVisualProfile(entry, r)
    const radius = resolveRadius(entry, r)
    const band = radiusBandOf(radius)
    const a = baseDistances[i] * (0.9 + r() * 0.2)
    const elements = seededOrbitalElements(planetSeed(seedName, name), a)
    const textureSize = isHome ? 1024 : 512

    const moons: MoonData[] = []
    for (let m = 0; m < profile.moons; m++) {
      moons.push({
        index: m,
        seed: `${planetSeed(seedName, name)}|moon|${m}`,
        elements: seededMoonElements(
          planetSeed(seedName, name),
          radius * 0.25,
          m,
        ),
      })
    }

    planets.push({
      name,
      seed: planetSeed(seedName, name),
      radius: radius * 0.2,
      band,
      profile,
      tier,
      elements,
      moons,
      textureSize,
      hasClouds: shouldHaveClouds(band, profile.atmosphereTint),
      hasAtmosphere: shouldHaveAtmosphere(profile.atmosphereTint),
    })
  }

  // Sort by semi-major axis for visual sanity.
  planets.sort((a, b) => a.elements.a - b.elements.a)

  // Asteroid belt between inner rocky/earthlike planets and outer giants.
  const innerPlanets = planets.filter((p) => p.band !== 'gaseous')
  const outerPlanets = planets.filter((p) => p.band === 'gaseous')
  const innerA =
    innerPlanets.length > 0
      ? Math.max(...innerPlanets.map((p) => p.elements.a)) + 2
      : 16
  const outerA =
    outerPlanets.length > 0
      ? Math.min(...outerPlanets.map((p) => p.elements.a)) - 3
      : innerA + 4
  const beltWidth = Math.max(1, outerA - innerA)

  const asteroidCount = 1400
  const asteroids: AsteroidData[] = []
  for (let i = 0; i < asteroidCount; i++) {
    const a = innerA + r() * beltWidth
    const e = r() * 0.1
    const inc = (r() - 0.5) * 0.06
    const node = r() * Math.PI * 2
    const argP = r() * Math.PI * 2
    const period = Math.pow(a, 1.5) * 30
    const phase = r() * Math.PI * 2
    asteroids.push({
      seed: `${VERSION}|ast|${seedName}|${i}`,
      elements: { a, e, inc, node, argP, period, phase, spin: 0, tilt: 0 },
    })
  }

  return {
    seedName,
    starType,
    starModel,
    starSeed: `${VERSION}|star|${seedName}`,
    planets,
    homePlanetName,
    asteroidBelt: {
      innerA,
      outerA,
      asteroids,
    },
    galaxy: {
      planetCount: PLANETS.length,
      entries: PLANETS,
      positions: allGalaxyPositions(),
      backdropSeed: `${VERSION}|galaxy-backdrop|${seedName}`,
      hosts: allHostStars(),
      hostPositions: allHostPositions(),
    },
    universe: {
      count: 900,
      seed: `${VERSION}|universe|${seedName}`,
    },
  }
}

/**
 * Build a deterministic solar system for a host star.
 *
 * If one of the host's catalogue planets is owned, that planet becomes the home
 * planet and uses the supplied visual profile. Otherwise a representative planet
 * is chosen and the rest are generated around it.
 *
 * This keeps the same seeded result for the same host forever.
 */
export function buildSolarSystemForHost(
  host: HostStar,
  ownedPlanetNames: Set<string>,
  getProfile: (entry: PlanetCatalogueEntry) => PlanetVisualProfile,
): SolarSystemData {
  const ownedEntry = host.entries.find((entry) => ownedPlanetNames.has(entry.name))
  const homeEntry = ownedEntry ?? host.entries[0] ?? host.entries[0]
  if (!homeEntry) {
    throw new Error(`Host ${host.hostname} has no catalogue entries`)
  }

  const homeProfile = getProfile(homeEntry)
  return buildSolarSystem(
    host.hostname,
    homeEntry.name,
    homeProfile,
    homeEntry.tier,
    radiusBandOf(resolveRadius(homeEntry, () => 0.5)),
    host.starType,
    host.hostname,
  )
}
