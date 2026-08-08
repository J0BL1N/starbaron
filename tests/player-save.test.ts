import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import { claimColony, claimHomePlanet } from '../src/sim/player'
import type { OwnedPlanet } from '../src/sim/player'
import {
  loadSave,
  MIGRATIONS,
  migrateSave,
  SAVE_KEY,
  SAVE_V3_KEY,
  saveGame,
  SAVE_SCHEMA_VERSION,
  validateSave,
} from '../src/ui/save'
import type { SaveGameV1, SaveGameV3 } from '../src/ui/save'
import {
  makeSave,
  MemoryStorage,
  seedSave,
} from './saveHelpers'
import type { StructureId } from '../src/sim/structures/types'

const NOW = 1_700_000_000_000

function makeV1(overrides: Partial<SaveGameV1> = {}): SaveGameV1 {
  const base: SaveGameV1 = {
    schemaVersion: 1,
    savedAt: NOW,
    game: {
      tier: 1,
      credits: 12_345,
      alloys: 67,
      population: 2_500,
      garrison: 800,
      fleet: 4,
      levels: { housing: 3, oreMine: 1 } as Record<StructureId, number>,
      lastTickAt: NOW - 3_600_000,
    },
    tutorial: { step: 2, done: false, skipped: false },
    offlineSummarySeen: true,
  }
  return {
    schemaVersion: 1,
    savedAt: overrides.savedAt ?? base.savedAt,
    game: {
      ...base.game,
      ...(overrides.game ?? {}),
    },
    tutorial: overrides.tutorial ?? base.tutorial,
    offlineSummarySeen:
      overrides.offlineSummarySeen ?? base.offlineSummarySeen,
  }
}

