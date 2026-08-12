import { describe, expect, it } from 'vitest'
import type { BodyId } from '../src/sim/world/identity'
import { bodyId, systemId } from '../src/sim/world/identity'
import type {
  AcquisitionMethod,
  OwnershipEvent,
  OwnershipRecord,
} from '../src/sim/player/ownership'
import {
  currentOwner,
  historyAppend,
  ownershipFor,
  ownershipHistory,
  transferOwnership,
} from '../src/sim/player/ownership'

const HOME_BODY: BodyId = bodyId(systemId('alpha', '42'), 'planet', 1)
const COLONY_BODY: BodyId = bodyId(systemId('alpha', '42'), 'planet', 2)
const BODY_3: BodyId = bodyId(systemId('beta', '7'), 'planet', 1)
const OWNER_A = 'player-a'
const OWNER_B = 'player-b'
const OWNER_C = 'player-c'
const NOW = 1_700_000_000_000
const LATER = NOW + 60_000

function homeRecord(overrides: Partial<OwnershipRecord> = {}): OwnershipRecord {
  return {
    ...ownershipFor(HOME_BODY, OWNER_A, null, NOW, 'home-assignment', true, true),
    ...overrides,
  }
}

function colonyRecord(overrides: Partial<OwnershipRecord> = {}): OwnershipRecord {
  return {
    ...ownershipFor(COLONY_BODY, OWNER_A, null, NOW, 'colonisation', false, false),
    ...overrides,
  }
}

describe('P2-T04 ownershipFor — input validation', () => {
  it('rejects an acquiredAt that is not a finite number greater than 0', () => {
    for (const bad of [0, -5, NaN, Infinity, -Infinity, '1700000000000']) {
      expect(() =>
        ownershipFor(
          HOME_BODY,
          OWNER_A,
          null,
          bad as unknown as number,
          'home-assignment',
          true,
          true,
        ),
      ).toThrow(RangeError)
    }
  })

  it('rejects an empty ownerId', () => {
    expect(() =>
      ownershipFor(HOME_BODY, '', null, NOW, 'home-assignment', true, true),
    ).toThrow(RangeError)
    expect(() =>
      ownershipFor(HOME_BODY, '   ', null, NOW, 'home-assignment', true, true),
    ).toThrow(RangeError)
    expect(() =>
      ownershipFor(
        HOME_BODY,
        42 as unknown as string,
        null,
        NOW,
        'home-assignment',
        true,
        true,
      ),
    ).toThrow(RangeError)
  })

  it('rejects a previousOwnerId equal to the ownerId', () => {
    expect(() =>
      ownershipFor(COLONY_BODY, OWNER_B, OWNER_B, NOW, 'trade', false, false),
    ).toThrow(RangeError)
  })

  it('rejects an acquisition method outside the union', () => {
    for (const bad of ['gift', 'inheritance', '']) {
      expect(() =>
        ownershipFor(
          COLONY_BODY,
          OWNER_A,
          null,
          NOW,
          bad as unknown as AcquisitionMethod,
          false,
          false,
        ),
      ).toThrow(RangeError)
    }
  })

  it('rejects isHome unless the method is home-assignment', () => {
    for (const method of ['colonisation', 'conquest', 'trade'] as const) {
      expect(() =>
        ownershipFor(HOME_BODY, OWNER_A, null, NOW, method, true, false),
      ).toThrow(/isHome/)
    }
  })

  it('rejects unconquerable without isHome', () => {
    expect(() =>
      ownershipFor(COLONY_BODY, OWNER_A, null, NOW, 'conquest', false, true),
    ).toThrow(/unconquerable/)
  })

  it('rejects isHome without unconquerable (exact parity — a home is always protected)', () => {
    expect(() =>
      ownershipFor(HOME_BODY, OWNER_A, null, NOW, 'home-assignment', true, false),
    ).toThrow(/isHome requires unconquerable/)
  })

  it('rejects both parity violations, so a declassified record is impossible by construction', () => {
    const cases: Array<{
      method: AcquisitionMethod
      isHome: boolean
      unconquerable: boolean
    }> = [
      { method: 'home-assignment', isHome: true, unconquerable: false },
      { method: 'conquest', isHome: false, unconquerable: true },
    ]
    for (const test of cases) {
      expect(() =>
        ownershipFor(
          COLONY_BODY,
          OWNER_A,
          null,
          NOW,
          test.method,
          test.isHome,
          test.unconquerable,
        ),
      ).toThrow(RangeError)
    }
  })

  it('rejects a malformed body id', () => {
    for (const bad of ['', 'gal:alpha', 'sys:alpha|42', 'body:alpha|42|planet|abc']) {
      expect(() =>
        ownershipFor(
          bad as unknown as BodyId,
          OWNER_A,
          null,
          NOW,
          'colonisation',
          false,
          false,
        ),
      ).toThrow(RangeError)
    }
  })
})

