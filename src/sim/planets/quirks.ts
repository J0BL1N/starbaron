import type { PlanetCatalogueEntry } from '../data/planets'
import type { StructureEffect, StructureId } from '../structures/types'
import type { PlanetQuirk, QuirkId } from './types'
import { spectralLetter } from './visual'

export const HIGH_GRAVITY_DENSITY_THRESHOLD = 0.005
export const DENSE_CORE_DENSITY_THRESHOLD = 0.002
export const GAS_GIANT_DENSITY_MAX = 0.0007
export const MASSIVE_WORLD_MASS_MIN = 3.0

export interface QuirkDefinition {
  id: QuirkId
  name: string
  structureId: StructureId
  multiplier: number
  blurb: string
}

export const QUIRK_TABLE: readonly QuirkDefinition[] = [
  {
    id: 'highGravity',
    name: 'High Gravity',
    structureId: 'oreMine',
    multiplier: 1.2,
    blurb: 'Its crushing gravity makes ore extraction 20% more efficient.',
  },
  {
    id: 'coldStar',
    name: 'Cold Star',
    structureId: 'hydroponics',
    multiplier: 0.9,
    blurb: 'The dim, cold star slows population growth by 10%.',
  },
  {
    id: 'hotStar',
    name: 'Hot Star',
    structureId: 'hydroponics',
    multiplier: 1.1,
    blurb: 'Intense stellar radiation spurs population growth by 10%.',
  },
  {
    id: 'denseCore',
    name: 'Dense Core',
    structureId: 'housing',
    multiplier: 1.1,
    blurb: 'Its dense, heavy core supports 10% more housing capacity.',
  },
  {
    id: 'gasGiant',
    name: 'Gas Giant',
    structureId: 'shipyard',
    multiplier: 1.1,
    blurb: 'Vast skies host a shipyard that fields 10% more fleet.',
  },
  {
    id: 'binarySystem',
    name: 'Binary System',
    structureId: 'tradeHub',
    multiplier: 1.1,
    blurb: 'Twin stars drive trade, adding 10% to income.',
  },
  {
    id: 'massiveWorld',
    name: 'Massive World',
    structureId: 'defenseTurret',
    multiplier: 1.1,
    blurb: 'Its immense mass anchors defenses, adding 10% defense power.',
  },
]

const QUIRK_BY_ID = new Map(QUIRK_TABLE.map((q) => [q.id, q]))

export function quirkById(id: QuirkId): PlanetQuirk {
  const quirk = QUIRK_BY_ID.get(id)
  if (quirk === undefined) {
    throw new RangeError(`unknown quirk id, got ${String(id)}`)
  }
  return { ...quirk }
}

export function densityProxy(entry: PlanetCatalogueEntry): number | null {
  if (entry.radiusEarth === undefined || entry.massJup === undefined) return null
  return entry.massJup / Math.pow(entry.radiusEarth, 3)
}

export function triggeredQuirks(entry: PlanetCatalogueEntry): PlanetQuirk[] {
  const density = densityProxy(entry)
  const letter = spectralLetter(entry.starType)
  const triggered: PlanetQuirk[] = []

  if (density !== null && density >= HIGH_GRAVITY_DENSITY_THRESHOLD) {
    triggered.push(quirkById('highGravity'))
  }
  if (letter === 'K' || letter === 'M') {
    triggered.push(quirkById('coldStar'))
  }
  if (letter === 'O' || letter === 'B' || letter === 'A') {
    triggered.push(quirkById('hotStar'))
  }
  if (density !== null && density >= DENSE_CORE_DENSITY_THRESHOLD) {
    triggered.push(quirkById('denseCore'))
  }
  if (entry.tier === 5 && density !== null && density < GAS_GIANT_DENSITY_MAX) {
    triggered.push(quirkById('gasGiant'))
  }
  if (entry.systemCount >= 2) {
    triggered.push(quirkById('binarySystem'))
  }
  if (entry.massJup !== undefined && entry.massJup >= MASSIVE_WORLD_MASS_MIN) {
    triggered.push(quirkById('massiveWorld'))
  }

  return triggered
}

export function pickQuirk(entry: PlanetCatalogueEntry, rand: () => number): PlanetQuirk[] {
  const candidates = triggeredQuirks(entry)
  if (candidates.length === 0) return []
  const chosen = candidates[Math.floor(rand() * candidates.length)]
  return [chosen]
}

export function applyQuirk(quirk: PlanetQuirk, effect: StructureEffect): StructureEffect {
  switch (quirk.id) {
    case 'highGravity':
      return effect.kind === 'alloys'
        ? { ...effect, alloysPerSec: effect.alloysPerSec * quirk.multiplier }
        : effect
    case 'coldStar':
    case 'hotStar':
      return effect.kind === 'growthMultiplier'
        ? { ...effect, multiplier: effect.multiplier * quirk.multiplier }
        : effect
    case 'denseCore':
      return effect.kind === 'population'
        ? { ...effect, popCapBonus: effect.popCapBonus * quirk.multiplier }
        : effect
    case 'gasGiant':
      return effect.kind === 'shipyard'
        ? { ...effect, fleetCap: effect.fleetCap * quirk.multiplier }
        : effect
    case 'binarySystem':
      return effect.kind === 'incomeMultiplier'
        ? { ...effect, multiplier: effect.multiplier * quirk.multiplier }
        : effect
    case 'massiveWorld':
      return effect.kind === 'defense'
        ? { ...effect, defensePower: effect.defensePower * quirk.multiplier }
        : effect
  }
}
