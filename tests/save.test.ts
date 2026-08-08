import { describe, expect, it } from 'vitest'
import {
  loadSave,
  MIGRATIONS,
  SAVE_KEY,
  SAVE_SCHEMA_VERSION,
  saveGame,
  validateSave,
} from '../src/ui/save'
import {
  makeSave,
  MemoryStorage,
  seedSave,
} from './saveHelpers'

describe('P1-T04 save/load — round-trip', () => {
  it('validates a well-formed save and preserves every field', () => {
    const save = makeSave({
      game: {
        tier: 1,
        credits: 12_345,
        alloys: 67,
        population: 2_500,
        garrison: 800,
        fleet: 0,
        lastTickAt: 1_700_000_000_000,
      },
      tutorial: { step: 2, done: false, skipped: false },
      offlineSummarySeen: true,
    })
    const validated = validateSave(save)
    expect(validated).not.toBeNull()
    expect(validated).toEqual({
      schemaVersion: 1,
      savedAt: save.savedAt,
      game: {
        tier: 1,
        credits: 12_345,
        alloys: 67,
        population: 2_500,
        garrison: 800,
        fleet: 0,
        levels: save.game.levels,
        lastTickAt: 1_700_000_000_000,
      },
      tutorial: { step: 2, done: false, skipped: false },
      offlineSummarySeen: true,
    })
  })

  it('saveGame writes and loadSave reads back the same save', () => {
    const storage = new MemoryStorage()
    const save = makeSave({ game: { credits: 4_200 } })
    save.game.levels.housing = 3
    expect(saveGame(save, storage)).toBe(true)

    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.game.credits).toBe(4_200)
      expect(result.save.game.levels.housing).toBe(3)
      expect(result.save.offlineSummarySeen).toBe(false)
      expect(result.save.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
    }
  })

  it('loadSave returns absent for an empty storage and for a null adapter', () => {
    expect(loadSave(new MemoryStorage())).toEqual({ kind: 'absent' })
    expect(loadSave(null)).toEqual({ kind: 'absent' })
  })
})

describe('P1-T04 save/load — validation', () => {
  it('rejects a missing or mismatched schemaVersion', () => {
    const save = makeSave()
    expect(validateSave({ ...save, schemaVersion: undefined })).toBeNull()
    expect(validateSave({ ...save, schemaVersion: 2 })).toBeNull()
    expect(validateSave({ ...save, schemaVersion: 0 })).toBeNull()
  })

  it('rejects a non-finite or out-of-range tier', () => {
    const save = makeSave()
    expect(validateSave(deepGame(save, 'tier', 0))).toBeNull()
    expect(validateSave(deepGame(save, 'tier', 6))).toBeNull()
    expect(validateSave(deepGame(save, 'tier', 1.5))).toBeNull()
    expect(validateSave(deepGame(save, 'tier', NaN))).toBeNull()
  })

  it('rejects negative or non-finite wallet fields', () => {
    const save = makeSave()
    for (const field of ['credits', 'alloys', 'population', 'garrison', 'fleet'] as const) {
      expect(validateSave(deepGame(save, field, -1))).toBeNull()
      expect(validateSave(deepGame(save, field, Number.NaN))).toBeNull()
      expect(validateSave(deepGame(save, field, Number.POSITIVE_INFINITY))).toBeNull()
    }
  })

  it('rejects an unknown structure key in levels', () => {
    const save = makeSave()
    const bad = {
      ...save,
      game: { ...save.game, levels: { ...save.game.levels, wormhole: 1 } },
    }
    expect(validateSave(bad)).toBeNull()
  })

  it('rejects a non-integer or negative level value', () => {
    const save = makeSave()
    const badFraction = {
      ...save,
      game: { ...save.game, levels: { ...save.game.levels, housing: 0.5 } },
    }
    const badNegative = {
      ...save,
      game: { ...save.game, levels: { ...save.game.levels, housing: -2 } },
    }
    expect(validateSave(badFraction)).toBeNull()
    expect(validateSave(badNegative)).toBeNull()
  })

  it('rejects a missing or non-finite lastTickAt', () => {
    const save = makeSave()
    expect(validateSave(deepGame(save, 'lastTickAt', undefined))).toBeNull()
    expect(validateSave(deepGame(save, 'lastTickAt', Number.NaN))).toBeNull()
  })

  it('is lenient on additive fields: missing levels, tutorial and offlineSummarySeen default safely', () => {
    const save = makeSave()
    const game = { ...save.game }
    delete (game.levels as Record<string, number>).oreMine
    const missingLevel = { ...save, game }
    const validated = validateSave(missingLevel)
    expect(validated).not.toBeNull()
    expect(validated!.game.levels.oreMine).toBe(0)
    expect(validated!.game.levels.housing).toBe(0)

    const { tutorial: _omitTutorial, offlineSummarySeen: _omitSeen, ...rest } = save
    const missingOptional = validateSave(rest)
    expect(missingOptional).not.toBeNull()
    expect(missingOptional!.tutorial).toEqual({
      step: 0,
      done: false,
      skipped: false,
    })
    expect(missingOptional!.offlineSummarySeen).toBe(false)
  })

  it('treats a non-boolean offlineSummarySeen leniently as false', () => {
    const save = makeSave()
    const validated = validateSave({
      ...save,
      offlineSummarySeen: 'yes' as unknown as boolean,
    })
    expect(validated).not.toBeNull()
    expect(validated!.offlineSummarySeen).toBe(false)
  })
})

describe('P1-T04 save/load — storage-level results', () => {
  it('loadSave reports corrupt for unparseable JSON', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, 'not json{{')
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('loadSave reports future for a schemaVersion above the current one', () => {
    const storage = new MemoryStorage()
    const future = { ...makeSave(), schemaVersion: SAVE_SCHEMA_VERSION + 1 }
    seedSave(storage, future)
    expect(loadSave(storage)).toEqual({
      kind: 'future',
      version: SAVE_SCHEMA_VERSION + 1,
    })
  })

  it('loadSave reports corrupt for a structurally invalid save', () => {
    const storage = new MemoryStorage()
    seedSave(storage, makeSave({ game: { credits: -50 } }))
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('saveGame returns false when storage writes fail', () => {
    const storage = new MemoryStorage()
    storage.setItem = () => {
      throw new Error('quota')
    }
    expect(saveGame(makeSave(), storage)).toBe(false)
  })
})

describe('P1-T04 migration mechanism', () => {
  it('ships an empty migration map at v1', () => {
    expect(MIGRATIONS).toEqual({})
  })

  it('loadSave passes a v1 save through migrate unchanged', () => {
    const storage = new MemoryStorage()
    seedSave(storage, makeSave())
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
  })
})

function deepGame(
  save: ReturnType<typeof makeSave>,
  field: string,
  value: unknown,
): unknown {
  return { ...save, game: { ...save.game, [field]: value } }
}
