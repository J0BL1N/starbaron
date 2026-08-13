import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import {
  claimColony,
  claimHomePlanet,
  emptyStructureLevels,
} from '../src/sim/player'
import type { StructureGrid } from '../src/sim/player'
import { eligibleHomeWorlds } from '../src/sim/player/claim'
import type { BodyId } from '../src/sim/world/identity'
import {
  loadSave,
  MIGRATIONS,
  migrateSave,
  SAVE_KEY,
  SAVE_V2_KEY,
  SAVE_V3_KEY,
  saveGame,
  validateSave,
} from '../src/ui/save'
import type { SaveGameV1, SaveGameV2, SaveGameV3 } from '../src/ui/save'
import { makeSave, MemoryStorage } from './saveHelpers'
import type { StructureId } from '../src/sim/structures/types'

const NOW = 1_700_000_000_000

const ELIGIBLE = eligibleHomeWorlds(PLANETS)
const NO_TAKEN: ReadonlySet<BodyId> = new Set<BodyId>()

function rawV1(overrides: { game?: unknown } = {}): SaveGameV1 {
  return {
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
      ...(overrides.game as object),
    },
    tutorial: { step: 0, done: false, skipped: false },
    offlineSummarySeen: false,
  }
}

function rawV2(): SaveGameV2 {
  const home = claimHomePlanet('v2-player', NOW, ELIGIBLE, NO_TAKEN)
  const colonyEntry = PLANETS.find((entry) => entry.name !== home.name)!
  const colony = claimColony(colonyEntry, NOW)
  return {
    schemaVersion: 2,
    savedAt: NOW,
    player: {
      playerId: 'v2-player',
      homePlanet: home,
      colonies: [colony],
      wallet: {
        credits: 12_345,
        alloys: 67,
        population: 2_500,
        garrison: 800,
        fleet: 4,
      },
      structureLevels: { housing: 3, oreMine: 1 } as Record<StructureId, number>,
      lastTickAt: NOW,
    },
    tutorial: { step: 0, done: false, skipped: false },
    offlineSummarySeen: false,
  }
}

describe('P2-T04-B migration v2 -> v3', () => {
  it('ships the v2 -> v3 migration entry', () => {
    expect(typeof MIGRATIONS[2]).toBe('function')
  })

  it('migrates a v2 save: wallet shrinks, home carries old pop/garrison/fleet, grids nest by name', () => {
    const migrated = migrateSave(rawV2()) as unknown as SaveGameV3
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.player.wallet).toEqual({ credits: 12_345, alloys: 67 })
    expect(migrated.player.homePlanet.population).toBe(2_500)
    expect(migrated.player.homePlanet.garrison).toBe(800)
    expect(migrated.player.homePlanet.fleet).toBe(4)
    const homeName = migrated.player.homePlanet.name
    expect(migrated.player.structureLevels[homeName].housing).toBe(3)
    expect(migrated.player.structureLevels[homeName].oreMine).toBe(1)
    const colony = migrated.player.colonies[0]
    expect(colony.population).toBe(0)
    expect(colony.garrison).toBe(0)
    expect(colony.fleet).toBe(0)
    expect(migrated.player.structureLevels[colony.name]).toEqual(
      emptyStructureLevels(),
    )
    expect(validateSave(migrated)).not.toBeNull()
  })

  it('migration is idempotent: a v3 save passes through migrateSave unchanged', () => {
    const v3 = makeSave({ player: { wallet: { credits: 7_777 } } })
    const migrated = migrateSave(v3)
    expect(migrated).toBe(v3)
    expect(validateSave(migrated)).not.toBeNull()
    expect(validateSave(migrated)!.player.wallet.credits).toBe(7_777)
  })

  it('multi-hop v1 -> v2 -> v3 lands on v3 with the home carrying the v1 wallet population', () => {
    const migrated = migrateSave(rawV1()) as unknown as SaveGameV3
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.player.wallet).toEqual({ credits: 12_345, alloys: 67 })
    expect(migrated.player.homePlanet.population).toBe(2_500)
    expect(migrated.player.homePlanet.garrison).toBe(800)
    const homeName = migrated.player.homePlanet.name
    expect(migrated.player.structureLevels[homeName].housing).toBe(3)
  })
})

