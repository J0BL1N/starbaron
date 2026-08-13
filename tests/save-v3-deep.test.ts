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
  migrateSave,
  SAVE_KEY,
  SAVE_V2_KEY,
  SAVE_V3_KEY,
  saveGame,
  validateSave,
} from '../src/ui/save'
import type { SaveGameV1, SaveGameV2, SaveGameV3 } from '../src/ui/save'
import { MemoryStorage } from './saveHelpers'
import type { StructureId } from '../src/sim/structures/types'

const NOW = 1_700_000_000_000

const ELIGIBLE = eligibleHomeWorlds(PLANETS)
const NO_TAKEN: ReadonlySet<BodyId> = new Set<BodyId>()

function rawV2Multi(): SaveGameV2 {
  const home = claimHomePlanet('v2-deep', NOW, ELIGIBLE, NO_TAKEN)
  const others = PLANETS.filter((entry) => entry.name !== home.name)
  const colonyA = claimColony(others[0], NOW)
  const colonyB = claimColony(others[1], NOW)
  return {
    schemaVersion: 2,
    savedAt: NOW,
    player: {
      playerId: 'v2-deep',
      homePlanet: home,
      colonies: [colonyA, colonyB],
      wallet: {
        credits: 12_345,
        alloys: 67,
        population: 3_750,
        garrison: 1_234,
        fleet: 99,
      },
      structureLevels: { housing: 3, oreMine: 1 } as Record<StructureId, number>,
      lastTickAt: NOW,
    },
    tutorial: { step: 0, done: false, skipped: false },
    offlineSummarySeen: false,
  }
}

function rawV1(): SaveGameV1 {
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
    },
    tutorial: { step: 0, done: false, skipped: false },
    offlineSummarySeen: false,
  }
}

describe('P2-T04-C migration v2->v3 deep', () => {
  it('wallet population/garrison/fleet move to homePlanet and vanish from the wallet', () => {
    const migrated = migrateSave(rawV2Multi()) as unknown as SaveGameV3
    expect(migrated.player.homePlanet.population).toBe(3_750)
    expect(migrated.player.homePlanet.garrison).toBe(1_234)
    expect(migrated.player.homePlanet.fleet).toBe(99)
    expect('population' in migrated.player.wallet).toBe(false)
    expect('garrison' in migrated.player.wallet).toBe(false)
    expect('fleet' in migrated.player.wallet).toBe(false)
    expect(Object.keys(migrated.player.wallet).sort()).toEqual([
      'alloys',
      'credits',
    ])
    expect(validateSave(migrated)).not.toBeNull()
  })

  it('home grid nests the full flat map under the home name; colony grids are empty and zeroed', () => {
    const migrated = migrateSave(rawV2Multi()) as unknown as SaveGameV3
    const homeName = migrated.player.homePlanet.name
    const homeGrid = migrated.player.structureLevels[homeName]
    expect(homeGrid).toEqual({ housing: 3, oreMine: 1 })
    for (const colony of migrated.player.colonies) {
      expect(colony.population).toBe(0)
      expect(colony.garrison).toBe(0)
      expect(colony.fleet).toBe(0)
      expect(migrated.player.structureLevels[colony.name]).toEqual(
        emptyStructureLevels(),
      )
    }
    const owned = new Set([
      homeName,
      ...migrated.player.colonies.map((colony) => colony.name),
    ])
    expect(Object.keys(migrated.player.structureLevels).sort()).toEqual(
      Array.from(owned).sort(),
    )
    const validated = validateSave(migrated)!
    expect(validated.player.structureLevels[homeName]).toEqual({
      ...emptyStructureLevels(),
      housing: 3,
      oreMine: 1,
    })
  })

  it('v2 with a non-array colonies field degrades leniently (migrates to no colonies, still ok)', () => {
    const v2 = rawV2Multi()
    ;(v2.player as unknown as { colonies: unknown }).colonies = 'oops'
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V2_KEY, JSON.stringify(v2))
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.colonies).toEqual([])
    }
  })

  it('v2 missing its homePlanet lands corrupt after migration (empty grid key)', () => {
    const v2 = rawV2Multi()
    delete (v2.player as unknown as { homePlanet?: unknown }).homePlanet
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V2_KEY, JSON.stringify(v2))
    expect(() => loadSave(storage)).not.toThrow()
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('a colony grid containing an unknown structure id is corrupt', () => {
    const home = claimHomePlanet('grid-key-player', NOW, ELIGIBLE, NO_TAKEN)
    const colony = claimColony(
      PLANETS.find((entry) => entry.name !== home.name)!,
      NOW,
    )
    const bad: SaveGameV3 = {
      schemaVersion: 3,
      savedAt: NOW,
      player: {
        playerId: 'grid-key-player',
        homePlanet: home,
        colonies: [colony],
        wallet: { credits: 1_000, alloys: 0 },
        structureLevels: {
          [home.name]: { housing: 1 } as unknown as StructureGrid,
          [colony.name]: { wormhole: 1 } as unknown as StructureGrid,
        },
        lastTickAt: NOW,
      },
      tutorial: { step: 0, done: false, skipped: false },
      offlineSummarySeen: false,
    }
    expect(validateSave(bad)).toBeNull()
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V3_KEY, JSON.stringify(bad))
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('a structureLevels key that names no owned planet is corrupt', () => {
    const home = claimHomePlanet('extra-key-player', NOW, ELIGIBLE, NO_TAKEN)
    const bad: SaveGameV3 = {
      schemaVersion: 3,
      savedAt: NOW,
      player: {
        playerId: 'extra-key-player',
        homePlanet: home,
        colonies: [],
        wallet: { credits: 1_000, alloys: 0 },
        structureLevels: {
          [home.name]: { housing: 1 } as unknown as StructureGrid,
          'Lost Colony': { housing: 1 } as unknown as StructureGrid,
        },
        lastTickAt: NOW,
      },
      tutorial: { step: 0, done: false, skipped: false },
      offlineSummarySeen: false,
    }
    expect(validateSave(bad)).toBeNull()
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V3_KEY, JSON.stringify(bad))
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })
})

