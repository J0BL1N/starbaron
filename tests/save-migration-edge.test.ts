import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import { claimColony, claimHomePlanet } from '../src/sim/player'
import { eligibleHomeWorlds } from '../src/sim/player/claim'
import type { BodyId } from '../src/sim/world/identity'
import {
  loadSave,
  migrateSave,
  SAVE_KEY,
  SAVE_V3_KEY,
  validateSave,
} from '../src/ui/save'
import type { SaveGameV3 } from '../src/ui/save'
import { makeSave, MemoryStorage, seedSave } from './saveHelpers'

const NOW = 1_700_000_000_000

const ELIGIBLE = eligibleHomeWorlds(PLANETS)
const NO_TAKEN: ReadonlySet<BodyId> = new Set<BodyId>()

function rawV1(
  overrides: {
    game?: unknown
    savedAt?: number
    tutorial?: unknown
    offlineSummarySeen?: unknown
    schemaVersion?: unknown
  } = {},
): Record<string, unknown> {
  const hasOwn = (key: keyof typeof overrides): boolean =>
    Object.prototype.hasOwnProperty.call(overrides, key)
  return {
    schemaVersion: overrides.schemaVersion ?? 1,
    savedAt: overrides.savedAt ?? NOW,
    game: hasOwn('game')
      ? overrides.game
      : {
          tier: 1,
          credits: 100,
          alloys: 5,
          population: 1_000,
          garrison: 0,
          fleet: 0,
          levels: {},
          lastTickAt: NOW,
        },
    tutorial: hasOwn('tutorial')
      ? overrides.tutorial
      : { step: 1, done: false, skipped: false },
    offlineSummarySeen: hasOwn('offlineSummarySeen')
      ? overrides.offlineSummarySeen
      : false,
  }
}

describe('P2-T04-B migration edge — empty/absent v1 fields', () => {
  it('never throws for any degenerate v1 shape; always yields a defined LoadResult', () => {
    const variants: unknown[] = [
      rawV1({ game: {} }),
      rawV1({ game: undefined }),
      rawV1({ game: null }),
      rawV1({ schemaVersion: '1' }),
      rawV1({ game: { tier: 1, credits: '100' } }),
      { schemaVersion: 1 },
      null,
      'not an object',
    ]
    for (const variant of variants) {
      const storage = new MemoryStorage()
      storage.setItem(SAVE_KEY, JSON.stringify(variant))
      expect(() => loadSave(storage), JSON.stringify(variant)).not.toThrow()
      const result = loadSave(storage)
      expect(['ok', 'corrupt', 'future', 'absent']).toContain(result.kind)
    }
  })

  it('a v1 save with empty structure levels migrates to a valid v3 with zeroed per-planet levels', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, JSON.stringify(rawV1()))
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.schemaVersion).toBe(3)
      expect(result.save.player.wallet.credits).toBe(100)
      expect(result.save.player.wallet.alloys).toBe(5)
      expect(result.save.player.homePlanet.population).toBe(1_000)
      const grid = result.save.player.structureLevels[result.save.player.homePlanet.name]
      for (const level of Object.values(grid)) {
        expect(level).toBe(0)
      }
    }
  })

  it('a v1 save missing tutorial/offlineSummarySeen migrates with additive defaults', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      SAVE_KEY,
      JSON.stringify(rawV1({ tutorial: undefined, offlineSummarySeen: undefined })),
    )
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.tutorial).toEqual({ step: 0, done: false, skipped: false })
      expect(result.save.offlineSummarySeen).toBe(false)
    }
  })

  it('a v1 with an empty game node resolves deterministically to corrupt (fresh-start path), never a crash', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, JSON.stringify(rawV1({ game: {} })))
    expect(() => loadSave(storage)).not.toThrow()
    expect(loadSave(storage).kind).toBe('corrupt')
  })

  it('migrateSave itself never throws on empty or absent v1 input', () => {
    for (const input of [
      rawV1({ game: {} }),
      rawV1({ game: null }),
      { schemaVersion: 1 },
      null,
      undefined,
    ]) {
      expect(() => migrateSave(input), JSON.stringify(input)).not.toThrow()
    }
  })
})

