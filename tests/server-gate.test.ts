import { describe, expect, it } from 'vitest'
import { serverViewFor } from '../src/sim/intel/server-gate'
import type { ServerViewInput } from '../src/sim/intel/server-gate'
import type { GatedView } from '../src/sim/intel/pvp-gate'
import { contractFor } from '../src/sim/ui/info'
import type { InfoField } from '../src/sim/ui/info'
import type { IntelStore } from '../src/sim/intel/store'
import type { TargetIntel } from '../src/sim/intel/levels'
import type {
  TargetContext,
  ViewerContext,
} from '../src/sim/intel/permissions'

const BASE = 1_000_000_000
const HOUR_MS = 60 * 60 * 1000

function buildStore(ownerId: string, ...records: TargetIntel[]): IntelStore {
  return {
    ownerId,
    records: new Map(records.map((r) => [r.targetId, r])),
  }
}

function viewer(overrides: Partial<ViewerContext> = {}): ViewerContext {
  return { viewerId: 'viewer-alpha', alliances: [], ...overrides }
}

function target(overrides: Partial<TargetContext> = {}): TargetContext {
  return {
    targetId: 'body:slug|alpha|planet|1',
    ownerId: 'owner-gamma',
    ownerAlliances: [],
    ...overrides,
  }
}

function intel(overrides: Partial<TargetIntel> = {}): TargetIntel {
  return {
    targetId: 'body:slug|alpha|planet|1',
    level: 'scanned',
    lastUpdatedAt: BASE,
    sources: [],
    ...overrides,
  }
}

function bodyValues(): Map<string, string | number | null> {
  return new Map<string, string | number | null>([
    ['name', 'Alpha World'],
    ['id', 'body:slug|alpha|planet|1'],
    ['type', 'planet'],
    ['class', 'Tier 2'],
    ['radius', 2_500_000],
    ['population', 1_200_000],
    ['structures', 7],
    ['income', 2_500],
    ['allianceHeld', 'yes'],
    ['garrison', 5_000],
    ['defensePower', 10_000],
    ['fleetStrength', 300],
    ['estimatedOdds', '2.0:1'],
  ])
}

function gate(
  view: ViewerContext,
  tgt: TargetContext,
  store: IntelStore,
  overrides: Partial<ServerViewInput> = {},
): ServerViewInput {
  return {
    viewer: view,
    target: tgt,
    store,
    contractFields: contractFor('body').fields,
    values: bodyValues(),
    at: BASE,
    ...overrides,
  }
}

function ownStore(...records: TargetIntel[]): IntelStore {
  return buildStore('viewer-alpha', ...records)
}

const STRANGER = viewer()
const OWNED = target()

function keys(fields: InfoField[]): string[] {
  return fields.map((field) => field.key)
}

const PUBLIC_KEYS = ['name', 'id', 'type', 'class', 'radius']
const SCANNED_KEYS = [...PUBLIC_KEYS, 'garrison', 'defensePower']
const INTEL_KEYS = [
  ...PUBLIC_KEYS,
  'garrison',
  'defensePower',
  'fleetStrength',
  'estimatedOdds',
]
const ALLIANCE_KEYS = [...PUBLIC_KEYS, 'allianceHeld']
const ALL_KEYS = [
  ...PUBLIC_KEYS,
  'population',
  'structures',
  'income',
  'allianceHeld',
  'garrison',
  'defensePower',
  'fleetStrength',
  'estimatedOdds',
]

describe('P6-T08 serverViewFor — the viewer-store binding', () => {
  it('rejects a store owned by another viewer (RangeError)', () => {
    expect(() =>
      serverViewFor(gate(STRANGER, OWNED, buildStore('other-player'))),
    ).toThrow(RangeError)
  })

  it('rejects a blank store ownerId (RangeError)', () => {
    expect(() => serverViewFor(gate(STRANGER, OWNED, buildStore('   ')))).toThrow(
      RangeError,
    )
  })

  it('rejects a blank viewerId (RangeError)', () => {
    expect(() =>
      serverViewFor(gate(viewer({ viewerId: '   ' }), OWNED, ownStore())),
    ).toThrow(RangeError)
  })

  it('accepts the store exactly when its ownerId matches the viewer', () => {
    const g = serverViewFor(
      gate(viewer({ viewerId: 'owner-gamma' }), OWNED, buildStore('owner-gamma')),
    )
    expect(g.viewerId).toBe('owner-gamma')
  })
})