describe('P2-T04-B save migration v1->v3 (multi-hop)', () => {
  it('ships the v1->v2 and v2->v3 migration entries', () => {
    expect(typeof MIGRATIONS[1]).toBe('function')
    expect(typeof MIGRATIONS[2]).toBe('function')
  })

  it('migrates a v1 save into a full v3 player with an automatic claim', () => {
    const v1 = makeV1()
    const migrated = migrateSave(v1) as unknown as {
      schemaVersion: number
      savedAt: number
      player: {
        playerId: string
        homePlanet: { name: string; isHome: boolean; unconquerable: boolean; population: number; garrison: number; fleet: number }
        colonies: unknown[]
        wallet: { credits: number; alloys: number }
        structureLevels: Record<string, Record<string, number>>
        lastTickAt: number
      }
      tutorial: { step: number; done: boolean; skipped: boolean }
      offlineSummarySeen: boolean
    }
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.savedAt).toBe(NOW)
    expect(migrated.player.playerId.length).toBeGreaterThan(0)
    expect(PLANETS.some((p) => p.name === migrated.player.homePlanet.name)).toBe(
      true,
    )
    expect(migrated.player.homePlanet.isHome).toBe(true)
    expect(migrated.player.homePlanet.unconquerable).toBe(true)
    expect(migrated.player.colonies).toEqual([])
    expect(migrated.player.wallet).toEqual({
      credits: 12_345,
      alloys: 67,
    })
    expect(migrated.player.homePlanet.population).toBe(2_500)
    expect(migrated.player.homePlanet.garrison).toBe(800)
    expect(migrated.player.homePlanet.fleet).toBe(4)
    const homeGrid = migrated.player.structureLevels[migrated.player.homePlanet.name]
    expect(homeGrid.housing).toBe(3)
    expect(homeGrid.oreMine).toBe(1)
    expect(migrated.player.lastTickAt).toBe(NOW - 3_600_000)
    expect(migrated.tutorial).toEqual({ step: 2, done: false, skipped: false })
    expect(migrated.offlineSummarySeen).toBe(true)
  })

  it('the migrated claim builds a real planet whose tier comes from the catalogue, not the placeholder', () => {
    const v1 = makeV1()
    const migrated = migrateSave(v1) as unknown as {
      player: { playerId: string; homePlanet: { name: string; tier: number; baselineIncomePerSec: number } }
    }
    const expected = claimHomePlanet(migrated.player.playerId, NOW)
    expect(migrated.player.homePlanet.name).toBe(expected.name)
    expect(migrated.player.homePlanet.tier).toBe(expected.tier)
    expect(migrated.player.homePlanet.baselineIncomePerSec).toBe(
      expected.baselineIncomePerSec,
    )
  })

  it('loadSave migrates a v1 save from the legacy key and validates the result as v3', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, JSON.stringify(makeV1()))
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
      expect(result.save.player.wallet.credits).toBe(12_345)
      expect(result.save.player.homePlanet.unconquerable).toBe(true)
      expect(result.save.player.playerId.length).toBeGreaterThan(0)
    }
  })

  it('migration is idempotent: a v3 save passes through migrateSave unchanged', () => {
    const v3 = makeSave({ player: { wallet: { credits: 7_777 } } })
    const migrated = migrateSave(v3)
    expect(validateSave(migrated)).not.toBeNull()
    const validated = validateSave(migrated)!
    expect(validated.player.wallet.credits).toBe(7_777)
  })

  it('migration derives a stable playerId from v1 content, not a fresh UUID per run', () => {
    const first = migrateSave(makeV1()) as unknown as {
      player: { playerId: string }
    }
    const second = migrateSave(makeV1()) as unknown as {
      player: { playerId: string }
    }
    expect(first.player.playerId.length).toBeGreaterThan(0)
    expect(second.player.playerId).toBe(first.player.playerId)
    expect(second.player.playerId.startsWith('migrated-')).toBe(true)
  })

  it('repeated v1 loads (reload before any deferred save) yield the same playerId and home planet', () => {
    const serialized = JSON.stringify(makeV1())
    const first = new MemoryStorage()
    const second = new MemoryStorage()
    first.setItem(SAVE_KEY, serialized)
    second.setItem(SAVE_KEY, serialized)

    const a = loadSave(first)
    const b = loadSave(second)
    expect(a.kind).toBe('ok')
    expect(b.kind).toBe('ok')
    if (a.kind === 'ok' && b.kind === 'ok') {
      expect(b.save.player.playerId).toBe(a.save.player.playerId)
      expect(b.save.player.homePlanet.name).toBe(a.save.player.homePlanet.name)
      expect(b.save.player.homePlanet.name).toBe(
        claimHomePlanet(a.save.player.playerId, NOW).name,
      )
    }
  })

  it('loadSave persists the migration immediately: writes v3 and tombstones v1 on the same call', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, JSON.stringify(makeV1()))
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    expect(storage.getItem(SAVE_V3_KEY)).not.toBeNull()
    expect(storage.getItem(SAVE_KEY)).toBeNull()
    if (result.kind === 'ok') {
      const persisted = JSON.parse(storage.getItem(SAVE_V3_KEY)!) as SaveGameV3
      expect(persisted.player.playerId).toBe(result.save.player.playerId)
      expect(persisted.player.homePlanet.name).toBe(
        result.save.player.homePlanet.name,
      )
      const reloaded = loadSave(storage)
      expect(reloaded.kind).toBe('ok')
      if (reloaded.kind === 'ok') {
        expect(reloaded.save.player.playerId).toBe(result.save.player.playerId)
        expect(reloaded.save.player.homePlanet.name).toBe(
          result.save.player.homePlanet.name,
        )
      }
    }
  })

  it('a migrated v1 save loads with the home planet matching the deterministic claim', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, JSON.stringify(makeV1()))
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      const expected = claimHomePlanet(result.save.player.playerId, NOW)
      expect(result.save.player.homePlanet.name).toBe(expected.name)
      expect(result.save.player.homePlanet.tier).toBe(expected.tier)
      expect(result.save.player.homePlanet.isHome).toBe(true)
      expect(result.save.player.homePlanet.unconquerable).toBe(true)
    }
  })

  it('repairs a fabricated home planet to the deterministic claim on load and persists the repair', () => {
    const storage = new MemoryStorage()
    const playerId = 'fabricated-player'
    const expected = claimHomePlanet(playerId, NOW)
    const otherEntry = PLANETS.find((entry) => entry.name !== expected.name)!
    const fabricatedHome: OwnedPlanet = {
      ...claimColony(otherEntry, NOW),
      isHome: true,
      unconquerable: true,
    }
    seedSave(
      storage,
      makeSave({
        player: {
          playerId,
          homePlanet: fabricatedHome,
          wallet: { credits: 6_000 },
        },
      }),
    )

    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.homePlanet.name).toBe(expected.name)
      expect(result.save.player.wallet.credits).toBe(6_000)
      const persisted = JSON.parse(storage.getItem(SAVE_V3_KEY)!) as SaveGameV3
      expect(persisted.player.homePlanet.name).toBe(expected.name)
    }
  })

  it('loadSave reports corrupt for a fabricated home planet name that is not in the catalogue', () => {
    const storage = new MemoryStorage()
    const save = makeSave()
    const bad = {
      ...save,
      player: {
        ...save.player,
        homePlanet: {
          ...save.player.homePlanet,
          name: 'Fabricated World X',
          entry: { ...save.player.homePlanet.entry, name: 'Fabricated World X' },
        },
      },
    }
    seedSave(storage, bad)
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })
})

