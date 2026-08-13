import { describe, expect, it } from 'vitest'
import type { BodyId } from '../src/sim/world/identity'
import { bodyId, systemId } from '../src/sim/world/identity'
import type { OwnershipEvent, OwnershipRecord } from '../src/sim/player/ownership'
import {
  currentOwner,
  historyAppend,
  ownershipFor,
  ownershipHistory,
} from '../src/sim/player/ownership'
import { emptyStructureLevels } from '../src/sim/player/grid'
import type { StructureId } from '../src/sim/structures/types'
import type { StructureGrid } from '../src/sim/player/types'
import type {
  ConquestTransferInput,
  ConquestTransferRejection,
  ConquestTransferResult,
  SurvivalRules,
  TransferOutcome,
} from '../src/sim/player/transfer'
import {
  applySurvival,
  conquestTransfer,
  structureSurvivors,
} from '../src/sim/player/transfer'

const TARGET: BodyId = bodyId(systemId('alpha', '42'), 'planet', 2)
const OWNER_A = 'player-a'
const OWNER_B = 'player-b'
const CLAIMED_AT = 1_690_000_000_000
const NOW = 1_700_000_000_000

const OLD_EVENT: OwnershipEvent = {
  bodyId: TARGET,
  fromOwnerId: null,
  toOwnerId: OWNER_A,
  at: CLAIMED_AT,
  method: 'colonisation',
}

function colonyRecord(overrides: Partial<OwnershipRecord> = {}): OwnershipRecord {
  return {
    ...ownershipFor(TARGET, OWNER_A, null, CLAIMED_AT, 'colonisation', false, false),
    ...overrides,
  }
}

function protectedHome(): OwnershipRecord {
  return ownershipFor(TARGET, OWNER_A, null, CLAIMED_AT, 'home-assignment', true, true)
}

function structureGrid(overrides: Partial<Record<StructureId, number>>): StructureGrid {
  return { ...emptyStructureLevels(), ...overrides }
}

function makeInput(overrides: Partial<ConquestTransferInput> = {}): ConquestTransferInput {
  return {
    record: colonyRecord(),
    toOwnerId: OWNER_B,
    at: NOW,
    survival: {
      populationSurvival: 0.5,
      structureSurvival: 0.25,
      garrisonSurvival: 0.75,
    },
    structures: structureGrid({ oreMine: 5, housing: 10 }),
    previousHistory: [],
    current: { population: 1_000, garrison: 200 },
    ...overrides,
  }
}

function outcome(result: ConquestTransferResult): TransferOutcome {
  if ('ok' in result) {
    throw new Error(`expected a TransferOutcome, got rejection: ${result.reason}`)
  }
  return result
}

function rejection(result: ConquestTransferResult): ConquestTransferRejection {
  if (!('ok' in result)) {
    throw new Error('expected a rejection, got success')
  }
  return result
}

describe('P2-T07 conquestTransfer — eligibility ladder', () => {
  it('rejects an unconquerable (protected) record with ok:false reason protected', () => {
    const result = conquestTransfer(makeInput({ record: protectedHome() }))
    const rejected = rejection(result)
    expect(rejected.ok).toBe(false)
    expect(rejected.reason).toBe('protected')
  })

  it('guards on unconquerable alone: protected iff isHome AND unconquerable (finding 3)', () => {
    const protectedParityCorrect: OwnershipRecord = {
      bodyId: TARGET,
      ownerId: OWNER_A,
      previousOwnerId: null,
      acquiredAt: CLAIMED_AT,
      acquisitionMethod: 'home-assignment',
      isHome: true,
      unconquerable: true,
    }
    expect(
      rejection(conquestTransfer(makeInput({ record: protectedParityCorrect })))
        .reason,
    ).toBe('protected')
  })

  it('rejects an unequal-flag record with a throw before any ladder decision (finding 3 parity gate)', () => {
    const nonCanonical: OwnershipRecord = {
      bodyId: TARGET,
      ownerId: OWNER_A,
      previousOwnerId: null,
      acquiredAt: CLAIMED_AT,
      acquisitionMethod: 'home-assignment',
      isHome: false,
      unconquerable: true,
    }
    expect(() => conquestTransfer(makeInput({ record: nonCanonical }))).toThrow(
      /parity/,
    )
    expect(() =>
      conquestTransfer(
        makeInput({ record: { ...colonyRecord(), isHome: true } }),
      ),
    ).toThrow(/parity/)
  })

  it('rejects a transfer to the current owner with ok:false reason self-transfer', () => {
    const result = conquestTransfer(makeInput({ toOwnerId: OWNER_A }))
    const rejected = rejection(result)
    expect(rejected.ok).toBe(false)
    expect(rejected.reason).toBe('self-transfer')
  })

  it('reports protected before self-transfer when both apply', () => {
    const result = conquestTransfer(
      makeInput({ record: protectedHome(), toOwnerId: OWNER_A }),
    )
    expect(rejection(result).reason).toBe('protected')
  })

  it('returns the ladder rejections instead of throwing', () => {
    expect(() => conquestTransfer(makeInput({ record: protectedHome() }))).not.toThrow()
    expect(() => conquestTransfer(makeInput({ toOwnerId: OWNER_A }))).not.toThrow()
  })

  it('throws RangeError for an invalid at or empty toOwnerId (not ladder reasons)', () => {
    for (const badAt of [0, -5, NaN, Infinity]) {
      expect(() => conquestTransfer(makeInput({ at: badAt }))).toThrow(RangeError)
    }
    for (const badTo of ['', '   ']) {
      expect(() => conquestTransfer(makeInput({ toOwnerId: badTo }))).toThrow(RangeError)
    }
  })
})

