import type { PlanetCatalogueEntry } from '../data/planets'
import type { PlanetQuirk, PlanetVisualProfile } from './types'
import type { RadiusBand } from './visual'
import { spectralLetter } from './visual'
import { densityProxy } from './quirks'

const CATEGORY_WORD: Readonly<Record<string, string>> = {
  rocky: 'rocky world',
  earthlike: 'water world',
  superearth: 'super-Earth',
  gaseous: 'gas giant',
}

const SPECTRAL_ADJECTIVE: Readonly<Record<string, string>> = {
  O: 'blazing blue-white',
  B: 'brilliant blue-white',
  A: 'brilliant white',
  F: 'warm white',
  G: 'warm yellow',
  K: 'orange',
  M: 'dim red',
}
const BAND_ADJECTIVES: Readonly<Record<string, readonly string[]>> = {
  rocky: ['barren', 'crater-scarred', 'iron-cored'],
  earthlike: ['ocean-dappled', 'verdant', 'mist-wreathed'],
  superearth: ['dense', 'ice-capped', 'volatile-rich'],
  gaseous: ['banded', 'storm-wracked', 'hydrogen-hazed'],
}

const DENSITY_ADJECTIVES = [
  'crushingly dense',
  'iron-hearted',
  'thick-crusted',
] as const

const QUIET_LINES = [
  'A quiet world with little to recommend it.',
  'An unremarkable planet, content in its orbit.',
  'Nothing about this world demands attention.',
] as const

export function buildDescription(
  entry: PlanetCatalogueEntry,
  band: RadiusBand,
  visual: PlanetVisualProfile,
  quirks: readonly PlanetQuirk[],
  rand: () => number,
): string {
  const category = CATEGORY_WORD[band]
  const letter = spectralLetter(entry.starType)
  const starClause =
    letter !== null
      ? `orbiting a ${SPECTRAL_ADJECTIVE[letter] ?? 'star'} ${letter}-class star`
      : 'orbiting a star of unknown spectral class'
  const distanceClause =
    entry.distancePc !== undefined
      ? ` ${entry.distancePc.toFixed(1)} pc from Sol`
      : ''
  const identity = `${entry.name} is a tier-${entry.tier} ${category} ${starClause}${distanceClause}.`

  const adjectivePool = BAND_ADJECTIVES[band] ?? BAND_ADJECTIVES.earthlike
  const firstAdjective =
    adjectivePool[Math.floor(rand() * adjectivePool.length)]
  let secondAdjective =
    adjectivePool[Math.floor(rand() * adjectivePool.length)]
  if (secondAdjective === firstAdjective) {
    secondAdjective =
      adjectivePool[(adjectivePool.indexOf(firstAdjective) + 1) % adjectivePool.length]
  }
  const density = densityProxy(entry)
  const densityAdjective =
    density !== null && density >= 0.002
      ? DENSITY_ADJECTIVES[Math.floor(rand() * DENSITY_ADJECTIVES.length)]
      : null
  const physical = densityAdjective
    ? `A ${densityAdjective}, ${firstAdjective} world${visual.atmosphereTint !== null ? ' wrapped in a thin, hazy atmosphere' : ''}.`
    : `A ${firstAdjective}, ${secondAdjective} world.`

  const hook =
    quirks.length > 0
      ? quirks[0].blurb
      : QUIET_LINES[Math.floor(rand() * QUIET_LINES.length)]

  return `${identity} ${physical} ${hook}`
}