describe('P2-T04-B save v3 — key-per-version and tombstoning', () => {
  it('saveGame writes the v3 key and tombstones the v2 and v1 keys after a successful write', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, JSON.stringify(makeV1()))
    expect(saveGame(makeSave(), storage)).toBe(true)
    expect(storage.getItem(SAVE_V3_KEY)).not.toBeNull()
    expect(storage.getItem(SAVE_KEY)).toBeNull()
  })

  it('loadSave prefers the v3 key over a legacy v1 key', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, JSON.stringify(makeV1()))
    seedSave(storage, makeSave({ player: { wallet: { credits: 5_555 } } }))
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.wallet.credits).toBe(5_555)
      expect(result.save.player.playerId).toBe('fixture-player')
    }
  })
})

describe('P2-T04-B save v3 — claims round-trip', () => {
  it('a seeded save with colonies round-trips identical claims through save/load', () => {
    const home = claimHomePlanet('colony-player', NOW)
    const colony = claimColony(
      PLANETS.find((entry) => entry.name !== home.name)!,
      NOW,
    )
    const save = makeSave({
      player: {
        playerId: 'colony-player',
        homePlanet: home,
        colonies: [colony],
        wallet: { credits: 4_200, alloys: 300 },
      },
    })
    const storage = new MemoryStorage()
    expect(saveGame(save, storage)).toBe(true)

    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.homePlanet).toEqual(home)
      expect(result.save.player.colonies).toHaveLength(1)
      expect(result.save.player.colonies[0].name).toBe(colony.name)
      expect(result.save.player.colonies[0].isHome).toBe(false)
      expect(result.save.player.colonies[0].unconquerable).toBe(false)
      expect(result.save.player.colonies[0].population).toBe(0)
      expect(result.save.player.wallet).toEqual({
        credits: 4_200,
        alloys: 300,
      })
    }
  })

  it('wallet lives in player (the promoted state), not a top-level game node', () => {
    const save = makeSave()
    expect(save.player.wallet).toBeDefined()
    expect(save.player.structureLevels).toBeDefined()
    expect('game' in save).toBe(false)
  })

  it('rejects a v3 save with a colony that duplicates the home planet', () => {
    const save = makeSave()
    const bad = {
      ...save,
      player: {
        ...save.player,
        colonies: [save.player.homePlanet],
      },
    }
    const storage = new MemoryStorage()
    seedSave(storage, bad)
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('rejects a v3 save with a missing claimed planet name', () => {
    const save = makeSave()
    const bad = {
      ...save,
      player: {
        ...save.player,
        homePlanet: {
          ...save.player.homePlanet,
          entry: { ...save.player.homePlanet.entry, name: '' },
        },
      },
    }
    const storage = new MemoryStorage()
    seedSave(storage, bad)
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })
})