describe('P2-T07 conquestTransfer — success record/event', () => {
  it('returns a complete TransferOutcome on success', () => {
    const result = outcome(conquestTransfer(makeInput()))
    expect(result.record).toBeDefined()
    expect(result.event).toBeDefined()
    expect(result.survivors).toBeDefined()
    expect(result.structures).toBeDefined()
    expect(Array.isArray(result.notifications)).toBe(true)
  })

  it('updates the record: new owner, previous owner, at, method conquest', () => {
    const result = outcome(conquestTransfer(makeInput()))
    expect(result.record.ownerId).toBe(OWNER_B)
    expect(result.record.previousOwnerId).toBe(OWNER_A)
    expect(result.record.acquiredAt).toBe(NOW)
    expect(result.record.acquisitionMethod).toBe('conquest')
    expect(result.record.bodyId).toBe(TARGET)
  })

  it('carries isHome/unconquerable through a permitted conquest unchanged (parity preserved)', () => {
    const conquerable = colonyRecord()
    const result = outcome(conquestTransfer(makeInput({ record: conquerable })))
    expect(result.record.isHome).toBe(false)
    expect(result.record.unconquerable).toBe(false)
    expect(result.record.isHome).toBe(result.record.unconquerable)
  })

  it('emits the audit event mirroring the transfer', () => {
    const result = outcome(conquestTransfer(makeInput()))
    expect(result.event.bodyId).toBe(TARGET)
    expect(result.event.fromOwnerId).toBe(OWNER_A)
    expect(result.event.toOwnerId).toBe(OWNER_B)
    expect(result.event.at).toBe(NOW)
    expect(result.event.method).toBe('conquest')
  })
})

describe('P2-T07 conquestTransfer — survivor math', () => {
  it('applies Math.round survival to population and garrison', () => {
    const result = outcome(conquestTransfer(makeInput()))
    expect(result.survivors).toEqual({ population: 500, garrison: 150 })
  })

  it('rounds halves up (500.5 -> 501)', () => {
    const result = outcome(
      conquestTransfer(
        makeInput({
          current: { population: 1_001, garrison: 1 },
          survival: {
            populationSurvival: 0.5,
            structureSurvival: 1,
            garrisonSurvival: 0.5,
          },
        }),
      ),
    )
    expect(result.survivors).toEqual({ population: 501, garrison: 1 })
  })

  it('produces zero survivors when every survival fraction is 0', () => {
    const result = outcome(
      conquestTransfer(
        makeInput({
          current: { population: 5_000, garrison: 900 },
          survival: {
            populationSurvival: 0,
            structureSurvival: 0,
            garrisonSurvival: 0,
          },
        }),
      ),
    )
    expect(result.survivors).toEqual({ population: 0, garrison: 0 })
  })

  it('keeps population and garrison intact at full survival', () => {
    const result = outcome(
      conquestTransfer(
        makeInput({
          current: { population: 4_200, garrison: 333 },
          survival: {
            populationSurvival: 1,
            structureSurvival: 1,
            garrisonSurvival: 1,
          },
        }),
      ),
    )
    expect(result.survivors).toEqual({ population: 4_200, garrison: 333 })
  })
})