describe('P2-T04-B migration edge — repeated loads and repair', () => {
  it('repeated v1 loads from the same storage before any explicit save keep playerId + home identical', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, JSON.stringify(rawV1()))

    const first = loadSave(storage)
    const second = loadSave(storage)
    expect(first.kind).toBe('ok')
    expect(second.kind).toBe('ok')
    if (first.kind === 'ok' && second.kind === 'ok') {
      expect(second.save.player.playerId).toBe(first.save.player.playerId)
      expect(second.save.player.homePlanet.name).toBe(first.save.player.homePlanet.name)
      expect(second.save.player.homePlanet.name).toBe(
        claimHomePlanet(first.save.player.playerId, NOW, ELIGIBLE, NO_TAKEN).name,
      )
    }

    const persisted = JSON.parse(storage.getItem(SAVE_V3_KEY)!) as SaveGameV3
    expect(persisted.player.playerId).toBe(
      first.kind === 'ok' ? first.save.player.playerId : '',
    )
    expect(persisted.player.homePlanet.name).toBe(
      first.kind === 'ok' ? first.save.player.homePlanet.name : '',
    )
  })

  it('a v3 with a fabricated home is repaired to the deterministic claim, its twin colony dropped, grids pruned', () => {
    const storage = new MemoryStorage()
    const playerId = 'repair-deep-player'
    const expected = claimHomePlanet(playerId, NOW, ELIGIBLE, NO_TAKEN)
    const other = PLANETS.find((entry) => entry.name !== expected.name)!

    const fabricatedHome = { ...claimColony(other, NOW), isHome: true, unconquerable: true }
    const save = makeSave({
      player: {
        playerId,
        homePlanet: fabricatedHome,
        colonies: [claimColony(expected.entry, NOW)],
      },
    })
    seedSave(storage, save)

    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.homePlanet.name).toBe(expected.name)
      expect(result.save.player.homePlanet.isHome).toBe(true)
      expect(result.save.player.homePlanet.unconquerable).toBe(true)
      expect(result.save.player.colonies.map((c) => c.name)).not.toContain(
        expected.name,
      )
      expect(result.save.player.colonies).toHaveLength(0)
      expect(result.save.player.structureLevels[expected.name]).toBeDefined()
      expect(
        Object.keys(result.save.player.structureLevels).every((name) =>
          [expected.name].includes(name),
        ),
      ).toBe(true)
    }
  })

  it('a fabricated home that is a valid planet but marked with wrong flags is corrupt, not silently repaired', () => {
    const storage = new MemoryStorage()
    const playerId = 'bad-flags-player'
    const expected = claimHomePlanet(playerId, NOW, ELIGIBLE, NO_TAKEN)
    const other = PLANETS.find((entry) => entry.name !== expected.name)!
    const save = makeSave({ player: { playerId } })
    const conquerableHome = {
      ...save,
      player: {
        ...save.player,
        homePlanet: { ...claimColony(other, NOW), isHome: true, unconquerable: false },
      },
    }
    seedSave(storage, conquerableHome)
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('validateSave rejects the fabricated/wrong-flag home outright before any repair runs', () => {
    const playerId = 'validate-flags'
    const expected = claimHomePlanet(playerId, NOW, ELIGIBLE, NO_TAKEN)
    const other = PLANETS.find((entry) => entry.name !== expected.name)!
    const save = makeSave({ player: { playerId } })
    const wrongFlags = {
      ...save,
      player: {
        ...save.player,
        homePlanet: { ...claimColony(other, NOW), isHome: false, unconquerable: false },
      },
    }
    expect(validateSave(wrongFlags)).toBeNull()
  })
})
