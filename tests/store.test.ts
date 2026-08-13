import { describe, expect, it } from 'vitest'
import {
  storeApplyDecay,
  storeInvariants,
  storeQuery,
  storeRecord,
  storeRescoutNeeded,
} from '../src/sim/intel/store'
import type { IntelStore } from '../src/sim/intel/store'
import {
  AGING_WINDOW_SECONDS,
  STALE_WINDOW_SECONDS,
  decayedLevel,
} from '../src/sim/intel/staleness'
import type { IntelLevel, TargetIntel } from '../src/sim/intel/levels'

const HOUR_MS = 60 * 60 * 1000
const BASE = 1_000_000_000

function rec(overrides: Partial<TargetIntel> = {}): TargetIntel {
  return {
    targetId: 'target-1',
    level: 'scanned',
    lastUpdatedAt: BASE,
    sources: [],
    ...overrides,
  }
}

function store(overrides: Partial<IntelStore> = {}): IntelStore {
  return {
    ownerId: 'player-a',
    records: new Map(),
    ...overrides,
  }
}

function storeWith(...records: TargetIntel[]): IntelStore {
  return {
    ownerId: 'player-a',
    records: new Map(records.map((r) => [r.targetId, r])),
  }
}

describe('P6-T08 storeRecord — the immutable upsert', () => {
  it('inserts a target absent from the store', () => {
    const s = store()
    const result = storeRecord(
      s,
      rec({ targetId: 't1', level: 'scouted', lastUpdatedAt: BASE, sources: ['m1'] }),
    )
    expect(result.ownerId).toBe('player-a')
    expect(result.records.get('t1')).toEqual({
      targetId: 't1',
      level: 'scouted',
      lastUpdatedAt: BASE,
      sources: ['m1'],
    })
    expect(result.records.size).toBe(1)
  })

  it('deduplicates the sources of an inserted record', () => {
    const result = storeRecord(
      store(),
      rec({ targetId: 't1', sources: ['m1', 'm1', 'm2'] }),
    )
    expect(result.records.get('t1')?.sources).toEqual(['m1', 'm2'])
  })

  it('promotes an existing record to the gained level', () => {
    const s = storeWith(rec({ targetId: 't1', level: 'scanned' }))
    const result = storeRecord(
      s,
      rec({ targetId: 't1', level: 'full intelligence' }),
    )
    expect(result.records.get('t1')?.level).toBe('full intelligence')
  })

  it('keeps the higher level when the incoming level is lower', () => {
    const s = storeWith(rec({ targetId: 't1', level: 'scouted' }))
    const result = storeRecord(s, rec({ targetId: 't1', level: 'observed' }))
    expect(result.records.get('t1')?.level).toBe('scouted')
  })

  it('advances lastUpdatedAt for a newer report and never regresses for an older one', () => {
    const s = storeWith(rec({ targetId: 't1', lastUpdatedAt: BASE }))
    const newer = storeRecord(s, rec({ targetId: 't1', lastUpdatedAt: BASE + 5000 }))
    expect(newer.records.get('t1')?.lastUpdatedAt).toBe(BASE + 5000)
    const older = storeRecord(newer, rec({ targetId: 't1', lastUpdatedAt: BASE + 1000 }))
    expect(older.records.get('t1')?.lastUpdatedAt).toBe(BASE + 5000)
  })

  it('a never-updated incoming record never clobbers a recorded timestamp', () => {
    const s = storeWith(rec({ targetId: 't1', lastUpdatedAt: BASE }))
    const result = storeRecord(s, rec({ targetId: 't1', lastUpdatedAt: null }))
    expect(result.records.get('t1')?.lastUpdatedAt).toBe(BASE)
  })

  it('merges sources as a deduplicated union, existing order first', () => {
    const s = storeWith(rec({ targetId: 't1', sources: ['m1', 'm2'] }))
    const result = storeRecord(s, rec({ targetId: 't1', sources: ['m2', 'm3'] }))
    expect(result.records.get('t1')?.sources).toEqual(['m1', 'm2', 'm3'])
  })

  it('throws a RangeError for an empty or blank store ownerId', () => {
    expect(() => storeRecord(store({ ownerId: '' }), rec())).toThrow(RangeError)
    expect(() => storeRecord(store({ ownerId: '   ' }), rec())).toThrow(RangeError)
  })

  it('throws a RangeError for a blank targetId or a bogus level', () => {
    expect(() => storeRecord(store(), rec({ targetId: '  ' }))).toThrow(RangeError)
    expect(() =>
      storeRecord(store(), rec({ level: 'bogus' as IntelLevel })),
    ).toThrow(RangeError)
  })

  it('throws a RangeError for a non-positive, non-finite or NaN lastUpdatedAt', () => {
    expect(() => storeRecord(store(), rec({ lastUpdatedAt: 0 }))).toThrow(RangeError)
    expect(() => storeRecord(store(), rec({ lastUpdatedAt: -1 }))).toThrow(RangeError)
    expect(() => storeRecord(store(), rec({ lastUpdatedAt: Number.NaN }))).toThrow(
      RangeError,
    )
    expect(() =>
      storeRecord(store(), rec({ lastUpdatedAt: Number.POSITIVE_INFINITY })),
    ).toThrow(RangeError)
  })

  it('throws a RangeError for an empty or blank source', () => {
    expect(() => storeRecord(store(), rec({ sources: [''] }))).toThrow(RangeError)
    expect(() => storeRecord(store(), rec({ sources: ['   '] }))).toThrow(RangeError)
  })

  it('returns a fresh store and never mutates the input store or record', () => {
    const s = storeWith(
      rec({ targetId: 't1', level: 'scanned', lastUpdatedAt: BASE, sources: ['m1'] }),
    )
    const originalMap = s.records
    const before = [...s.records]
    const incoming = rec({
      targetId: 't1',
      level: 'deep recon',
      lastUpdatedAt: BASE + 1000,
      sources: ['m2'],
    })
    const incomingSnapshot: TargetIntel = { ...incoming, sources: [...incoming.sources] }
    const result = storeRecord(s, incoming)
    expect(s.records).toBe(originalMap)
    expect([...s.records]).toEqual(before)
    expect(incoming).toEqual(incomingSnapshot)
    expect(result).not.toBe(s)
    expect(result.records).not.toBe(s.records)
  })
})