describe('P6-T08 serverViewFor — stranger with no record (strict no-leak)', () => {
  it('blocks with no-intel and an empty, non-intel picture', () => {
    const g = serverViewFor(gate(STRANGER, OWNED, ownStore()))
    expect(g.blocked).toBe('no-intel')
    expect(g.visible).toEqual([])
    expect(g.intelLevel).toBe('none')
    expect(g.freshness).toBe('expired')
    expect(g.shownFromIntel).toBe(false)
  })

  it('THE STRICT RULE: a stranger with no record sees NOTHING — not even public fields', () => {
    const g = serverViewFor(gate(STRANGER, OWNED, ownStore()))
    for (const key of PUBLIC_KEYS) {
      expect(g.visible.some((f) => f.key === key)).toBe(false)
    }
  })

  it('a record for a DIFFERENT target in the store is never consulted', () => {
    const store = ownStore(intel({ targetId: 'body:other|planet|9' }))
    const g = serverViewFor(gate(STRANGER, OWNED, store))
    expect(g.blocked).toBe('no-intel')
    expect(g.visible).toEqual([])
  })
})

describe('P6-T08 serverViewFor — owner path', () => {
  it('an owner sees every contract field with no intel involvement', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const g = serverViewFor(gate(owner, OWNED, buildStore('owner-gamma')))
    expect(keys(g.visible)).toEqual(ALL_KEYS)
    expect(g.blocked).toBeNull()
    expect(g.shownFromIntel).toBe(false)
    expect(g.intelLevel).toBe('full intelligence')
  })

  it('an owner with a stored record echoes the level but never gates the view', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const g = serverViewFor(
      gate(owner, OWNED, buildStore('owner-gamma', intel({ level: 'scanned' })), {
        at: BASE + 48 * HOUR_MS,
      }),
    )
    expect(g.intelLevel).toBe('scanned')
    expect(keys(g.visible)).toEqual(ALL_KEYS)
    expect(g.blocked).toBeNull()
  })

  it('an admin resolves to the owner tier and sees everything', () => {
    const admin = viewer({ isAdmin: true })
    const g = serverViewFor(gate(admin, OWNED, ownStore()))
    expect(keys(g.visible)).toEqual(ALL_KEYS)
    expect(g.blocked).toBeNull()
  })
})

