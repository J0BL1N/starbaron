import type { PlanetCatalogueEntry, PlanetTier } from '../data/planets'
import type { StructureId } from '../structures/types'

export interface PlanetState {
  entry: PlanetCatalogueEntry
  tier: PlanetTier
  baselineIncomePerSec: number
  populationCapMultiplier: number
  generate: () => PlanetIdentity
}

export interface PlanetVisualProfile {
  surfacePalette: string[]
  atmosphereTint: string | null
  ringed: boolean
  moons: number
  emoji: string
}

export type QuirkId =
  | 'highGravity'
  | 'coldStar'
  | 'hotStar'
  | 'denseCore'
  | 'gasGiant'
  | 'binarySystem'
  | 'massiveWorld'

export interface PlanetQuirk {
  id: QuirkId
  name: string
  structureId: StructureId
  multiplier: number
  blurb: string
}

export interface PlanetIdentity {
  visual: PlanetVisualProfile
  quirks: PlanetQuirk[]
  description: string
}
