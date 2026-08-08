import type { PlanetCatalogueEntry, PlanetTier } from '../data/planets'
import type { StructureId } from '../structures/types'

export interface WalletState {
  credits: number
  alloys: number
}

export interface OwnedPlanet {
  name: string
  entry: PlanetCatalogueEntry
  tier: PlanetTier
  baselineIncomePerSec: number
  populationCapMultiplier: number
  claimedAt: number
  isHome: boolean
  unconquerable: boolean
  population: number
  garrison: number
  fleet: number
}

export type StructureGrid = Record<StructureId, number>

export interface PlayerState {
  playerId: string
  homePlanet: OwnedPlanet
  colonies: OwnedPlanet[]
  wallet: WalletState
  structureLevels: Record<string, StructureGrid>
  lastTickAt: number
}