describe('P6-T08 serverViewFor — alliance and unowned paths', () => {
  it('an alliance member sees the public + alliance tiers only', () => {
    const ally = viewer({ viewerId: 'viewer-ally', alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const g = serverViewFor(gate(ally, tgt, buildStore('viewer-ally')))
    expect(keys(g.visible)).toEqual(ALLIANCE_KEYS)
    expect(g.shownFromIntel).toBe(false)
    expect(g.intelLevel).toBe('none')
  })

  it('an unowned target shows the public tier for a stranger', () => {
    const g = serverViewFor(gate(STRANGER, target({ ownerId: null }), ownStore()))
    expect(keys(g.visible)).toEqual(PUBLIC_KEYS)
    expect(g.blocked).toBeNull()
    expect(g.shownFromIntel).toBe(false)
  })
})

describe('P6-T08 serverViewFor — stranger intel reveal (no alliance leak)', () => {
  it('FINDING 1: a stranger with scanned intel receives NO alliance-tier or owner fields', () => {
    const g = serverViewFor(
      gate(STRANGER, OWNED, ownStore(intel({ level: 'scanned' }))),
    )
    expect(keys(g.visible)).toEqual(SCANNED_KEYS)
    expect(g.visible.some((f) => f.key === 'allianceHeld')).toBe(false)
    expect(g.visible.some((f) => f.key === 'population')).toBe(false)
    expect(g.visible.some((f) => f.key === 'structures')).toBe(false)
    expect(g.visible.some((f) => f.key === 'income')).toBe(false)
    expect(g.shownFromIntel).toBe(true)
  })

  it('a stranger with scouted intel sees the full intel-tier reveal', () => {
    const g = serverViewFor(
      gate(STRANGER, OWNED, ownStore(intel({ level: 'scouted' }))),
    )
    expect(keys(g.visible)).toEqual(INTEL_KEYS)
  })

  it('FINDING 1: full intelligence is owner-only — a stranger record clamps to deep recon', () => {
    const g = serverViewFor(
      gate(STRANGER, OWNED, ownStore(intel({ level: 'full intelligence' }))),
    )
    expect(g.intelLevel).toBe('deep recon')
    expect(keys(g.visible)).toEqual(INTEL_KEYS)
    expect(g.visible.some((f) => f.key === 'allianceHeld')).toBe(false)
    expect(g.visible.some((f) => f.key === 'population')).toBe(false)
  })

  it('a stranger never receives alliance or owner fields at every stored rung', () => {
    const levels = [
      'none',
      'observed',
      'scanned',
      'scouted',
      'deep recon',
      'full intelligence',
    ] as const
    for (const level of levels) {
      const g = serverViewFor(
        gate(STRANGER, OWNED, ownStore(intel({ level }))),
      )
      expect(g.visible.some((f) => f.key === 'allianceHeld')).toBe(false)
      expect(g.visible.some((f) => f.key === 'population')).toBe(false)
    }
  })
})

describe('P6-T08 serverViewFor — expiry and decay', () => {
  it('an expired record blocks with expired-intel', () => {
    const g = serverViewFor(
      gate(STRANGER, OWNED, ownStore(intel({ level: 'scouted' })), {
        at: BASE + 7 * 24 * HOUR_MS,
      }),
    )
    expect(g.blocked).toBe('expired-intel')
    expect(g.visible).toEqual([])
    expect(g.shownFromIntel).toBe(true)
  })

  it('a never-updated record is expired to the gate', () => {
    const g = serverViewFor(
      gate(STRANGER, OWNED, ownStore(intel({ lastUpdatedAt: null }))),
    )
    expect(g.blocked).toBe('expired-intel')
  })

  it('decay projects at read time: an aging scanned record shows the observed reveal', () => {
    const g = serverViewFor(
      gate(STRANGER, OWNED, ownStore(intel({ level: 'scanned' })), {
        at: BASE + 12 * HOUR_MS,
      }),
    )
    expect(g.intelLevel).toBe('observed')
    expect(g.freshness).toBe('aging')
    expect(keys(g.visible)).toEqual(PUBLIC_KEYS)
  })
})

describe('P6-T08 serverViewFor — values, determinism and immutability', () => {
  it('projects the contract values through the locked formatter', () => {
    const g = serverViewFor(
      gate(STRANGER, OWNED, ownStore(intel({ level: 'scouted' }))),
    )
    const radius = g.visible.find((f) => f.key === 'radius')
    const odds = g.visible.find((f) => f.key === 'estimatedOdds')
    expect(radius?.value).toBe('2.5M')
    expect(odds?.value).toBe('2.0:1')
    expect(odds?.state).toBe('estimated')
  })

  it('identical inputs produce deep-equal views across repeated calls', () => {
    const input = gate(STRANGER, OWNED, ownStore(intel({ level: 'scouted' })))
    expect(serverViewFor(input)).toEqual(serverViewFor(input))
  })

  it('every call returns a fresh view and never mutates the inputs', () => {
    const store = ownStore(intel({ sources: ['mission-7'] }))
    const view = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const fields = contractFor('body').fields
    const values = bodyValues()
    const storeSnapshot = [...store.records].map(([id, r]) => [id, { ...r }])
    const viewSnapshot = { ...view, alliances: [...view.alliances] }
    const tgtSnapshot = { ...tgt, ownerAlliances: [...tgt.ownerAlliances] }
    const fieldsSnapshot = JSON.stringify(fields)
    const valuesSnapshot = JSON.stringify([...values])
    const a: GatedView = serverViewFor(
      gate(view, tgt, store, { contractFields: fields, values }),
    )
    const b: GatedView = serverViewFor(
      gate(view, tgt, store, { contractFields: fields, values }),
    )
    expect(a).not.toBe(b)
    expect(a.visible).not.toBe(b.visible)
    expect([...store.records].map(([id, r]) => [id, { ...r }])).toEqual(
      storeSnapshot,
    )
    expect(view).toEqual(viewSnapshot)
    expect(tgt).toEqual(tgtSnapshot)
    expect(JSON.stringify(fields)).toBe(fieldsSnapshot)
    expect(JSON.stringify([...values])).toBe(valuesSnapshot)
  })

  it('rejects a non-positive or non-finite at (delegated to the gate)', () => {
    for (const at of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        serverViewFor(gate(STRANGER, OWNED, ownStore(), { at })),
      ).toThrow(RangeError)
    }
  })
})
