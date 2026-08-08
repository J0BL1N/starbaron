import { createPlayer } from '../src/sim/player'
import type { OwnedPlanet, PlayerState } from '../src/sim/player'
import { SAVE_V2_KEY } from '../src/ui/save'
import type { SaveGameV2 } from '../src/ui/save'
import type { StructureId } from '../src/sim/structures/types'

export const GAP_12H = 12 * 60 * 60 * 1_000

export class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

export class ThrowingStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(_key: string, _value: string): void {
    throw new Error('QuotaExceededError')
  }
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export const TEST_PLAYER_ID = 'fixture-player'

export function makeSave(overrides: DeepPartial<SaveGameV2> = {}): SaveGameV2 {
  const now = Date.now()
  const playerOverrides = overrides.player ?? {}
  const playerId = playerOverrides.playerId ?? TEST_PLAYER_ID
  const defaultPlayer = createPlayer(playerId, now)

  const homePlanet = playerOverrides.homePlanet ?? {}
  const player: PlayerState = {
    playerId,
    homePlanet: {
      ...defaultPlayer.homePlanet,
      ...homePlanet,
      entry: {
        ...defaultPlayer.homePlanet.entry,
        ...(homePlanet.entry ?? {}),
      },
    },
    colonies: (playerOverrides.colonies as OwnedPlanet[] | undefined) ?? [],
    wallet: {
      credits: playerOverrides.wallet?.credits ?? defaultPlayer.wallet.credits,
      alloys: playerOverrides.wallet?.alloys ?? defaultPlayer.wallet.alloys,
      population:
        playerOverrides.wallet?.population ?? defaultPlayer.wallet.population,
      garrison: playerOverrides.wallet?.garrison ?? defaultPlayer.wallet.garrison,
      fleet: playerOverrides.wallet?.fleet ?? defaultPlayer.wallet.fleet,
    },
    structureLevels: {
      ...defaultPlayer.structureLevels,
      ...(playerOverrides.structureLevels ?? {}),
    } as Record<StructureId, number>,
    lastTickAt: playerOverrides.lastTickAt ?? now,
  }

  return {
    schemaVersion: overrides.schemaVersion ?? 2,
    savedAt: overrides.savedAt ?? now,
    player,
    tutorial: {
      step: overrides.tutorial?.step ?? 0,
      done: overrides.tutorial?.done ?? false,
      skipped: overrides.tutorial?.skipped ?? false,
    },
    offlineSummarySeen: overrides.offlineSummarySeen ?? false,
  }
}

export function seedSave(storage: Storage, save: SaveGameV2): void {
  storage.setItem(SAVE_V2_KEY, JSON.stringify(save))
}

export function seedLocalStorageGap(
  gapMs: number,
  overrides: DeepPartial<SaveGameV2> = {},
): void {
  const save = makeSave(overrides)
  save.player.lastTickAt = Date.now() - gapMs
  window.localStorage.setItem(SAVE_V2_KEY, JSON.stringify(save))
}

export function readSave(storage: Storage): SaveGameV2 {
  const raw = storage.getItem(SAVE_V2_KEY)
  if (raw === null) {
    throw new Error('no save present in storage')
  }
  return JSON.parse(raw) as SaveGameV2
}
