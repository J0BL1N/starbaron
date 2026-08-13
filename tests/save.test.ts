import { describe, expect, it } from 'vitest'
import { claimColony, claimHomePlanet, emptyStructureLevels } from '../src/sim/player'
import { PLANETS } from '../src/sim/data/planets'
import { eligibleHomeWorlds } from '../src/sim/player/claim'
import type { BodyId } from '../src/sim/world/identity'
import {
  loadSave,
  MIGRATIONS,
  SAVE_KEY,
  SAVE_SCHEMA_VERSION,
  SAVE_V3_KEY,
  saveGame,
  validateSave,
} from '../src/ui/save'
import {
  makeSave,
  MemoryStorage,
  seedSave,
  TEST_PLAYER_ID,
} from './saveHelpers'
import type { StructureId } from '../src/sim/structures/types'

const ELIGIBLE = eligibleHomeWorlds(PLANETS)
const NO_TAKEN: ReadonlySet<BodyId> = new Set<BodyId>()

function deepPlayer(
  save: ReturnType<typeof makeSave>,
  field: string,
  value: unknown,
): unknown {
  return { ...save, player: { ...save.player, [field]: value } }
}

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

function homeGrid(save: ReturnType<typeof makeSave>): Record<StructureId, number> {
  const name = save.player.homePlanet.name
  return save.player.structureLevels[name]
}

describe('P2-T04-B save v3 — round-trip', () => {
  it('validates a well-formed v3 save and preserves every field', () => {
    const save = makeSave({
      savedAt: 1_700_000_000_000,
      player: {
        wallet: {
          credits: 12_345,
          alloys: 67,
        },
        lastTickAt: 1_700_000_000_000,
      },
      tutorial: { step: 2, done: false, skipped: false },
      offlineSummarySeen: true,
    })
    const validated = validateSave(save)
    expect(validated).not.toBeNull()
    expect(validated).toEqual({
      schemaVersion: 3,
      savedAt: 1_700_000_000_000,
      player: {
        playerId: TEST_PLAYER_ID,
        homePlanet: save.player.homePlanet,
        colonies: [],
        wallet: {
          credits: 12_345,
          alloys: 67,
        },
        structureLevels: save.player.structureLevels,
        lastTickAt: 1_700_000_000_000,
      },
      tutorial: { step: 2, done: false, skipped: false },
      offlineSummarySeen: true,
    })
  })

  it('saveGame writes the v3 key and loadSave reads back the same save', () => {
    const storage = new MemoryStorage()
    const save = makeSave({ player: { wallet: { credits: 4_200 } } })
    save.player.structureLevels[save.player.homePlanet.name].housing = 3
    expect(saveGame(save, storage)).toBe(true)

    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.wallet.credits).toBe(4_200)
      expect(
        result.save.player.structureLevels[result.save.player.homePlanet.name]
          .housing,
      ).toBe(3)
      expect(result.save.player.homePlanet.population).toBe(1_000)
      expect(result.save.offlineSummarySeen).toBe(false)
      expect(result.save.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
    }
  })

  it('loadSave returns absent for an empty storage and for a null adapter', () => {
    expect(loadSave(new MemoryStorage())).toEqual({ kind: 'absent' })
    expect(loadSave(null)).toEqual({ kind: 'absent' })
  })
})