describe('P6-T08 storeApplyDecay — the store decay pass', () => {
  it('a fresh record keeps its level, its timestamp and its sources', () => {
    const s = storeWith(rec({ targetId: 't1', level: 'scouted', sources: ['m1'] }))
    const result = storeApplyDecay(s, BASE)
    expect(result.records.get('t1')).toEqual({
      targetId: 't1',
      level: 'scouted',
      lastUpdatedAt: BASE,
      sources: ['m1'],
    })
  })

  it('FINDING 2: decay is a READ PROJECTION — storeApplyDecay keeps the stored levels unchanged', () => {
    const aging = storeApplyDecay(
      storeWith(rec({ targetId: 't1', level: 'full intelligence' })),
      BASE + 12 * HOUR_MS,
    )
    const stale = storeApplyDecay(
      storeWith(rec({ targetId: 't1', level: 'full intelligence' })),
      BASE + 48 * HOUR_MS,
    )
    expect(aging.records.get('t1')?.level).toBe('full intelligence')
    expect(stale.records.get('t1')?.level).toBe('full intelligence')
    expect(aging.records.get('t1')?.lastUpdatedAt).toBe(BASE)
    expect(stale.records.get('t1')?.lastUpdatedAt).toBe(BASE)
  })

  it('drops expired records and never-updated records, keeping the surviving levels', () => {
    const s = storeWith(
      rec({ targetId: 'a', level: 'scouted', lastUpdatedAt: BASE }),
      rec({
        targetId: 'b',
        level: 'full intelligence',
        lastUpdatedAt: BASE - AGING_WINDOW_SECONDS * 1000,
      }),
      rec({
        targetId: 'c',
        level: 'deep recon',
        lastUpdatedAt: BASE - STALE_WINDOW_SECONDS * 1000,
      }),
      rec({ targetId: 'd', lastUpdatedAt: null }),
    )
    const result = storeApplyDecay(s, BASE + AGING_WINDOW_SECONDS * 1000)
    expect(result.records.size).toBe(2)
    expect(result.records.get('a')?.level).toBe('scouted')
    expect(result.records.get('b')?.level).toBe('full intelligence')
    expect(result.records.has('c')).toBe(false)
    expect(result.records.has('d')).toBe(false)
  })

  it('FINDING 2: repeated passes keep the level AND the original timestamp — decay never compounds or resets', () => {
    const s = storeWith(rec({ targetId: 't1', level: 'scouted', lastUpdatedAt: BASE }))
    const pass1 = storeApplyDecay(s, BASE + 12 * HOUR_MS)
    const pass2 = storeApplyDecay(pass1, BASE + 25 * HOUR_MS)
    expect(pass1.records.get('t1')?.lastUpdatedAt).toBe(BASE)
    expect(pass2.records.get('t1')?.lastUpdatedAt).toBe(BASE)
    expect(pass1.records.get('t1')?.level).toBe('scouted')
    expect(pass2.records.get('t1')?.level).toBe('scouted')
  })

  it('FINDING 2: decayedLevel still projects the read-time rung subtraction after storeApplyDecay', () => {
    const s = storeWith(rec({ targetId: 't1', level: 'full intelligence' }))
    const decayed = storeApplyDecay(s, BASE + 12 * HOUR_MS)
    expect(decayed.records.get('t1')?.level).toBe('full intelligence')
    expect(decayedLevel(decayed.records.get('t1')!, BASE + 12 * HOUR_MS)).toBe(
      'deep recon',
    )
    expect(decayedLevel(decayed.records.get('t1')!, BASE + 48 * HOUR_MS)).toBe(
      'scouted',
    )
  })

  it('an empty store decays to an empty store', () => {
    const result = storeApplyDecay(store(), BASE + 72 * HOUR_MS)
    expect(result.records.size).toBe(0)
    expect(result.ownerId).toBe('player-a')
  })

  it('throws a RangeError for a non-positive or non-finite at', () => {
    expect(() => storeApplyDecay(store(), 0)).toThrow(RangeError)
    expect(() => storeApplyDecay(store(), Number.NaN)).toThrow(RangeError)
    expect(() => storeApplyDecay(store(), Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    )
  })

  it('throws a RangeError for an empty ownerId or a malformed stored record', () => {
    expect(() => storeApplyDecay(store({ ownerId: '' }), BASE)).toThrow(RangeError)
    expect(() =>
      storeApplyDecay(
        store({ records: new Map([['t', rec({ level: 'bogus' as IntelLevel })]]) }),
        BASE,
      ),
    ).toThrow(RangeError)
  })

  it('returns a fresh store and never mutates the input', () => {
    const s = storeWith(rec({ targetId: 't1', level: 'scouted', sources: ['m1'] }))
    const originalMap = s.records
    const before = [...s.records]
    const result = storeApplyDecay(s, BASE + 12 * HOUR_MS)
    expect(s.records).toBe(originalMap)
    expect([...s.records]).toEqual(before)
    expect(result).not.toBe(s)
    expect(result.records).not.toBe(s.records)
  })
})

describe('P6-T08 storeQuery — the store read', () => {
  it('returns the stored record', () => {
    const s = storeWith(rec({ targetId: 't1', level: 'scouted' }))
    expect(storeQuery(s, 't1')).toEqual(rec({ targetId: 't1', level: 'scouted' }))
  })

  it('returns null when the target is absent', () => {
    expect(storeQuery(store(), 't1')).toBeNull()
  })

  it('returns each target record independently', () => {
    const s = storeWith(rec({ targetId: 't1' }), rec({ targetId: 't2' }))
    expect(storeQuery(s, 't2')).toEqual(rec({ targetId: 't2' }))
    expect(storeQuery(s, 't1')?.targetId).toBe('t1')
  })

  it('throws a RangeError for a blank targetId or an empty ownerId', () => {
    expect(() => storeQuery(store(), '  ')).toThrow(RangeError)
    expect(() => storeQuery(store({ ownerId: '' }), 't1')).toThrow(RangeError)
  })
})

describe('P6-T08 storeRescoutNeeded — the re-scout projection', () => {
  it('returns an empty list when nothing needs a re-scout', () => {
    const s = storeWith(rec({ targetId: 't1' }), rec({ targetId: 't2' }))
    expect(storeRescoutNeeded(s, BASE + 12 * HOUR_MS)).toEqual([])
  })

  it('returns the stale and expired targetIds, including never-updated records', () => {
    const s = storeWith(
      rec({ targetId: 'b', lastUpdatedAt: BASE - STALE_WINDOW_SECONDS * 1000 }),
      rec({ targetId: 'c', lastUpdatedAt: null }),
      rec({ targetId: 'a', lastUpdatedAt: BASE - 48 * HOUR_MS }),
      rec({ targetId: 'd', lastUpdatedAt: BASE }),
    )
    expect(storeRescoutNeeded(s, BASE)).toEqual(['a', 'b', 'c'])
  })

  it('fires exactly at the aging window boundary and not a millisecond before', () => {
    const s = storeWith(rec({ targetId: 't1' }))
    expect(
      storeRescoutNeeded(s, BASE + AGING_WINDOW_SECONDS * 1000 - 1),
    ).toEqual([])
    expect(storeRescoutNeeded(s, BASE + AGING_WINDOW_SECONDS * 1000)).toEqual(['t1'])
  })

  it('throws a RangeError for a non-positive at or an empty ownerId', () => {
    expect(() => storeRescoutNeeded(store(), 0)).toThrow(RangeError)
    expect(() => storeRescoutNeeded(store({ ownerId: '' }), BASE)).toThrow(RangeError)
  })

  it('returns a fresh array on each call', () => {
    const s = storeWith(
      rec({ targetId: 't1', lastUpdatedAt: BASE - 48 * HOUR_MS }),
    )
    const first = storeRescoutNeeded(s, BASE)
    expect(first).toEqual(['t1'])
    expect(storeRescoutNeeded(s, BASE)).not.toBe(first)
  })
})

describe('P6-T08 storeInvariants — the structural report', () => {
  it('is ok for an empty store', () => {
    const result = storeInvariants(store())
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('is ok for a clean populated store', () => {
    const s = storeWith(
      rec({ targetId: 't1', level: 'scouted', sources: ['m1'] }),
      rec({ targetId: 't2', lastUpdatedAt: null, sources: [] }),
    )
    const result = storeInvariants(s)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('reports an empty or blank ownerId', () => {
    const result = storeInvariants(store({ ownerId: '   ' }))
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(['ownerId must be a non-empty string'])
  })

  it('reports a map key that does not match the record targetId', () => {
    const s = store({ records: new Map([['other-key', rec()]]) })
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'record targetId "target-1" does not match map key "other-key"',
    )
  })

  it('reports a blank map key and a blank record targetId', () => {
    const s = store({ records: new Map([['', rec({ targetId: '  ' })]]) })
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('record key "" must be a non-empty string')
    expect(result.problems).toContain('record targetId must be a non-empty string')
  })

  it('reports a bogus level', () => {
    const s = store({ records: new Map([['t', rec({ level: 'bogus' as IntelLevel })]]) })
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'record level must be one of none, observed, scanned, scouted, deep recon, full intelligence, got "bogus"',
    )
  })

  it('reports a non-positive, non-finite or NaN lastUpdatedAt', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const s = store({ records: new Map([['t', rec({ lastUpdatedAt: bad })]]) })
      const result = storeInvariants(s)
      expect(result.ok).toBe(false)
      expect(result.problems).toContain(
        'record lastUpdatedAt must be null or a positive finite number',
      )
    }
  })

  it('reports duplicate sources', () => {
    const s = store({ records: new Map([['t', rec({ sources: ['s1', 's2', 's1'] })]]) })
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'record sources must be deduplicated, duplicate "s1"',
    )
  })

  it('reports an empty or blank source', () => {
    const s = store({ records: new Map([['t', rec({ sources: ['ok', '   '] })]]) })
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('record source "   " must be a non-empty string')
  })

  it('never throws, even on a malformed store', () => {
    expect(() => storeInvariants(store({ ownerId: '' }))).not.toThrow()
    expect(() =>
      storeInvariants(
        store({ records: new Map([['t', rec({ level: 'bogus' as IntelLevel })]]) }),
      ),
    ).not.toThrow()
  })

  it('tampered store: a null ownerId is a reported problem, never a throw', () => {
    const s = store({ ownerId: null as unknown as string })
    expect(() => storeInvariants(s)).not.toThrow()
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('ownerId must be a non-empty string')
  })

  it('tampered store: a non-string map key is a reported problem, never a throw', () => {
    const s = store({
      records: new Map([[42, rec()]]) as unknown as ReadonlyMap<string, TargetIntel>,
    })
    expect(() => storeInvariants(s)).not.toThrow()
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('record key 42 must be a non-empty string')
  })

  it('tampered store: a Set of records is reported as not a Map, never a throw', () => {
    const s = store({
      records: new Set([42]) as unknown as ReadonlyMap<string, TargetIntel>,
    })
    expect(() => storeInvariants(s)).not.toThrow()
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('records must be a Map')
  })

  it('tampered store: an empty records array is reported as not a Map, never a throw', () => {
    const s = store({
      records: [] as unknown as ReadonlyMap<string, TargetIntel>,
    })
    expect(() => storeInvariants(s)).not.toThrow()
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain('records must be a Map')
  })

  it('tampered store: a record with undefined sources is a reported problem, never a throw', () => {
    const tampered = rec() as TargetIntel
    const s = store({
      records: new Map([['t', { ...tampered, sources: undefined }]]) as unknown as ReadonlyMap<
        string,
        TargetIntel
      >,
    })
    expect(() => storeInvariants(s)).not.toThrow()
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'record sources must be an array of non-empty strings',
    )
  })

  it('tampered store: a record with a null level is a reported problem, never a throw', () => {
    const s = store({
      records: new Map([
        ['t', { ...rec(), level: null as unknown as IntelLevel }],
      ]) as unknown as ReadonlyMap<string, TargetIntel>,
    })
    expect(() => storeInvariants(s)).not.toThrow()
    const result = storeInvariants(s)
    expect(result.ok).toBe(false)
    expect(result.problems).toContain(
      'record level must be one of none, observed, scanned, scouted, deep recon, full intelligence, got null',
    )
  })
})

