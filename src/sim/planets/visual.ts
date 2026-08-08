import type { PlanetCatalogueEntry } from '../data/planets'
import type { PlanetVisualProfile } from './types'

export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'unknown'
export type RadiusBand = 'rocky' | 'earthlike' | 'superearth' | 'gaseous'

export const SPECTRAL_CLASSES = ['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const

const DEFAULT_RADIUS_BAND: Readonly<Record<number, readonly [number, number]>> = {
  1: [0.2, 1.0],
  2: [1.0, 1.6],
  3: [1.6, 2.5],
  4: [2.5, 4.0],
  5: [4.0, 8.0],
}

const SPECTRAL_HUES: Readonly<Record<SpectralClass, readonly string[]>> = {
  O: ['#cfe0ff', '#bfd4ff', '#a8c4ff'],
  B: ['#d6e6ff', '#c8dcff', '#b0ccff'],
  A: ['#e8f0ff', '#dce8ff', '#ccd9ff'],
  F: ['#fff8e0', '#f8efd0', '#f0e8c8'],
  G: ['#fff4c8', '#ffe8a8', '#fce08c'],
  K: ['#ffdfa0', '#ffd078', '#f8c060'],
  M: ['#ffc4a0', '#ffb080', '#f89a60'],
  unknown: ['#e0e0e0', '#d0d0d0', '#c0c0c0'],
}

const TEXTURE_ARCHETYPES: Readonly<
  Record<RadiusBand, readonly (readonly string[])[]>
> = {
  rocky: [
    ['#8a6a4a', '#6b5138', '#4a3a2a'],
    ['#96806a', '#7a654f', '#554536'],
  ],
  earthlike: [
    ['#2f6fb0', '#3a8a4a', '#c8d8a0'],
    ['#3a7fc0', '#4a9a5a', '#d0e0a8'],
  ],
  superearth: [
    ['#2a8a9e', '#1e6a86', '#7aa8b8'],
    ['#3593a8', '#2a7a92', '#8ab8c8'],
  ],
  gaseous: [
    ['#c9a86a', '#e0c9a0', '#a9855a'],
    ['#a8b0d0', '#d0d4e8', '#8a94b8'],
  ],
}

const HAZE_TINTS = ['#ffd9a0', '#ffe0b0', '#d8c8ff'] as const
const FAINT_TINTS = ['#f2e8d0', '#dce4f0'] as const

const EMOJI_BY_BAND: Readonly<Record<RadiusBand, string>> = {
  rocky: '🪨',
  earthlike: '🌍',
  superearth: '🌊',
  gaseous: '🪐',
}

export function spectralClassOf(starType?: string): SpectralClass {
  if (starType === undefined || starType.trim() === '') return 'unknown'
  const letter = starType.trim().charAt(0).toUpperCase()
  return (SPECTRAL_CLASSES as readonly string[]).includes(letter)
    ? (letter as SpectralClass)
    : 'unknown'
}

export function spectralLetter(starType?: string): string | null {
  if (starType === undefined || starType.trim() === '') return null
  const letter = starType.trim().charAt(0).toUpperCase()
  return (SPECTRAL_CLASSES as readonly string[]).includes(letter) ? letter : null
}

export function isHotStar(starType?: string): boolean {
  const letter = spectralLetter(starType)
  return letter === 'O' || letter === 'B' || letter === 'A'
}

export function radiusBandOf(radiusEarth?: number): RadiusBand {
  if (radiusEarth === undefined) return 'earthlike'
  if (radiusEarth < 1.6) return 'rocky'
  if (radiusEarth < 2.5) return 'earthlike'
  if (radiusEarth < 4.0) return 'superearth'
  return 'gaseous'
}

export function defaultRadiusForTier(tier: number, rand: () => number): number {
  const [min, max] = DEFAULT_RADIUS_BAND[tier] ?? DEFAULT_RADIUS_BAND[3]
  return min + (max - min) * rand()
}

export function resolveRadius(entry: PlanetCatalogueEntry, rand: () => number): number {
  return entry.radiusEarth ?? defaultRadiusForTier(entry.tier, rand)
}

export function generateVisualProfile(
  entry: PlanetCatalogueEntry,
  rand: () => number,
  radius?: number,
): PlanetVisualProfile {
  const spectral = spectralClassOf(entry.starType)
  const resolvedRadius = radius ?? resolveRadius(entry, rand)
  const band = radiusBandOf(resolvedRadius)

  const hueOptions = SPECTRAL_HUES[spectral]
  const primary = hueOptions[Math.floor(rand() * hueOptions.length)]
  const textureOptions = TEXTURE_ARCHETYPES[band]
  const texture = textureOptions[Math.floor(rand() * textureOptions.length)]

  const ringChance = ringChanceFor(entry.tier, band)
  const ringed = rand() < ringChance
  const moons = Math.floor(rand() * rand() * (maxMoonsFor(entry.tier) + 1))

  const atmosphereTint = atmosphereTintFor(spectral, rand)

  return {
    surfacePalette: [primary, ...texture],
    atmosphereTint,
    ringed,
    moons,
    emoji: EMOJI_BY_BAND[band],
  }
}

function ringChanceFor(tier: number, band: RadiusBand): number {
  let chance = tier >= 4 ? 0.25 : tier === 3 ? 0.12 : 0.06
  if (band === 'gaseous') chance += 0.1
  return Math.min(0.9, chance)
}

function maxMoonsFor(tier: number): number {
  if (tier >= 5) return 10
  if (tier === 4) return 6
  if (tier === 3) return 4
  if (tier === 2) return 2
  return 1
}

function atmosphereTintFor(
  spectral: SpectralClass,
  rand: () => number,
): string | null {
  if (spectral === 'O' || spectral === 'B' || spectral === 'A') {
    return HAZE_TINTS[Math.floor(rand() * HAZE_TINTS.length)]
  }
  if (spectral === 'F' || spectral === 'G') {
    return rand() < 0.25
      ? FAINT_TINTS[Math.floor(rand() * FAINT_TINTS.length)]
      : null
  }
  return null
}