describe('P2-T04-B v3 save round-trip', () => {
  it('saveGame writes the v3 key and loadSave restores per-planet grids, per-planet pop, and the wallet', () => {
    const home = claimHomePlanet('roundtrip-player', NOW, ELIGIBLE, NO_TAKEN)
    const colonyEntry = PLANETS.find((entry) => entry.name !== home.name)!
    const colony = claimColony(colonyEntry, NOW)
    const save = makeSave({
      player: {
        playerId: 'roundtrip-player',
        homePlanet: home,
        colonies: [colony],
        wallet: { credits: 12_345, alloys: 67 },
        structureLevels: {
          [home.name]: { housing: 3 },
          [colony.name]: { oreMine: 2 },
        },
      },
    })
    const canonical = validateSave(save)!
    const storage = new MemoryStorage()
    expect(saveGame(save, storage)).toBe(true)

    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save).toEqual(canonical)
      expect(result.save.player.wallet).toEqual({ credits: 12_345, alloys: 67 })
      expect(result.save.player.structureLevels[home.name].housing).toBe(3)
      expect(result.save.player.structureLevels[colony.name].oreMine).toBe(2)
      expect(result.save.player.homePlanet.population).toBe(1_000)
      expect(result.save.player.colonies[0].population).toBe(0)
    }
  })

  it('loadSave probes the v3 key first and ignores stale v2/v1 keys', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V3_KEY, JSON.stringify(makeSave({ player: { wallet: { credits: 9_999 } } })))
    storage.setItem(SAVE_V2_KEY, JSON.stringify(rawV2()))
    storage.setItem(SAVE_KEY, JSON.stringify(rawV1()))
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.wallet.credits).toBe(9_999)
    }
  })

  it('v3 load writes the v3 key and tombstones the v2 and v1 keys on the same call', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V2_KEY, JSON.stringify(rawV2()))
    storage.setItem(SAVE_KEY, JSON.stringify(rawV1()))
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    expect(storage.getItem(SAVE_V3_KEY)).not.toBeNull()
    expect(storage.getItem(SAVE_V2_KEY)).toBeNull()
    expect(storage.getItem(SAVE_KEY)).toBeNull()
    if (result.kind === 'ok') {
      const reloaded = loadSave(storage)
      expect(reloaded.kind).toBe('ok')
      if (reloaded.kind === 'ok') {
        expect(reloaded.save).toEqual(result.save)
      }
    }
  })
})

describe('P2-T04-B v3 corrupt matrix', () => {
  function seedRaw(storage: MemoryStorage, raw: unknown): void {
    storage.setItem(SAVE_V3_KEY, JSON.stringify(raw))
  }

  it('wallet containing population/garrison/fleet is corrupt (structural change)', () => {
    const save = makeSave()
    const bad = {
      ...save,
      player: { ...save.player, wallet: { ...save.player.wallet, population: 100 } },
    }
    expect(validateSave(bad)).toBeNull()
    const storage = new MemoryStorage()
    seedRaw(storage, bad)
    expect(() => loadSave(storage)).not.toThrow()
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('a grid key not in the owned set is corrupt', () => {
    const save = makeSave()
    const bad = {
      ...save,
      player: {
        ...save.player,
        structureLevels: { ...save.player.structureLevels, 'Not Owned': { housing: 1 } },
      },
    }
    expect(validateSave(bad)).toBeNull()
    const storage = new MemoryStorage()
    seedRaw(storage, bad)
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('a negative per-planet population is corrupt', () => {
    const save = makeSave()
    const bad = {
      ...save,
      player: { ...save.player, homePlanet: { ...save.player.homePlanet, population: -1 } },
    }
    expect(validateSave(bad)).toBeNull()
    const storage = new MemoryStorage()
    seedRaw(storage, bad)
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('a bad nested level (fraction / string / unknown id) is corrupt', () => {
    const save = makeSave()
    const homeName = save.player.homePlanet.name
    for (const levels of [
      { housing: 0.5 },
      { housing: '3' },
      { wormhole: 1 },
    ]) {
      const bad = {
        ...save,
        player: {
          ...save.player,
          structureLevels: { ...save.player.structureLevels, [homeName]: levels },
        },
      }
      expect(validateSave(bad), JSON.stringify(levels)).toBeNull()
      const storage = new MemoryStorage()
      seedRaw(storage, bad)
      expect(loadSave(storage), JSON.stringify(levels)).toEqual({ kind: 'corrupt' })
    }
  })

  it('a missing grid for an owned colony is lenient: defaulted to an empty grid, still ok', () => {
    const home = claimHomePlanet('lenient-player', NOW, ELIGIBLE, NO_TAKEN)
    const colonyEntry = PLANETS.find((entry) => entry.name !== home.name)!
    const colony = claimColony(colonyEntry, NOW)
    const save = makeSave({
      player: { playerId: 'lenient-player', homePlanet: home, colonies: [colony] },
    })
    delete (save.player.structureLevels as Record<string, StructureGrid>)[
      colony.name
    ]
    const validated = validateSave(save)
    expect(validated).not.toBeNull()
    expect(validated!.player.structureLevels[colony.name]).toEqual(
      emptyStructureLevels(),
    )
  })

  it('a migrated v2 with an empty wallet defaults the home population to 0, not a throw', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      SAVE_V2_KEY,
      JSON.stringify({ ...rawV2(), player: { ...rawV2().player, wallet: {} } }),
    )
    expect(() => loadSave(storage)).not.toThrow()
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })
})
