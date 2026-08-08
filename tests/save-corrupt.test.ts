import { describe, expect, it } from 'vitest'
import { loadSave, SAVE_KEY, validateSave } from '../src/ui/save'
import {
  makeSave,
  MemoryStorage,
  seedSave,
} from './saveHelpers'

function deepGame(
  save: ReturnType<typeof makeSave>,
  field: string,
  value: unknown,
): unknown {
  return { ...save, game: { ...save.game, [field]: value } }
}

describe('P1-T04-C corrupt-save matrix — wrong types', () => {
  it('rejects a string credits value', () => {
    expect(validateSave(deepGame(makeSave(), 'credits', '1200'))).toBeNull()
  })

  it('rejects a string population value', () => {
    expect(validateSave(deepGame(makeSave(), 'population', '1000'))).toBeNull()
  })

  it('rejects a string tier', () => {
    expect(validateSave(deepGame(makeSave(), 'tier', '1'))).toBeNull()
  })

  it('rejects a string lastTickAt', () => {
    expect(
      validateSave(deepGame(makeSave(), 'lastTickAt', '1700000000000')),
    ).toBeNull()
  })

  it('rejects a string level value inside levels', () => {
    const save = makeSave()
    const bad = {
      ...save,
      game: {
        ...save.game,
        levels: { ...save.game.levels, housing: '3' },
      },
    }
    expect(validateSave(bad)).toBeNull()
  })

  it('rejects a string schemaVersion', () => {
    expect(validateSave({ ...makeSave(), schemaVersion: '1' })).toBeNull()
  })
})

describe('P1-T04-C corrupt-save matrix — null and missing structure', () => {
  it('rejects null wallet fields (the JSON round-trip form of NaN)', () => {
    const save = makeSave()
    for (const field of ['credits', 'alloys', 'population', 'garrison', 'fleet'] as const) {
      expect(validateSave(deepGame(save, field, null)), field).toBeNull()
    }
  })

  it('rejects a missing game object', () => {
    const save = makeSave()
    expect(validateSave({ ...save, game: undefined })).toBeNull()
  })

  it('rejects a missing levels object', () => {
    const save = makeSave()
    const game = { ...save.game } as { levels?: unknown }
    delete game.levels
    expect(validateSave({ ...save, game })).toBeNull()
  })

  it('rejects a missing wallet field (fleet omitted entirely)', () => {
    const save = makeSave()
    const game = { ...save.game } as { fleet?: number }
    delete game.fleet
    expect(validateSave({ ...save, game })).toBeNull()
  })

  it('rejects a missing lastTickAt field', () => {
    const save = makeSave()
    const game = { ...save.game } as { lastTickAt?: number }
    delete game.lastTickAt
    expect(validateSave({ ...save, game })).toBeNull()
  })

  it('loadSave reports corrupt for a save that carried a NaN through stringify/parse', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      SAVE_KEY,
      JSON.stringify(deepGame(makeSave(), 'credits', Number.NaN)),
    )
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('loadSave reports corrupt for raw JSON containing a NaN token', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, '{"schemaVersion":1,"game":{"credits":NaN}}')
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('loadSave rejects an unknown structure id in levels (strict, not a lenient drop)', () => {
    const storage = new MemoryStorage()
    seedSave(
      storage,
      makeSave({
        game: { levels: { wormhole: 1 } as unknown as Record<string, never> },
      }),
    )
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })
})

describe('P1-T04-C corrupt-save matrix — lenient additive defaults', () => {
  it('defaults a missing savedAt to 0', () => {
    const save = makeSave()
    const { savedAt: _omit, ...rest } = save
    const validated = validateSave(rest)
    expect(validated).not.toBeNull()
    expect(validated!.savedAt).toBe(0)
  })

  it('defaults a non-finite savedAt to 0', () => {
    expect(validateSave({ ...makeSave(), savedAt: Number.NaN })!.savedAt).toBe(0)
    expect(
      validateSave({ ...makeSave(), savedAt: Number.POSITIVE_INFINITY })!.savedAt,
    ).toBe(0)
  })

  it('clamps an out-of-range tutorial step to 0 leniently', () => {
    for (const step of [99, -1, 2.5, '2']) {
      const validated = validateSave({
        ...makeSave(),
        tutorial: {
          step: step as number,
          done: false,
          skipped: false,
        },
      })
      expect(validated, String(step)).not.toBeNull()
      expect(validated!.tutorial.step, String(step)).toBe(0)
    }
  })

  it('defaults non-boolean tutorial done/skipped to false', () => {
    const validated = validateSave({
      ...makeSave(),
      tutorial: {
        step: 2,
        done: 'yes' as unknown as boolean,
        skipped: 1 as unknown as boolean,
      },
    })
    expect(validated).not.toBeNull()
    expect(validated!.tutorial.done).toBe(false)
    expect(validated!.tutorial.skipped).toBe(false)
  })

  it('defaults a missing tutorial and offlineSummarySeen (regression of the additive contract)', () => {
    const save = makeSave()
    const { tutorial: _t, offlineSummarySeen: _o, ...rest } = save
    const validated = validateSave(rest)
    expect(validated).not.toBeNull()
    expect(validated!.tutorial).toEqual({ step: 0, done: false, skipped: false })
    expect(validated!.offlineSummarySeen).toBe(false)
  })

  it('defaults a missing single level key to 0 (forward-compat additive)', () => {
    const save = makeSave()
    const game = { ...save.game }
    delete (game.levels as Record<string, number>).defenseTurret
    const validated = validateSave({ ...save, game })
    expect(validated).not.toBeNull()
    expect(validated!.game.levels.defenseTurret).toBe(0)
    expect(validated!.game.levels.oreMine).toBe(0)
  })
})