describe('P2-T04 ownershipFor — record construction', () => {
  it('builds a home record with null previous owner and home-assignment', () => {
    const record = ownershipFor(
      HOME_BODY,
      OWNER_A,
      null,
      NOW,
      'home-assignment',
      true,
      true,
    )
    expect(record).toStrictEqual({
      bodyId: HOME_BODY,
      ownerId: OWNER_A,
      previousOwnerId: null,
      acquiredAt: NOW,
      acquisitionMethod: 'home-assignment',
      isHome: true,
      unconquerable: true,
    })
  })

  it('builds a colony record with a null previous owner', () => {
    const record = ownershipFor(COLONY_BODY, OWNER_A, null, NOW, 'colonisation', false, false)
    expect(record.ownerId).toBe(OWNER_A)
    expect(record.previousOwnerId).toBeNull()
    expect(record.acquisitionMethod).toBe('colonisation')
    expect(record.isHome).toBe(false)
    expect(record.unconquerable).toBe(false)
  })

  it('accepts a previous owner on a trade acquisition', () => {
    const record = ownershipFor(COLONY_BODY, OWNER_B, OWNER_A, LATER, 'trade', false, false)
    expect(record.ownerId).toBe(OWNER_B)
    expect(record.previousOwnerId).toBe(OWNER_A)
    expect(record.acquisitionMethod).toBe('trade')
    expect(record.acquiredAt).toBe(LATER)
  })

  it('is deterministic and returns a fresh object per call', () => {
    const a = ownershipFor(COLONY_BODY, OWNER_A, null, NOW, 'colonisation', false, false)
    const b = ownershipFor(COLONY_BODY, OWNER_A, null, NOW, 'colonisation', false, false)
    expect(a).toStrictEqual(b)
    expect(a).not.toBe(b)
  })
})

describe('P2-T04 transferOwnership — transfers and audit events', () => {
  it('produces the updated record with new owner, previous owner, timestamp and method', () => {
    const { updated } = transferOwnership(colonyRecord(), OWNER_B, LATER, 'trade')
    expect(updated.ownerId).toBe(OWNER_B)
    expect(updated.previousOwnerId).toBe(OWNER_A)
    expect(updated.acquiredAt).toBe(LATER)
    expect(updated.acquisitionMethod).toBe('trade')
  })

  it('produces a matching audit event', () => {
    const { updated, event } = transferOwnership(colonyRecord(), OWNER_B, LATER, 'trade')
    expect(event).toStrictEqual({
      bodyId: COLONY_BODY,
      fromOwnerId: OWNER_A,
      toOwnerId: OWNER_B,
      at: LATER,
      method: 'trade',
    })
    expect(updated.bodyId).toBe(event.bodyId)
  })

  it('carries bodyId, isHome and unconquerable through unchanged', () => {
    const record = colonyRecord()
    const { updated } = transferOwnership(record, OWNER_B, LATER, 'conquest')
    expect(updated.bodyId).toBe(COLONY_BODY)
    expect(updated.isHome).toBe(false)
    expect(updated.unconquerable).toBe(false)
  })

  it('does not mutate the input record', () => {
    const record = colonyRecord()
    const before = { ...record }
    transferOwnership(record, OWNER_B, LATER, 'conquest')
    expect(record).toStrictEqual(before)
  })

  it('throws when the record is unconquerable (protected — P2-T03 integration)', () => {
    expect(() =>
      transferOwnership(homeRecord(), OWNER_B, LATER, 'conquest'),
    ).toThrow(/unconquerable/)
  })

  it('rejects an unequal-flag record before any transfer decision (finding 3 parity gate)', () => {
    expect(() =>
      transferOwnership(
        homeRecord({ unconquerable: false }),
        OWNER_B,
        LATER,
        'conquest',
      ),
    ).toThrow(/parity/)
    expect(() =>
      transferOwnership(
        colonyRecord({ isHome: true }),
        OWNER_B,
        LATER,
        'conquest',
      ),
    ).toThrow(/parity/)
  })

  it('uses the identical predicate as deriveProtection: protected iff isHome AND unconquerable', () => {
    expect(() =>
      transferOwnership(
        homeRecord({ isHome: false }),
        OWNER_B,
        LATER,
        'conquest',
      ),
    ).toThrow(/parity/)
  })

  it('a declassified home cannot be constructed, so transfer can never bypass protection', () => {
    expect(() =>
      ownershipFor(HOME_BODY, OWNER_A, null, NOW, 'home-assignment', true, false),
    ).toThrow(RangeError)
    const { updated } = transferOwnership(colonyRecord(), OWNER_B, LATER, 'conquest')
    expect(updated.isHome).toBe(updated.unconquerable)
  })

  it('throws on a self-transfer to the current owner', () => {
    expect(() =>
      transferOwnership(colonyRecord(), OWNER_A, LATER, 'trade'),
    ).toThrow(/differ/)
  })

  it('throws on a method outside the union', () => {
    expect(() =>
      transferOwnership(
        colonyRecord(),
        OWNER_B,
        LATER,
        'gift' as unknown as AcquisitionMethod,
      ),
    ).toThrow(RangeError)
  })

  it('rejects a non-positive transfer timestamp or an empty recipient', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() =>
        transferOwnership(colonyRecord(), OWNER_B, bad, 'conquest'),
      ).toThrow(RangeError)
    }
    for (const empty of ['', '   ']) {
      expect(() =>
        transferOwnership(colonyRecord(), empty, LATER, 'trade'),
      ).toThrow(RangeError)
    }
  })
})

