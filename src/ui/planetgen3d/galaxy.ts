/**
 * Pure galaxy-position module.
 *
 * Converts real catalogue coordinates (RA/Dec/distance) into a right-handed
 * cartesian frame where Sol sits at the origin and the view radius is ~600
 * units. Missing coordinates get a stable seeded fallback so every planet still
 * has a deterministic place in the scene graph.
 */

import type { PlanetCatalogueEntry } from '../../sim/data/planets'
import { rngFrom } from './random'

/** Output radius of the galaxy view (world units). */
export const DEFAULT_GALAXY_RADIUS = 600

/** Outer-bound used for seeded synthetic positions (parsecs). */
const SYNTHETIC_DISTANCE_MAX_PC = 6000

export interface GalaxyPosition {
  x: number
  y: number
  z: number
  seeded: boolean
}

/**
 * Equatorial (RA/Dec/distance) -> right-handed cartesian, degrees in, pc out.
 * Frame: x = d cos(dec) cos(ra), y = d cos(dec) sin(ra), z = d sin(dec).
 * If any of ra/dec/distancePc are missing, returns a stable seeded position
 * flagged with `seeded: true`.
 */
export function galaxyPositionFor(entry: PlanetCatalogueEntry): GalaxyPosition {
  if (
    entry.ra !== undefined &&
    entry.dec !== undefined &&
    entry.distancePc !== undefined
  ) {
    const ra = (entry.ra * Math.PI) / 180
    const dec = (entry.dec * Math.PI) / 180
    const d = entry.distancePc
    const cosDec = Math.cos(dec)
    return {
      x: d * cosDec * Math.cos(ra),
      y: d * cosDec * Math.sin(ra),
      z: d * Math.sin(dec),
      seeded: false,
    }
  }

  const r = rngFrom(`pg3d-v1|galpos|${entry.name}`)
  const theta = r() * Math.PI * 2
  const phi = Math.acos(2 * r() - 1)
  const d = r() * SYNTHETIC_DISTANCE_MAX_PC
  return {
    x: d * Math.sin(phi) * Math.cos(theta),
    y: d * Math.sin(phi) * Math.sin(theta),
    z: d * Math.cos(phi),
    seeded: true,
  }
}

/**
 * Compress radial distances with a cube-root mapping so nearby exoplanets stay
 * visible while the most distant catalogue entries still fit inside the view.
 *
 * For a position at Euclidean distance d:
 *   d' = targetRadius * cbrt(d / dMax)
 * The direction vector is preserved exactly.
 *
 * @param positions Parsec-scale positions from {@link galaxyPositionFor}.
 * @param targetRadius Desired radius of the galaxy view (default 600).
 */
export function scaleGalaxyPositions(
  positions: GalaxyPosition[],
  targetRadius = DEFAULT_GALAXY_RADIUS,
): GalaxyPosition[] {
  const dMax = Math.max(
    0,
    ...positions.map((p) => Math.hypot(p.x, p.y, p.z)),
  )
  if (dMax <= 0) {
    return positions.map((p) => ({ ...p }))
  }
  const factor = targetRadius / Math.cbrt(dMax)
  return positions.map((p) => {
    const d = Math.hypot(p.x, p.y, p.z)
    if (d === 0) {
      return { ...p }
    }
    const scale = (factor * Math.cbrt(d)) / d
    return {
      x: p.x * scale,
      y: p.y * scale,
      z: p.z * scale,
      seeded: p.seeded,
    }
  })
}

/** Sol / Earth position at the centre of the galaxy view. */
export function solPosition(): GalaxyPosition {
  return { x: 0, y: 0, z: 0, seeded: false }
}

/** Count how many positions are real vs seeded. */
export function countPositionSources(
  positions: GalaxyPosition[],
): { real: number; seeded: number } {
  let real = 0
  let seeded = 0
  for (const p of positions) {
    if (p.seeded) seeded++
    else real++
  }
  return { real, seeded }
}
