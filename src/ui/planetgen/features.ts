import { fnv1a, mulberry32 } from '../../sim/planets'
import type { PlanetVisualProfile } from '../../sim/planets/types'
import type { RadiusBand } from '../../sim/planets/visual'

export type { RadiusBand }

export interface CraterFeature {
  /** Normalised x offset from disc centre (-1..1). */
  x: number
  /** Normalised y offset from disc centre (-1..1). */
  y: number
  /** Normalised radius relative to disc radius. */
  r: number
  /** Shadow depth 0..1. */
  depth: number
}

export interface BandFeature {
  /** Normalised vertical centre on the disc (-1..1). */
  y: number
  /** Normalised height relative to disc radius. */
  height: number
  color: string
  alpha: number
}

export interface BlobFeature {
  /** Normalised x offset from disc centre (-1..1). */
  x: number
  /** Normalised y offset from disc centre (-1..1). */
  y: number
  /** Normalised radius relative to disc radius. */
  r: number
  color: string
}

export interface MoonFeature {
  /** Orbital angle in radians. */
  angle: number
  /** Orbital distance from planet centre in render pixels. */
  distance: number
  /** Moon radius in render pixels. */
  radius: number
  color: string
  /** Seed for the moon's own micro-shading. */
  seed: number
}

export interface StarFeature {
  /** Normalised x position (0..1). */
  x: number
  /** Normalised y position (0..1). */
  y: number
  size: number
  alpha: number
}

export interface PlanetRenderFeatures {
  name: string
  emoji: string
  /** Canonical deterministic seed for this render (documented derivation). */
  seed: number
  /** Canvas internal width in pixels. */
  width: number
  /** Canvas internal height in pixels. */
  height: number
  /** Source tier (affects rendered size). */
  tier: number
  /** CSS display size in pixels. */
  cssSize: number
  /** Supersampling factor (canvas pixels per CSS pixel). */
  supersample: number
  /** Disc centre x in canvas pixels. */
  cx: number
  /** Disc centre y in canvas pixels. */
  cy: number
  /** Planet disc radius in canvas pixels. */
  discRadius: number
  /** Base world colour (palette[0]). */
  baseColor: string
  /** Texture colours (palette[1..3]). */
  textureColors: readonly string[]
  radiusBand: RadiusBand
  /** Light direction in radians; default upper-left with small variation. */
  lightAngle: number
  atmosphere: {
    tint: string | null
    glowRadius: number
    alpha: number
  }
  surface: {
    craters: CraterFeature[]
    bands: BandFeature[]
    blobs: BlobFeature[]
  }
  rings: {
    enabled: boolean
    /** Ring plane tilt in radians. */
    tilt: number
    innerRadius: number
    outerRadius: number
    color: string
    alpha: number
  }
  moons: {
    count: number
    items: MoonFeature[]
  }
  starfield: StarFeature[]
}

/**
 * Documented deterministic seed derivation for the 2D renderer.
 * It never uses Math.random; all randomness is resolved through mulberry32.
 */
function seedForRenderer(planetName: string): number {
  return fnv1a(`${planetName}:2d`)
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!
}

/**
 * Pure function: given a planet's canonical identity data, resolve every
 * render decision into a typed, deterministic feature vector. No DOM, no
 * canvas, no Math.random. This is the determinism contract under test.
 */
