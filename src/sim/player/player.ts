import { makePlanet } from '../planets'
import type { PlanetIdentity } from '../planets/types'
import type { BodyId } from '../world/identity'
import { claimHomePlanet } from './claim'
import type { HomeWorldCandidate } from './claim'
import { STARTER_STRUCTURES } from './grid'
import { startWallet } from './wallet'
import type { OwnedPlanet, PlayerState } from './types'

/**
 * generatePlayerId lives at the boundary (src/boundary/id.ts) and is NOT
 * re-exported here: the sim layer never calls it and never depends on it.
 * The UI boundary imports it directly (see src/ui/useGameState.ts).
 */

/**
 * The home-world eligible set is CALLER-INJECTED (finding 1): the sim layer
 * never imports the catalogue. Callers supply the catalogue-based eligible
 * set (eligibleHomeWorlds over their own catalogue import) plus the taken
 * home-world set; createPlayer forwards them to claimHomePlanet, which
 * delegates the selection to assignment.selectHomeWorld.
 */
export function createPlayer(
  playerId: string,
  now: number,
  eligible: readonly HomeWorldCandidate[],
  taken: ReadonlySet<BodyId>,
): PlayerState {
  const homePlanet = claimHomePlanet(playerId, now, eligible, taken)
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
