/**
 * Pure star model: spectral class → color, size, glow and corona params.
 * No THREE dependency.
 */

export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'unknown'

export interface StarModel {
  class: SpectralClass
  color: string // hex color for the core
  glowColor: string // hex color for the radial glow
  size: number // relative size (G = 1)
  glowIntensity: number
  coronaSize: number
  coronaColor: string
}

const TABLE: Record<SpectralClass, StarModel> = {
  O: {
    class: 'O',
    color: '#9db4ff',
    glowColor: '#a8c8ff',
    size: 15,
    glowIntensity: 2.5,
    coronaSize: 2.8,
    coronaColor: '#6a9cff',
  },
  B: {
    class: 'B',
    color: '#aabfff',
    glowColor: '#b8d0ff',
    size: 8,
    glowIntensity: 2.0,
    coronaSize: 2.4,
    coronaColor: '#80b0ff',
  },
  A: {
    class: 'A',
    color: '#cad8ff',
    glowColor: '#dbe8ff',
    size: 2.5,
    glowIntensity: 1.6,
    coronaSize: 2.0,
    coronaColor: '#a8c8ff',
  },
  F: {
    class: 'F',
    color: '#f8f7ff',
    glowColor: '#fff4d8',
    size: 1.4,
    glowIntensity: 1.3,
    coronaSize: 1.7,
    coronaColor: '#ffe8a8',
  },
  G: {
    class: 'G',
    color: '#fff4e8',
    glowColor: '#ffdca0',
    size: 1,
    glowIntensity: 1.0,
    coronaSize: 1.5,
    coronaColor: '#ffb454',
  },
  K: {
    class: 'K',
    color: '#ffddb4',
    glowColor: '#ffc078',
    size: 0.8,
    glowIntensity: 0.8,
    coronaSize: 1.3,
    coronaColor: '#ff9a50',
  },
  M: {
    class: 'M',
    color: '#ffbd81',
    glowColor: '#ff9a60',
    size: 0.5,
    glowIntensity: 0.6,
    coronaSize: 1.1,
    coronaColor: '#ff7030',
  },
  unknown: {
    class: 'unknown',
    color: '#e8e8e8',
    glowColor: '#d0d0d0',
    size: 1,
    glowIntensity: 0.9,
    coronaSize: 1.4,
    coronaColor: '#a0a0a0',
  },
}

const CLASSES: readonly string[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M']

export function spectralClassOf(starType?: string | null): SpectralClass {
  if (!starType || starType.trim() === '') return 'unknown'
  const letter = starType.trim().charAt(0).toUpperCase()
  return CLASSES.includes(letter) ? (letter as SpectralClass) : 'unknown'
}

export function starModel(spectral: SpectralClass): StarModel {
  return TABLE[spectral] ?? TABLE.unknown
}

export function starModelFromType(starType?: string | null): StarModel {
  return starModel(spectralClassOf(starType))
}
