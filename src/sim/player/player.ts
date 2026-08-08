import { STRUCTURE_IDS } from '../structures/data'
import type { StructureId } from '../structures/types'
import { makePlanet } from '../planets'
import type { PlanetIdentity } from '../planets/types'
import { claimHomePlanet } from './claim'
import { startWallet } from './wallet'
import type { OwnedPlanet, PlayerState } from './types'

export function emptyStructureLevels(): Record<StructureId, number> {
  const levels = {} as Record<StructureId, number>
  for (const id of STRUCTURE_IDS) {
    levels[id] = 0
  }
  return levels
}

export function generatePlayerId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj != null && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createPlayer(playerId: string, now: number): PlayerState {
  return {
    playerId,
    homePlanet: claimHomePlanet(playerId, now),
    colonies: [],
    wallet: startWallet(),
    structureLevels: emptyStructureLevels(),
    lastTickAt: now,
  }
}

export function ownedPlanetIdentity(owned: OwnedPlanet): PlanetIdentity {
  return makePlanet(owned.entry).generate()
}