describe('P2-T07 conquestTransfer — structure survival', () => {
  it('floors each structure level by the survival fraction', () => {
    const result = outcome(
      conquestTransfer(
        makeInput({
          structures: structureGrid({ oreMine: 5, housing: 10, tradeHub: 3 }),
        }),
      ),
    )
    expect(result.structures).toEqual({ oreMine: 1, housing: 2 })
  })

  it('drops structure levels that floor to zero', () => {
    const result = outcome(
      conquestTransfer(
        makeInput({
          structures: structureGrid({ barracks: 1, shipyard: 2 }),
          survival: {
            populationSurvival: 0.5,
            structureSurvival: 0.1,
            garrisonSurvival: 0.75,
          },
        }),
      ),
    )
    expect(result.structures).toEqual({})
  })

  it('handles an empty structures grid', () => {
    const result = outcome(conquestTransfer(makeInput({ structures: structureGrid({}) })))
    expect(result.structures).toEqual({})
  })

  it('never mutates the input structures grid and returns a fresh grid', () => {
    const structures = structureGrid({ oreMine: 5, housing: 10 })
    const result = outcome(conquestTransfer(makeInput({ structures })))
    expect(structures).toEqual(structureGrid({ oreMine: 5, housing: 10 }))
    expect(result.structures).not.toBe(structures)
  })

  it('keeps positive levels unchanged at full structure survival', () => {
    const result = outcome(
      conquestTransfer(
        makeInput({
          structures: structureGrid({ oreMine: 5, housing: 10 }),
          survival: {
            populationSurvival: 1,
            structureSurvival: 1,
            garrisonSurvival: 1,
          },
        }),
      ),
    )
    expect(result.structures).toEqual({ oreMine: 5, housing: 10 })
  })
})

describe('P2-T07 conquestTransfer — defense turrets always fall (DESIGN §5)', () => {
  it('destroys defenseTurret at full structure survival (fraction 1) while every other structure survives', () => {
    const result = outcome(
      conquestTransfer(
        makeInput({
          structures: structureGrid({ oreMine: 5, housing: 10, defenseTurret: 7 }),
          survival: {
            populationSurvival: 1,
            structureSurvival: 1,
            garrisonSurvival: 1,
          },
        }),
      ),
    )
    expect(result.structures).toEqual({ oreMine: 5, housing: 10 })
    expect(result.structures.defenseTurret).toBeUndefined()
  })

  it('destroys defenseTurret at fraction 0.5 while other structures halve', () => {
    const result = outcome(
      conquestTransfer(
        makeInput({
          structures: structureGrid({ oreMine: 6, housing: 8, defenseTurret: 7 }),
          survival: {
            populationSurvival: 0.5,
            structureSurvival: 0.5,
            garrisonSurvival: 0.5,
          },
        }),
      ),
    )
    expect(result.structures).toEqual({ oreMine: 3, housing: 4 })
    expect(result.structures.defenseTurret).toBeUndefined()
  })
})

describe('P2-T07 conquestTransfer — previous-owner history', () => {
  it('never mutates the previousHistory array', () => {
    const history = [OLD_EVENT]
    outcome(conquestTransfer(makeInput({ previousHistory: history })))
    expect(history).toEqual([OLD_EVENT])
  })

  it('appends the event cleanly via historyAppend (trail + new owner)', () => {
    const history = [OLD_EVENT]
    const result = outcome(conquestTransfer(makeInput({ previousHistory: history })))
    const appended = historyAppend(history, result.event)
    expect(appended).toEqual([OLD_EVENT, result.event])
    expect(ownershipHistory(appended, TARGET)).toEqual([OLD_EVENT, result.event])
    expect(currentOwner(appended, TARGET)).toBe(OWNER_B)
  })

  it('supports an empty previousHistory', () => {
    const result = outcome(conquestTransfer(makeInput({ previousHistory: [] })))
    expect(historyAppend([], result.event)).toEqual([result.event])
  })
})

