/**
 * Star-first galaxy catalogue: group the 6,321 catalogue planets by host star.
 *
 * Pure module — no THREE dependency, no Math.random, no side effects.
 * Determinism: representative positions use real RA/Dec/distance when available;
 * otherwise they fall back to the deterministic galaxyPositionFor seeded from the
 * hostname so the same host always appears at the same place.
 */

import type { PlanetCatalogueEntry } from '../../sim/data/planets'
import { galaxyPositionFor, type GalaxyPosition } from './galaxy'

export interface HostStar {
  /** Host star name (matches catalogue `hostname`). */
  hostname: string
  /** Spectral type of the host, if known. */
  starType: string | undefined
  /** All catalogue planets orbiting this host. */
  entries: PlanetCatalogueEntry[]
  /** Position used for the galaxy dot (first entry with coords, or seeded fallback). */
  representativePosition: GalaxyPosition
  /** How many catalogue planets orbit this host. */
  planetCount: number
  /** Highest planet tier in the system — used to colour the host dot. */
  bestTier: number
}

function emptyHost(hostname: string): HostStar {
  return {
    hostname,
    starType: undefined,
    entries: [],
    representativePosition: { x: 0, y: 0, z: 0, seeded: true },
    planetCount: 0,
    bestTier: 1,
  }
}

function representativePosition(entries: PlanetCatalogueEntry[]): GalaxyPosition {
  for (const entry of entries) {
    if (
      entry.ra !== undefined &&
      entry.dec !== undefined &&
      entry.distancePc !== undefined
    ) {
      return galaxyPositionFor(entry)
    }
  }
  // No coordinates in any entry: derive a stable seeded position from the host name.
  // We synthesise a minimal entry so galaxyPositionFor falls back to its seeded path.
  const host = entries[0]?.hostname ?? 'unknown'
  return galaxyPositionFor({ name: `host-fallback|${host}`, hostname: host, systemCount: entries.length, tier: 1 })
}

/**
 * Group every catalogue planet by `hostname`.
 *
 * @returns An array of host stars. Order is deterministic but not sorted.
 */
export function buildHostStars(planets: readonly PlanetCatalogueEntry[]): HostStar[] {
  const map = new Map<string, HostStar>()
  for (const entry of planets) {
    let host = map.get(entry.hostname)
    if (!host) {
      host = emptyHost(entry.hostname)
      map.set(entry.hostname, host)
    }
    host.entries.push(entry)
    host.planetCount++
    if (entry.starType !== undefined && host.starType === undefined) {
      host.starType = entry.starType
    }
    if (entry.tier > host.bestTier) {
      host.bestTier = entry.tier
    }
  }

  for (const host of map.values()) {
    host.representativePosition = representativePosition(host.entries)
  }

  return Array.from(map.values())
}

/**
 * Return the host star for a given planet name, or undefined if the planet is not
 * in the catalogue (e.g. Sol/Earth).
 */
export function hostByPlanetName(
  hosts: readonly HostStar[],
  planetName: string,
): HostStar | undefined {
  return hosts.find((host) => host.entries.some((entry) => entry.name === planetName))
}

/**
 * Return the host star for a given hostname, or undefined.
 */
export function hostByName(
  hosts: readonly HostStar[],
  hostname: string,
): HostStar | undefined {
  return hosts.find((host) => host.hostname === hostname)
}

/** Count host stars and split real vs seeded representative positions. */
export function countHostPositionSources(
  hosts: readonly HostStar[],
): { count: number; real: number; seeded: number } {
  let real = 0
  let seeded = 0
  for (const host of hosts) {
    if (host.representativePosition.seeded) seeded++
    else real++
  }
  return { count: hosts.length, real, seeded }
}