describe('P2-T04-B save v3 — validation', () => {
  it('rejects a missing or mismatched schemaVersion', () => {
    const save = makeSave()
    expect(validateSave({ ...save, schemaVersion: undefined })).toBeNull()
    expect(validateSave({ ...save, schemaVersion: 1 })).toBeNull()
    expect(validateSave({ ...save, schemaVersion: 2 })).toBeNull()
    expect(validateSave({ ...save, schemaVersion: 4 })).toBeNull()
  })

  it('rejects a missing, empty or non-string playerId', () => {
    expect(validateSave(deepPlayer(makeSave(), 'playerId', undefined))).toBeNull()
    expect(validateSave(deepPlayer(makeSave(), 'playerId', ''))).toBeNull()
    expect(validateSave(deepPlayer(makeSave(), 'playerId', 42))).toBeNull()
  })

  it('rejects a missing homePlanet or one with a corrupt entry', () => {
    expect(validateSave(deepPlayer(makeSave(), 'homePlanet', undefined))).toBeNull()

    const save = makeSave()
    const mismatchedEntry = {
      ...save,
      player: {
        ...save.player,
        homePlanet: { ...save.player.homePlanet, entry: { ...save.player.homePlanet.entry, name: 'other' } },
      },
    }
    expect(validateSave(mismatchedEntry)).toBeNull()

    const tierMismatch = {
      ...save,
      player: {
        ...save.player,
        homePlanet: { ...save.player.homePlanet, tier: 3 },
      },
    }
    expect(validateSave(tierMismatch)).toBeNull()
  })

  it('rejects a home planet name that is not in the catalogue', () => {
    const save = makeSave()
    const fabricated = {
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
    expect(validateSave(fabricated)).toBeNull()
  })

  it('rejects a home planet whose derived stats do not match its catalogue entry', () => {
    const save = makeSave()
    const badIncome = {
      ...save,
      player: {
        ...save.player,
        homePlanet: { ...save.player.homePlanet, baselineIncomePerSec: 9_999 },
      },
    }
    const badPopCap = {
      ...save,
      player: {
        ...save.player,
        homePlanet: { ...save.player.homePlanet, populationCapMultiplier: 42 },
      },
    }
    expect(validateSave(badIncome)).toBeNull()
    expect(validateSave(badPopCap)).toBeNull()
  })

  it('rejects a colony whose name is not in the catalogue', () => {
    const save = makeSave()
    const fabricatedColony = {
      ...save,
      player: {
        ...save.player,
        colonies: [
          {
            ...save.player.homePlanet,
            name: 'Fabricated Colony Y',
            entry: {
              ...save.player.homePlanet.entry,
              name: 'Fabricated Colony Y',
            },
            isHome: false,
            unconquerable: false,
          },
        ],
      },
    }
    expect(validateSave(fabricatedColony)).toBeNull()
  })

  it('rejects a home planet that is not marked isHome and unconquerable', () => {
    const save = makeSave()
    const notHome = {
      ...save,
      player: {
        ...save.player,
        homePlanet: { ...save.player.homePlanet, isHome: false },
      },
    }
    const conquerableHome = {
      ...save,
      player: {
        ...save.player,
        homePlanet: { ...save.player.homePlanet, unconquerable: false },
      },
    }
    expect(validateSave(notHome)).toBeNull()
    expect(validateSave(conquerableHome)).toBeNull()
  })

  it('rejects a colony that duplicates the home planet or another colony, or claims isHome', () => {
    const home = makeSave().player.homePlanet
    const dupHome = {
      ...makeSave(),
      player: { ...makeSave().player, colonies: [home] },
    }
    expect(validateSave(dupHome)).toBeNull()

    const colony = claimColony(
      claimHomePlanet('another-player', 1_700_000_000_000, ELIGIBLE, NO_TAKEN).entry,
      1_700_000_000_000,
    )
    const dupColony = {
      ...makeSave(),
      player: {
        ...makeSave().player,
        colonies: [colony, colony],
      },
    }
    expect(validateSave(dupColony)).toBeNull()

    const homeClaimingColony = {
      ...makeSave(),
      player: {
        ...makeSave().player,
        colonies: [{ ...colony, isHome: true, unconquerable: true }],
      },
    }
    expect(validateSave(homeClaimingColony)).toBeNull()
  })

  it('rejects negative or non-finite wallet fields and legacy per-planet fields', () => {
    const save = makeSave()
    for (const field of ['credits', 'alloys'] as const) {
      expect(validateSave(deepWallet(save, field, -1))).toBeNull()
      expect(validateSave(deepWallet(save, field, Number.NaN))).toBeNull()
      expect(validateSave(deepWallet(save, field, Number.POSITIVE_INFINITY))).toBeNull()
    }
    for (const field of ['population', 'garrison', 'fleet'] as const) {
      expect(validateSave(deepWallet(save, field, 0))).toBeNull()
    }
  })

  it('rejects negative or non-finite per-planet population/garrison/fleet', () => {
    const save = makeSave()
    for (const field of ['population', 'garrison', 'fleet'] as const) {
      const bad = {
        ...save,
        player: {
          ...save.player,
          homePlanet: { ...save.player.homePlanet, [field]: -1 },
        },
      }
      expect(validateSave(bad), field).toBeNull()
      const nan = {
        ...save,
        player: {
          ...save.player,
          homePlanet: { ...save.player.homePlanet, [field]: Number.NaN },
        },
      }
      expect(validateSave(nan), field).toBeNull()
    }
  })

  it('rejects an unknown structure key inside a planet grid', () => {
    const save = makeSave()
    const name = save.player.homePlanet.name
    const bad = {
      ...save,
      player: {
        ...save.player,
        structureLevels: {
          ...save.player.structureLevels,
          [name]: { ...homeGrid(save), wormhole: 1 },
        },
      },
    }
    expect(validateSave(bad)).toBeNull()
  })

  it('rejects a non-integer or negative level value inside a grid', () => {
    const save = makeSave()
    const name = save.player.homePlanet.name
    const badFraction = {
      ...save,
      player: {
        ...save.player,
        structureLevels: {
          ...save.player.structureLevels,
          [name]: { ...homeGrid(save), housing: 0.5 },
        },
      },
    }
    const badNegative = {
      ...save,
      player: {
        ...save.player,
        structureLevels: {
          ...save.player.structureLevels,
          [name]: { ...homeGrid(save), housing: -2 },
        },
      },
    }
    expect(validateSave(badFraction)).toBeNull()
    expect(validateSave(badNegative)).toBeNull()
  })

  it('rejects a grid key that is not an owned planet name', () => {
    const save = makeSave()
    const bad = {
      ...save,
      player: {
        ...save.player,
        structureLevels: {
          ...save.player.structureLevels,
          'Not Owned Planet': { ...emptyStructureLevels(), housing: 1 },
        },
      },
    }
    expect(validateSave(bad)).toBeNull()
  })

  it('rejects a missing or non-finite lastTickAt', () => {
    expect(validateSave(deepPlayer(makeSave(), 'lastTickAt', undefined))).toBeNull()
    expect(validateSave(deepPlayer(makeSave(), 'lastTickAt', Number.NaN))).toBeNull()
  })

  it('is lenient on additive fields: missing grid keys and tutorial default safely', () => {
    const save = makeSave()
    const name = save.player.homePlanet.name
    const grid = { ...homeGrid(save) }
    delete (grid as Record<string, number>).oreMine
    const missingLevel = {
      ...save,
      player: {
        ...save.player,
        structureLevels: { ...save.player.structureLevels, [name]: grid },
      },
    }
    const validated = validateSave(missingLevel)
    expect(validated).not.toBeNull()
    expect(validated!.player.structureLevels[name].oreMine).toBe(0)
    // Fresh saves carry the starter grid (housing 1 — phase-2 locked contract);
    // the lenient loader preserves present keys, only missing keys normalize to 0.
    expect(validated!.player.structureLevels[name].housing).toBe(1)

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

describe('P2-T04-B save v3 — storage-level results', () => {
  it('loadSave reports corrupt for unparseable JSON', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_V3_KEY, 'not json{{')
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('loadSave reports future for a schemaVersion above the current one', () => {
    const storage = new MemoryStorage()
    const future = { ...makeSave(), schemaVersion: SAVE_SCHEMA_VERSION + 1 }
    seedSave(storage, future as unknown as ReturnType<typeof makeSave>)
    expect(loadSave(storage)).toEqual({
      kind: 'future',
      version: SAVE_SCHEMA_VERSION + 1,
    })
  })

  it('loadSave reports corrupt for a structurally invalid save', () => {
    const storage = new MemoryStorage()
    seedSave(storage, makeSave({ player: { wallet: { credits: -50 } } }))
    expect(loadSave(storage)).toEqual({ kind: 'corrupt' })
  })

  it('saveGame returns false when storage writes fail', () => {
    const storage = new MemoryStorage()
    storage.setItem = () => {
      throw new Error('quota')
    }
    expect(saveGame(makeSave(), storage)).toBe(false)
  })

  it('loadSave probes the v3 key first and ignores a stale v1 key when both exist', () => {
    const storage = new MemoryStorage()
    seedSave(storage, makeSave({ player: { wallet: { credits: 9_999 } } }))
    const staleV1 = {
      schemaVersion: 1,
      savedAt: 1,
      game: {
        tier: 1,
        credits: 1,
        alloys: 0,
        population: 1_000,
        garrison: 0,
        fleet: 0,
        levels: {},
        lastTickAt: 1,
      },
      tutorial: { step: 0, done: false, skipped: false },
      offlineSummarySeen: false,
    }
    storage.setItem(SAVE_KEY, JSON.stringify(staleV1))
    const result = loadSave(storage)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.save.player.wallet.credits).toBe(9_999)
    }
  })
})

describe('P2-T04-B migration mechanism', () => {
  it('ships a v1->v2 and v2->v3 migration entry', () => {
    expect(typeof MIGRATIONS[1]).toBe('function')
    expect(typeof MIGRATIONS[2]).toBe('function')
  })
})