describe('P2-T07 conquestTransfer — notifications', () => {
  it('emits exactly two notifications', () => {
    const result = outcome(conquestTransfer(makeInput()))
    expect(result.notifications).toHaveLength(2)
  })

  it('emits ownership-lost before ownership-gained', () => {
    const result = outcome(conquestTransfer(makeInput()))
    expect(result.notifications.map((n) => n.kind)).toEqual([
      'ownership-lost',
      'ownership-gained',
    ])
  })

  it('sends lost to the previous owner and gained to the new owner', () => {
    const result = outcome(conquestTransfer(makeInput()))
    expect(result.notifications[0].ownerId).toBe(OWNER_A)
    expect(result.notifications[1].ownerId).toBe(OWNER_B)
  })

  it('tags both notifications with the body id and transfer time', () => {
    const result = outcome(conquestTransfer(makeInput()))
    for (const notification of result.notifications) {
      expect(notification.bodyId).toBe(TARGET)
      expect(notification.at).toBe(NOW)
    }
  })
})

describe('P2-T07 conquestTransfer — determinism and immutability', () => {
  it('is deterministic: identical inputs yield identical results', () => {
    expect(conquestTransfer(makeInput())).toEqual(conquestTransfer(makeInput()))
  })

  it('never mutates the record, survival or current inputs', () => {
    const record = colonyRecord()
    const survival: SurvivalRules = {
      populationSurvival: 0.5,
      structureSurvival: 0.25,
      garrisonSurvival: 0.75,
    }
    const current = { population: 1_000, garrison: 200 }
    conquestTransfer(makeInput({ record, survival, current }))
    expect(record).toEqual(colonyRecord())
    expect(survival).toEqual({
      populationSurvival: 0.5,
      structureSurvival: 0.25,
      garrisonSurvival: 0.75,
    })
    expect(current).toEqual({ population: 1_000, garrison: 200 })
  })

  it('throws RangeError when any survival fraction is outside [0,1] or non-finite', () => {
    const badSurvivals: SurvivalRules[] = [
      { populationSurvival: 1.5, structureSurvival: 0.25, garrisonSurvival: 0.75 },
      { populationSurvival: -0.1, structureSurvival: 0.25, garrisonSurvival: 0.75 },
      { populationSurvival: 0.5, structureSurvival: 1.01, garrisonSurvival: 0.75 },
      { populationSurvival: 0.5, structureSurvival: 0.25, garrisonSurvival: 2 },
      { populationSurvival: NaN, structureSurvival: 0.25, garrisonSurvival: 0.75 },
      { populationSurvival: 0.5, structureSurvival: Infinity, garrisonSurvival: 0.75 },
    ]
    for (const survival of badSurvivals) {
      expect(() => conquestTransfer(makeInput({ survival }))).toThrow(RangeError)
    }
  })
})

describe('P2-T07 exported helpers — applySurvival and structureSurvivors', () => {
  it('applySurvival clamps the fraction into [0,1] and rounds half up', () => {
    expect(applySurvival(100, 2)).toBe(100)
    expect(applySurvival(100, -0.5)).toBe(0)
    expect(applySurvival(100, 0.5)).toBe(50)
    expect(applySurvival(101, 0.5)).toBe(51)
    expect(applySurvival(100, 1)).toBe(100)
    expect(applySurvival(0, 0.25)).toBe(0)
  })

  it('structureSurvivors floors, drops zeros, stays immutable, and validates the fraction', () => {
    const grid = structureGrid({ oreMine: 5, housing: 1 })
    expect(structureSurvivors(grid, 0.25)).toEqual({ oreMine: 1 })
    expect(grid).toEqual(structureGrid({ oreMine: 5, housing: 1 }))
    expect(structureSurvivors(grid, 0)).toEqual({})
    expect(structureSurvivors(grid, 1)).toEqual({ oreMine: 5, housing: 1 })
    expect(() => structureSurvivors(grid, 1.5)).toThrow(RangeError)
    expect(() => structureSurvivors(grid, -1)).toThrow(RangeError)
  })

  it('structureSurvivors always omits defenseTurret regardless of the fraction (DESIGN §5)', () => {
    const grid = structureGrid({ oreMine: 6, housing: 4, defenseTurret: 9 })
    expect(structureSurvivors(grid, 1)).toEqual({ oreMine: 6, housing: 4 })
    expect(structureSurvivors(grid, 0.5)).toEqual({ oreMine: 3, housing: 2 })
    expect(structureSurvivors(grid, 0)).toEqual({})
  })
})
