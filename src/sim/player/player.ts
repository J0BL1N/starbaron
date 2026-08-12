import { makePlanet } from '../planets'
import type { PlanetIdentity } from '../planets/types'
import { claimHomePlanet } from './claim'
import { emptyStructureLevels } from './grid'
import { startWallet } from './wallet'
import type { OwnedPlanet, PlayerState } from './types'

/**
 * Re-export of the boundary id utility (src/sim/player/id.ts) to keep the
 * public API. generatePlayerId is NOT part of the pure sim layer — the sim
 * never calls it, the UI boundary does. The boundary marker is the contract.
 */
export { generatePlayerId } from './id'

export function createPlayer(playerId: string, now: number): PlayerState {
  const homePlanet = claimHomePlanet(playerId, now)
  return {
    playerId,
    homePlanet,
    colonies: [],
    wallet: startWallet(),
    structureLevels: { [homePlanet.name]: emptyStructureLevels() },
    lastTickAt: now,
  }
}

export function ownedPlanetIdentity(owned: OwnedPlanet): PlanetIdentity {
  return makePlanet(owned.entry).generate()
}
