import { makePlanet } from '../planets'
import type { PlanetIdentity } from '../planets/types'
import { claimHomePlanet } from './claim'
import { STARTER_STRUCTURES } from './grid'
import { startWallet } from './wallet'
import type { OwnedPlanet, PlayerState } from './types'

/**
 * generatePlayerId lives at the boundary (src/boundary/id.ts) and is NOT
 * re-exported here: the sim layer never calls it and never depends on it.
 * The UI boundary imports it directly (see src/ui/useGameState.ts).
 */

export function createPlayer(playerId: string, now: number): PlayerState {
  const homePlanet = claimHomePlanet(playerId, now)
  return {
    playerId,
    homePlanet,
    colonies: [],
    wallet: startWallet(),
    structureLevels: { [homePlanet.name]: { ...STARTER_STRUCTURES } },
    lastTickAt: now,
  }
}

export function ownedPlanetIdentity(owned: OwnedPlanet): PlanetIdentity {
  return makePlanet(owned.entry).generate()
}