describe('P2-T04 transferOwnership — transfer chains', () => {
  it('chains a conquest then a trade into an ordered pair of records and events', () => {
    const first = transferOwnership(colonyRecord(), OWNER_B, LATER, 'conquest')
    const second = transferOwnership(first.updated, OWNER_C, LATER + 1_000, 'trade')
    expect(second.updated.ownerId).toBe(OWNER_C)
    expect(second.updated.previousOwnerId).toBe(OWNER_B)
    expect(second.event.fromOwnerId).toBe(OWNER_B)
    expect(second.event.toOwnerId).toBe(OWNER_C)
    expect(first.event.method).toBe('conquest')
    expect(second.event.method).toBe('trade')
    expect(second.event.at).toBeGreaterThan(first.event.at)
  })
})

describe('P2-T04 historyAppend — immutable appends', () => {
  it('immutably appends an event to the history', () => {
    const event = transferOwnership(colonyRecord(), OWNER_B, LATER, 'conquest').event
    const history = [event]
    const next = historyAppend(history, {
      ...event,
      at: LATER + 1_000,
      toOwnerId: OWNER_C,
      method: 'trade',
    })
    expect(next).toHaveLength(2)
    expect(next[0]).toBe(event)
    expect(next[1]).toMatchObject({ toOwnerId: OWNER_C })
    expect(history).toHaveLength(1)
  })

  it('appends to an empty history', () => {
    const event = transferOwnership(colonyRecord(), OWNER_B, LATER, 'conquest').event
    expect(historyAppend([], event)).toStrictEqual([event])
  })
})

describe('P2-T04 ownershipHistory — filter and order', () => {
  it('filters events to a single body and orders them oldest-first', () => {
    const colony = transferOwnership(colonyRecord(), OWNER_B, LATER, 'conquest').event
    const other = transferOwnership(
      ownershipFor(BODY_3, OWNER_A, null, NOW, 'colonisation', false, false),
      OWNER_B,
      LATER + 5_000,
      'trade',
    ).event
    const later: OwnershipEvent = {
      ...colony,
      at: LATER + 3_000,
      toOwnerId: OWNER_C,
      method: 'trade',
    }
    const history = [later, other, colony]
    expect(ownershipHistory(history, COLONY_BODY)).toStrictEqual([colony, later])
  })

  it('breaks at-ties by input order (stable)', () => {
    const base = transferOwnership(colonyRecord(), OWNER_B, LATER, 'conquest').event
    const e1: OwnershipEvent = { ...base, toOwnerId: OWNER_A }
    const e2: OwnershipEvent = { ...base, toOwnerId: OWNER_B }
    const e3: OwnershipEvent = { ...base, toOwnerId: OWNER_C }
    expect(ownershipHistory([e2, e3, e1], COLONY_BODY)).toStrictEqual([e2, e3, e1])
  })
})

describe('P2-T04 currentOwner — latest owner resolution', () => {
  it('resolves the most recent owner for a body', () => {
    const first = transferOwnership(colonyRecord(), OWNER_B, LATER, 'conquest')
    const second = transferOwnership(first.updated, OWNER_C, LATER + 1_000, 'trade')
    const other = transferOwnership(
      ownershipFor(BODY_3, OWNER_A, null, NOW, 'colonisation', false, false),
      OWNER_B,
      NOW + 500,
      'trade',
    )
    expect(currentOwner([first.event, second.event, other.event], COLONY_BODY)).toBe(
      OWNER_C,
    )
  })

  it('returns null when the body has no events', () => {
    expect(currentOwner([], HOME_BODY)).toBeNull()
    const other = transferOwnership(
      ownershipFor(BODY_3, OWNER_A, null, NOW, 'colonisation', false, false),
      OWNER_B,
      LATER,
      'trade',
    ).event
    expect(currentOwner([other], HOME_BODY)).toBeNull()
  })
})
