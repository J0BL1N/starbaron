import { emptyStructureLevels, SAVE_KEY } from '../src/ui/save'
import type { SaveGameV1 } from '../src/ui/save'
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

export function makeSave(overrides: DeepPartial<SaveGameV1> = {}): SaveGameV1 {
  const now = Date.now()
  const base: SaveGameV1 = {
    schemaVersion: 1,
    savedAt: now,
    game: {
      tier: 1,
      credits: 1_000,
      alloys: 0,
      population: 1_000,
      garrison: 0,
      fleet: 0,
      levels: emptyStructureLevels(),
      lastTickAt: now,
    },
    tutorial: { step: 0, done: false, skipped: false },
    offlineSummarySeen: false,
  }
  const game = overrides.game ?? {}
  return {
    schemaVersion: overrides.schemaVersion ?? base.schemaVersion,
    savedAt: overrides.savedAt ?? base.savedAt,
    game: {
      tier: game.tier ?? base.game.tier,
      credits: game.credits ?? base.game.credits,
      alloys: game.alloys ?? base.game.alloys,
      population: game.population ?? base.game.population,
      garrison: game.garrison ?? base.game.garrison,
      fleet: game.fleet ?? base.game.fleet,
      levels: {
        ...base.game.levels,
        ...(game.levels ?? {}),
      } as Record<StructureId, number>,
      lastTickAt: game.lastTickAt ?? base.game.lastTickAt,
    },
    tutorial: {
      step: overrides.tutorial?.step ?? base.tutorial.step,
      done: overrides.tutorial?.done ?? base.tutorial.done,
      skipped: overrides.tutorial?.skipped ?? base.tutorial.skipped,
    },
    offlineSummarySeen: overrides.offlineSummarySeen ?? base.offlineSummarySeen,
  }
}

export function seedSave(storage: Storage, save: SaveGameV1): void {
  storage.setItem(SAVE_KEY, JSON.stringify(save))
}

export function seedLocalStorageGap(
  gapMs: number,
  overrides: Partial<SaveGameV1> = {},
): void {
  const save = makeSave(overrides)
  save.game.lastTickAt = Date.now() - gapMs
  window.localStorage.setItem(SAVE_KEY, JSON.stringify(save))
}

export function readSave(storage: Storage): SaveGameV1 {
  const raw = storage.getItem(SAVE_KEY)
  if (raw === null) {
    throw new Error('no save present in storage')
  }
  return JSON.parse(raw) as SaveGameV1
}