describe('P6-T08 determinism and purity', () => {
  it('repeated calls with identical inputs are deep-equal', () => {
    const s = storeWith(rec({ targetId: 't1', level: 'scouted', sources: ['a'] }))
    const at = BASE + 12 * HOUR_MS
    const incoming = rec({
      targetId: 't1',
      level: 'deep recon',
      lastUpdatedAt: BASE + 1000,
      sources: ['b'],
    })
    expect(storeRecord(s, incoming)).toEqual(storeRecord(s, incoming))
    expect(storeApplyDecay(s, at)).toEqual(storeApplyDecay(s, at))
    expect(storeQuery(s, 't1')).toEqual(storeQuery(s, 't1'))
    expect(storeRescoutNeeded(s, at)).toEqual(storeRescoutNeeded(s, at))
    expect(storeInvariants(s)).toEqual(storeInvariants(s))
  })

  it('runs over frozen inputs without mutating them', () => {
    const s = Object.freeze(
      storeWith(
        rec({ targetId: 't1', level: 'scanned', lastUpdatedAt: BASE, sources: ['a'] }),
      ),
    )
    const incoming = Object.freeze(
      rec({
        targetId: 't1',
        level: 'scouted',
        lastUpdatedAt: BASE + 1000,
        sources: ['b'],
      }),
    )
    const out = storeRecord(s, incoming)
    expect(out.records.get('t1')?.level).toBe('scouted')
    expect(out.records.get('t1')?.sources).toEqual(['a', 'b'])
    expect(storeApplyDecay(s, BASE + 12 * HOUR_MS).records.get('t1')?.level).toBe(
      'scanned',
    )
    expect(storeRescoutNeeded(s, BASE + 12 * HOUR_MS)).toEqual([])
    expect(storeQuery(s, 't1')?.level).toBe('scanned')
    expect(storeInvariants(s).ok).toBe(true)
    expect(s.ownerId).toBe('player-a')
  })
})
