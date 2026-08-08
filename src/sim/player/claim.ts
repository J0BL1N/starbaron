import { PLANETS } from '../data/planets'
import type { PlanetCatalogueEntry } from '../data/planets'
import { makePlanet } from '../planets'
import { fnv1a } from '../planets/hash'
import { emptyStructureLevels } from './grid'
import { STARTER_POPULATION } from './wallet'
import type { OwnedPlanet, PlayerState, StructureGrid } from './types'

export const CLAIM_SALT = 'starbaron-claim-v1'

const NAME_TO_ENTRY = new Map<string, PlanetCatalogueEntry>(
  PLANETS.map((entry) => [entry.name, entry]),
)

export function catalogueEntryByName(name: string): PlanetCatalogueEntry | null {
  return NAME_TO_ENTRY.get(name) ?? null
}

export function claimIndexForPlayer(playerId: string): number {
  if (typeof playerId !== 'string' || playerId.length === 0) {
    throw new RangeError(
      `playerId must be a non-empty string, got ${String(playerId)}`,
    )
  }
  return fnv1a(`${CLAIM_SALT}|${playerId}`) % PLANETS.length
}

function buildOwnedPlanet(
  entry: PlanetCatalogueEntry,
  now: number,
  isHome: boolean,
): OwnedPlanet {
  const planet = makePlanet(entry)
  return {
    name: entry.name,
    entry: structuredClone(entry),
    tier: entry.tier,
    baselineIncomePerSec: planet.baselineIncomePerSec,
    populationCapMultiplier: planet.populationCapMultiplier,
    claimedAt: now,
    isHome,
    unconquerable: isHome,
    population: isHome ? STARTER_POPULATION : 0,
    garrison: 0,
    fleet: 0,
  }
}

export function claimHomePlanet(
  playerId: string,
  now: number = Date.now(),
): OwnedPlanet {
  return buildOwnedPlanet(PLANETS[claimIndexForPlayer(playerId)], now, true)
}

export function claimColony(entry: PlanetCatalogueEntry, now: number): OwnedPlanet {
  return buildOwnedPlanet(entry, now, false)
}

export function ownedNames(player: PlayerState): Set<string> {
  const names = new Set<string>([player.homePlanet.name])
  for (const colony of player.colonies) {
    names.add(colony.name)
  }
  return names
}

export function ownedPlanetByName(
  player: PlayerState,
  name: string,
): OwnedPlanet | null {
  if (player.homePlanet.name === name) {
    return player.homePlanet
  }
  return player.colonies.find((colony) => colony.name === name) ?? null
}

export function unclaimedPlanets(player: PlayerState): PlanetCatalogueEntry[] {
  const owned = ownedNames(player)
  return PLANETS.filter((entry) => !owned.has(entry.name))
}

export function firstUnclaimedByIndex(
  player: PlayerState,
): PlanetCatalogueEntry | null {
  const owned = ownedNames(player)
  for (const entry of PLANETS) {
    if (!owned.has(entry.name)) {
      return entry
    }
  }
  return null
}

export function colonise(player: PlayerState, name: string, now: number): PlayerState {
  if (ownedNames(player).has(name)) {
    throw new RangeError(`planet already claimed: ${name}`)
  }
  const entry = catalogueEntryByName(name)
  if (entry === null) {
    throw new RangeError(`unknown planet: ${name}`)
  }
  const colony = claimColony(entry, now)
  return {
    ...player,
    colonies: [...player.colonies, colony],
    structureLevels: {
      ...player.structureLevels,
      [colony.name]: emptyStructureLevels(),
    },
  }
}

export function coloniseFirstUnclaimed(
  player: PlayerState,
  now: number,
): { player: PlayerState; colony: OwnedPlanet } {
  const entry = firstUnclaimedByIndex(player)
  if (entry === null) {
    throw new RangeError('no unclaimed planets remain in the catalogue')
  }
  const colony = claimColony(entry, now)
  return {
    player: {
      ...player,
      colonies: [...player.colonies, colony],
      structureLevels: {
        ...player.structureLevels,
        [colony.name]: emptyStructureLevels() as StructureGrid,
      },
    },
    colony,
  }
}
