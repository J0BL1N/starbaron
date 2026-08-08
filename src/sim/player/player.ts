import { makePlanet } from '../planets'
import type { PlanetIdentity } from '../planets/types'
import { claimHomePlanet } from './claim'
import { emptyStructureLevels } from './grid'
import { startWallet } from './wallet'
import type { OwnedPlanet, PlayerState } from './types'

export function generatePlayerId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj != null && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

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