describe('P2-T04-C round-trip stability (byte-level)', () => {
  it('save -> load -> save is byte-stable for a multi-planet v3 save', () => {
    const home = claimHomePlanet('rt-deep', NOW, ELIGIBLE, NO_TAKEN)
    const others = PLANETS.filter((entry) => entry.name !== home.name)
    const colonyA = claimColony(others[0], NOW)
    const colonyB = claimColony(others[1], NOW)
    const save: SaveGameV3 = {
      schemaVersion: 3,
      savedAt: NOW,
      player: {
        playerId: 'rt-deep',
        homePlanet: { ...home, population: 1_234, garrison: 55, fleet: 6 },
        colonies: [colonyA, colonyB],
        wallet: { credits: 9_000, alloys: 40 },
        structureLevels: {
          [home.name]: { housing: 2, oreMine: 1 } as unknown as StructureGrid,
          [colonyA.name]: { shipyard: 1 } as unknown as StructureGrid,
          [colonyB.name]: {
            hydroponics: 1,
            barracks: 2,
          } as unknown as StructureGrid,
        },
        lastTickAt: NOW,
      },
      tutorial: { step: 1, done: false, skipped: false },
      offlineSummarySeen: true,
    }
    const storage = new MemoryStorage()
    expect(saveGame(save, storage)).toBe(true)
    const first = storage.getItem(SAVE_V3_KEY)!
    const r1 = loadSave(storage)
    expect(r1.kind).toBe('ok')
    if (r1.kind !== 'ok') return
    saveGame(r1.save, storage)
    const second = storage.getItem(SAVE_V3_KEY)!
    expect(second).toBe(first)
    const r2 = loadSave(storage)
    expect(r2.kind).toBe('ok')
    if (r2.kind === 'ok') {
      expect(r2.save).toEqual(r1.save)
      saveGame(r2.save, storage)
      expect(storage.getItem(SAVE_V3_KEY)).toBe(first)
    }
  })

  it('a migrated v2 -> v3 save is stable across save -> load -> save', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V2_KEY, JSON.stringify(rawV2Multi()))
    const r = loadSave(storage)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    const canonical = validateSave(r.save)!
    const first = storage.getItem(SAVE_V3_KEY)!
    saveGame(r.save, storage)
    expect(storage.getItem(SAVE_V3_KEY)).toBe(first)
    const reloaded = loadSave(storage)
    expect(reloaded.kind).toBe('ok')
    if (reloaded.kind === 'ok') {
      expect(reloaded.save).toEqual(canonical)
      saveGame(reloaded.save, storage)
      expect(storage.getItem(SAVE_V3_KEY)).toBe(first)
    }
  })
})

describe('P2-T04-C tombstone prevents re-migration', () => {
  it('one load migrates v2, writes v3, tombstones v2+v1, and a second load returns the identical save', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V2_KEY, JSON.stringify(rawV2Multi()))
    storage.setItem(SAVE_KEY, JSON.stringify(rawV1()))
    const r1 = loadSave(storage)
    expect(r1.kind).toBe('ok')
    expect(storage.getItem(SAVE_V3_KEY)).not.toBeNull()
    expect(storage.getItem(SAVE_V2_KEY)).toBeNull()
    expect(storage.getItem(SAVE_KEY)).toBeNull()
    if (r1.kind !== 'ok') return
    const first = storage.getItem(SAVE_V3_KEY)!
    const r2 = loadSave(storage)
    expect(r2.kind).toBe('ok')
    if (r2.kind === 'ok') {
      expect(r2.save).toEqual(r1.save)
    }
    expect(storage.getItem(SAVE_V3_KEY)).toBe(first)
    expect(storage.getItem(SAVE_V2_KEY)).toBeNull()
    expect(storage.getItem(SAVE_KEY)).toBeNull()
  })

  it('the v2 migration entry is not re-run on v3 data (pass-through by reference)', () => {
    const v3 = migrateSave(rawV2Multi()) as unknown as SaveGameV3
    expect(migrateSave(v3)).toBe(v3)
  })
})