export function generatePlanetRenderFeatures(
  planetName: string,
  profile: PlanetVisualProfile,
  tier: number,
  radiusBand: RadiusBand,
): PlanetRenderFeatures {
  if (!planetName || planetName.trim().length === 0) {
    throw new Error('Planet name is required to generate deterministic features')
  }

  const seed = seedForRenderer(planetName)
  const rand = mulberry32(seed)

  const cssSize = 64 + tier * 16
  const supersample = 2
  const width = cssSize * supersample
  const height = cssSize * supersample
  const cx = width / 2
  const cy = height / 2
  const discRadius = cssSize * 0.36 * supersample

  const palette = profile.surfacePalette
  const baseColor = palette[0] ?? '#c0c0c0'
  const textureColors = palette.slice(1, 4)

  // Light from upper-left with a small per-planet twist.
  const lightAngle = -Math.PI / 4 + (rand() - 0.5) * 0.3

  const craters: CraterFeature[] = []
  const bands: BandFeature[] = []
  const blobs: BlobFeature[] = []

  if (radiusBand === 'rocky') {
    const count = 5 + Math.floor(rand() * 7)
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2
      const dist = rand() * 0.78
      craters.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        r: 0.04 + rand() * 0.08,
        depth: 0.25 + rand() * 0.55,
      })
    }
  } else if (radiusBand === 'gaseous') {
    const count = 4 + Math.floor(rand() * 4)
    for (let i = 0; i < count; i++) {
      bands.push({
        y: rand() * 2 - 1,
        height: 0.08 + rand() * 0.14,
        color: pick(textureColors, rand),
        alpha: 0.45 + rand() * 0.45,
      })
    }
  } else if (radiusBand === 'earthlike') {
    const count = 4 + Math.floor(rand() * 5)
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2
      const dist = rand() * 0.6
      blobs.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        r: 0.12 + rand() * 0.22,
        color: textureColors[1] ?? textureColors[0] ?? baseColor,
      })
    }
  } else if (radiusBand === 'superearth') {
    const bandCount = 2 + Math.floor(rand() * 3)
    for (let i = 0; i < bandCount; i++) {
      bands.push({
        y: rand() * 2 - 1,
        height: 0.1 + rand() * 0.16,
        color: pick(textureColors, rand),
        alpha: 0.3 + rand() * 0.3,
      })
    }
    const blobCount = 2 + Math.floor(rand() * 3)
    for (let i = 0; i < blobCount; i++) {
      const angle = rand() * Math.PI * 2
      const dist = rand() * 0.55
      blobs.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        r: 0.1 + rand() * 0.18,
        color: textureColors[1] ?? textureColors[0] ?? baseColor,
      })
    }
  }

  const atmosphereTint = profile.atmosphereTint
  const atmosphere = {
    tint: atmosphereTint,
    glowRadius: discRadius * (1.16 + rand() * 0.08),
    alpha: atmosphereTint ? 0.2 + rand() * 0.2 : 0,
  }

  const rings = profile.ringed
    ? {
        enabled: true as const,
        tilt: 0.22 + rand() * 0.38,
        innerRadius: discRadius * (1.12 + rand() * 0.08),
        outerRadius: discRadius * (1.42 + rand() * 0.22),
        color: textureColors[1] ?? textureColors[0] ?? baseColor,
        alpha: 0.45 + rand() * 0.35,
      }
    : {
        enabled: false as const,
        tilt: 0,
        innerRadius: 0,
        outerRadius: 0,
        color: '',
        alpha: 0,
      }

  const moonCount = Math.max(0, Math.floor(profile.moons))
  const moonItems: MoonFeature[] = []
  for (let i = 0; i < moonCount; i++) {
    moonItems.push({
      angle: rand() * Math.PI * 2,
      distance: discRadius * (1.65 + rand() * 0.85),
      radius: (2 + rand() * 3) * supersample,
      color: textureColors[1] ?? textureColors[0] ?? baseColor,
      seed: Math.floor(rand() * 0xffffffff),
    })
  }

  const starCount = 10 + Math.floor(rand() * 12)
  const starfield: StarFeature[] = []
  for (let i = 0; i < starCount; i++) {
    starfield.push({
      x: rand(),
      y: rand(),
      size: 0.5 + rand() * 1.5,
      alpha: 0.2 + rand() * 0.5,
    })
  }

  return {
    name: planetName,
    emoji: profile.emoji,
    seed,
    tier,
    width,
    height,
    cssSize,
    supersample,
    cx,
    cy,
    discRadius,
    baseColor,
    textureColors,
    radiusBand,
    lightAngle,
    atmosphere,
    surface: { craters, bands, blobs },
    rings,
    moons: { count: moonCount, items: moonItems },
    starfield,
  }
}
