import { createPlayer } from '../src/sim/player'
import type { OwnedPlanet, PlayerState, StructureGrid } from '../src/sim/player'
import { SAVE_V3_KEY } from '../src/ui/save'
import type { SaveGameV3 } from '../src/ui/save'
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

type LooseWallet = {
  credits?: number
  alloys?: number
  population?: number
  garrison?: number
  fleet?: number
}

export type SaveOverrides = {
  schemaVersion?: number
  savedAt?: number
  player?: {
    playerId?: string
    homePlanet?: Partial<OwnedPlanet>
    colonies?: OwnedPlanet[]
    wallet?: LooseWallet
    structureLevels?:
      | Partial<Record<StructureId, number>>
      | Record<string, Partial<Record<StructureId, number>>>
    lastTickAt?: number
  }
  tutorial?: { step?: number; done?: boolean; skipped?: boolean }
  offlineSummarySeen?: boolean
}

export const TEST_PLAYER_ID = 'fixture-player'

export function makeSave(overrides: SaveOverrides = {}): SaveGameV3 {
  const now = Date.now()
  const playerOverrides = overrides.player ?? {}
  const playerId = playerOverrides.playerId ?? TEST_PLAYER_ID
  const defaultPlayer = createPlayer(playerId, now)

  const homePlanet = playerOverrides.homePlanet ?? {}
  const wallet = playerOverrides.wallet ?? {}
  const colonies = playerOverrides.colonies ?? []
  const homeName = homePlanet.name ?? defaultPlayer.homePlanet.name

  const rawLevels = playerOverrides.structureLevels
  const isFlatGrid =
    rawLevels != null &&
    Object.values(rawLevels).every((value) => typeof value === 'number')

  const flatOverride = (isFlatGrid
    ? (rawLevels as Partial<Record<StructureId, number>>)
    : ((rawLevels as Record<string, Partial<Record<StructureId, number>>> | undefined)?.[
        homeName
      ] as Partial<Record<StructureId, number>> | undefined)
  ) ?? {}

  const homeGrid: StructureGrid = {
    ...defaultPlayer.structureLevels[homeName],
    ...flatOverride,
  }

  const structureLevels: Record<string, StructureGrid> = { [homeName]: homeGrid }
  if (!isFlatGrid && rawLevels != null) {
    for (const [name, grid] of Object.entries(rawLevels)) {
      structureLevels[name] = {
        ...defaultPlayer.structureLevels[homeName],
        ...grid,
      }
    }
  }
  for (const colony of colonies) {
    if (structureLevels[colony.name] == null) {
      structureLevels[colony.name] = { ...homeGrid }
    }
  }

  const player: PlayerState = {
    playerId,
    homePlanet: {
      ...defaultPlayer.homePlanet,
      ...homePlanet,
      name: homeName,
      entry: {
        ...defaultPlayer.homePlanet.entry,
        ...(homePlanet.entry ?? {}),
      },
      population:
        homePlanet.population ??
        wallet.population ??
        defaultPlayer.homePlanet.population,
      garrison:
        homePlanet.garrison ?? wallet.garrison ?? defaultPlayer.homePlanet.garrison,
      fleet: homePlanet.fleet ?? wallet.fleet ?? defaultPlayer.homePlanet.fleet,
    },
    colonies,
    wallet: {
      credits: wallet.credits ?? defaultPlayer.wallet.credits,
      alloys: wallet.alloys ?? defaultPlayer.wallet.alloys,
    },
    structureLevels,
    lastTickAt: playerOverrides.lastTickAt ?? now,
  }

  return {
    schemaVersion: (overrides.schemaVersion ?? 3) as 3,
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

export function seedSave(storage: Storage, save: SaveGameV3): void {
  storage.setItem(SAVE_V3_KEY, JSON.stringify(save))
}

export function seedLocalStorageGap(
  gapMs: number,
  overrides: SaveOverrides = {},
): void {
  const save = makeSave(overrides)
  save.player.lastTickAt = Date.now() - gapMs
  window.localStorage.setItem(SAVE_V3_KEY, JSON.stringify(save))
}

export function readSave(storage: Storage): SaveGameV3 {
  const raw = storage.getItem(SAVE_V3_KEY)
  if (raw === null) {
    throw new Error('no save present in storage')
  }
  return JSON.parse(raw) as SaveGameV3
}
