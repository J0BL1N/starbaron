import { describe, expect, it } from 'vitest'
import { loadSave, SAVE_V3_KEY, validateSave } from '../src/ui/save'
import { makeSave, MemoryStorage, seedSave } from './saveHelpers'

function deepWallet(
  save: ReturnType<typeof makeSave>,
  field: string,
  value: unknown,
): unknown {
  return {
    ...save,
    player: { ...save.player, wallet: { ...save.player.wallet, [field]: value } },
  }
}

function deepPlayer(
  save: ReturnType<typeof makeSave>,
  field: string,
  value: unknown,
): unknown {
  return { ...save, player: { ...save.player, [field]: value } }
}

function homeName(save: ReturnType<typeof makeSave>): string {
  return save.player.homePlanet.name
}

describe('P2-T04-B corrupt-save matrix — wrong types', () => {
  it('rejects a string credits value', () => {
    expect(validateSave(deepWallet(makeSave(), 'credits', '1200'))).toBeNull()
  })

  it('rejects a string per-planet population value', () => {
    const save = makeSave()
    const bad = {
      ...save,
      player: { ...save.player, homePlanet: { ...save.player.homePlanet, population: '1000' } },
    }
    expect(validateSave(bad)).toBeNull()
  })

  it('rejects a string playerId', () => {
    expect(validateSave(deepPlayer(makeSave(), 'playerId', 42))).toBeNull()
  })

  it('rejects a string lastTickAt', () => {
    expect(
      validateSave(deepPlayer(makeSave(), 'lastTickAt', '1700000000000')),
    ).toBeNull()
  })

  it('rejects a string level value inside a planet grid', () => {
    const save = makeSave()
    const bad = {
      ...save,
      player: {
        ...save.player,
        structureLevels: {
          ...save.player.structureLevels,
          [homeName(save)]: { ...save.player.structureLevels[homeName(save)], housing: '3' },
        },
      },
    }
    expect(validateSave(bad)).toBeNull()
  })

  it('rejects a string schemaVersion', () => {
    expect(validateSave({ ...makeSave(), schemaVersion: '3' })).toBeNull()
  })
})

describe('P2-T04-B corrupt-save matrix — null and missing structure', () => {
  it('rejects null wallet fields (the JSON round-trip form of NaN)', () => {
    const save = makeSave()
    for (const field of ['credits', 'alloys'] as const) {
      expect(validateSave(deepWallet(save, field, null)), field).toBeNull()
    }
    for (const field of ['population', 'garrison', 'fleet'] as const) {
      expect(validateSave(deepWallet(save, field, null)), field).toBeNull()
    }
  })

  it('rejects a missing player object', () => {
    const save = makeSave()
    expect(validateSave({ ...save, player: undefined })).toBeNull()
  })

  it('rejects a missing homePlanet object', () => {
    const save = makeSave()
    expect(validateSave(deepPlayer(save, 'homePlanet', undefined))).toBeNull()
  })

  it('rejects a missing wallet object', () => {
    const save = makeSave()
    expect(validateSave(deepPlayer(save, 'wallet', undefined))).toBeNull()
  })

  it('rejects a wallet that carries legacy per-planet fields', () => {
    const save = makeSave()
    const wallet = { credits: 1_000, alloys: 0, fleet: 0 }
    expect(validateSave(deepPlayer(save, 'wallet', wallet))).toBeNull()
  })

  it('rejects a missing colonies array', () => {
    const save = makeSave()
    expect(validateSave(deepPlayer(save, 'colonies', undefined))).toBeNull()
  })

  it('rejects a missing structureLevels object', () => {
    const save = makeSave()
    expect(validateSave(deepPlayer(save, 'structureLevels', undefined))).toBeNull()
  })

  it('rejects a missing lastTickAt field', () => {
    const save = makeSave()
    expect(validateSave(deepPlayer(save, 'lastTickAt', undefined))).toBeNull()
  })

  it('loadSave reports corrupt for a save that carried a NaN through stringify/parse', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      SAVE_V3_KEY,
      JSON.stringify(deepWallet(makeSave(), 'credits', Number.NaN)),
    )
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('loadSave reports corrupt for raw JSON containing a NaN token', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V3_KEY, '{"schemaVersion":3,"player":{"credits":NaN}}')
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('loadSave rejects an unknown structure id inside a grid (strict, not a lenient drop)', () => {
    const storage = new MemoryStorage()
    seedSave(
      storage,
      makeSave({
        player: {
          structureLevels: {
            [homeName(makeSave())]: {
              wormhole: 1,
            } as unknown as Record<string, never>,
          },
        },
      }),
    )
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('loadSave reports corrupt for a malformed legacy v1 key too', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V3_KEY, '')
    storage.setItem(
      'starbaron.save.v1',
      '{"schemaVersion":1,"game":{"credits":NaN}}',
    )
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })
})

describe('P2-T04-B corrupt-save matrix — lenient additive defaults', () => {
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

  it('defaults a missing single grid key to 0 (forward-compat additive)', () => {
    const save = makeSave()
    const name = homeName(save)
    const grid = { ...save.player.structureLevels[name] }
    delete (grid as Record<string, number>).defenseTurret
    const validated = validateSave({
      ...save,
      player: { ...save.player, structureLevels: { ...save.player.structureLevels, [name]: grid } },
    })
    expect(validated).not.toBeNull()
    expect(validated!.player.structureLevels[name].defenseTurret).toBe(0)
    expect(validated!.player.structureLevels[name].oreMine).toBe(0)
  })
})
