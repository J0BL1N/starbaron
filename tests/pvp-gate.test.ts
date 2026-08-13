import { describe, expect, it } from 'vitest'
import { pvpGatedView, pvpSummary } from '../src/sim/intel/pvp-gate'
import type { GatedView, PvpGatedViewInput } from '../src/sim/intel/pvp-gate'
import { INTEL_LEVELS } from '../src/sim/intel/levels'
import type { IntelLevel, TargetIntel } from '../src/sim/intel/levels'
import { contractFor } from '../src/sim/ui/info'
import type { InfoField } from '../src/sim/ui/info'
import type {
  TargetContext,
  ViewerContext,
} from '../src/sim/intel/permissions'

const BASE = 1_000_000_000
const HOUR_MS = 60 * 60 * 1000

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
  record: TargetIntel | null,
  overrides: Partial<PvpGatedViewInput> = {},
): PvpGatedViewInput {
  return {
    viewer: view,
    target: tgt,
    intel: record,
    contractFields: contractFor('body').fields,
    values: bodyValues(),
    at: BASE,
    ...overrides,
  }
}

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

const FRESH_REVEAL: Readonly<Record<IntelLevel, readonly string[]>> = {
  none: [],
  observed: PUBLIC_KEYS,
  scanned: SCANNED_KEYS,
  scouted: INTEL_KEYS,
  'deep recon': INTEL_KEYS,
  'full intelligence': INTEL_KEYS,
}

const STRANGER = viewer()
const OWNED = target()

describe('P6-T07 pvpGatedView — owner path', () => {
  it('an owner sees all contract fields with no intel involvement', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const g = pvpGatedView(gate(owner, OWNED, null))
    expect(keys(g.visible)).toEqual(ALL_KEYS)
    expect(g.blocked).toBeNull()
    expect(g.shownFromIntel).toBe(false)
    expect(g.freshness).toBe('fresh')
    expect(g.targetId).toBe(OWNED.targetId)
    expect(g.viewerId).toBe('owner-gamma')
  })

  it('an owner with an empty intel store reads as full intelligence', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const g = pvpGatedView(gate(owner, OWNED, null))
    expect(g.intelLevel).toBe('full intelligence')
  })

  it('an owner intelLevel echoes the store level but never gates the view', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const g = pvpGatedView(
      gate(owner, OWNED, intel({ level: 'scanned' }), { at: BASE + 48 * HOUR_MS }),
    )
    expect(g.intelLevel).toBe('scanned')
    expect(keys(g.visible)).toEqual(ALL_KEYS)
    expect(g.blocked).toBeNull()
  })

  it('an owner is never intel-blocked — even an expired store record shows everything', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const g = pvpGatedView(
      gate(owner, OWNED, intel({ level: 'scouted' }), { at: BASE + 7 * 24 * HOUR_MS }),
    )
    expect(g.blocked).toBeNull()
    expect(keys(g.visible)).toEqual(ALL_KEYS)
    expect(g.shownFromIntel).toBe(false)
  })

  it('an admin resolves to the owner tier and sees everything', () => {
    const admin = viewer({ isAdmin: true })
    const g = pvpGatedView(gate(admin, OWNED, null))
    expect(keys(g.visible)).toEqual(ALL_KEYS)
    expect(g.blocked).toBeNull()
    expect(g.shownFromIntel).toBe(false)
  })
})

describe('P6-T07 pvpGatedView — alliance path', () => {
  it('an alliance member sees the public + alliance tiers, not the scouting tier', () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const g = pvpGatedView(gate(ally, tgt, null))
    expect(keys(g.visible)).toEqual(ALLIANCE_KEYS)
    expect(g.blocked).toBeNull()
    expect(g.shownFromIntel).toBe(false)
    expect(g.intelLevel).toBe('none')
    expect(g.freshness).toBe('fresh')
  })

  it('an alliance member never sees intel or owner fields', () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const g = pvpGatedView(gate(ally, tgt, null))
    expect(g.visible.some((f) => f.key === 'garrison')).toBe(false)
    expect(g.visible.some((f) => f.key === 'population')).toBe(false)
  })

  it('the intel store is never consulted for an alliance member', () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const g = pvpGatedView(
      gate(ally, tgt, intel({ level: 'full intelligence' }), {
        at: BASE + 7 * 24 * HOUR_MS,
      }),
    )
    expect(keys(g.visible)).toEqual(ALLIANCE_KEYS)
    expect(g.shownFromIntel).toBe(false)
    expect(g.intelLevel).toBe('none')
  })
})

describe('P6-T07 pvpGatedView — stranger with fresh intel', () => {
  it('reveals exactly the report tier for every stored ladder rung', () => {
    for (const level of INTEL_LEVELS) {
      const g = pvpGatedView(gate(STRANGER, OWNED, intel({ level })))
      expect(keys(g.visible)).toEqual([...FRESH_REVEAL[level]])
      expect(g.intelLevel).toBe(
        level === 'full intelligence' ? 'deep recon' : level,
      )
      expect(g.freshness).toBe('fresh')
      expect(g.shownFromIntel).toBe(true)
      expect(g.blocked).toBeNull()
    }
  })

  it('FINDING 1: a stranger with fresh scanned intel receives NO alliance-tier fields', () => {
    const g = pvpGatedView(gate(STRANGER, OWNED, intel({ level: 'scanned' })))
    expect(keys(g.visible)).toEqual(SCANNED_KEYS)
    expect(g.visible.some((f) => f.key === 'allianceHeld')).toBe(false)
    expect(g.visible.some((f) => f.key === 'population')).toBe(false)
    expect(g.visible.some((f) => f.key === 'structures')).toBe(false)
    expect(g.visible.some((f) => f.key === 'income')).toBe(false)
  })

  it('FINDING 1: a stranger never receives alliance or owner fields at every stored rung', () => {
    for (const level of INTEL_LEVELS) {
      const g = pvpGatedView(gate(STRANGER, OWNED, intel({ level })))
      expect(g.visible.some((f) => f.key === 'allianceHeld')).toBe(false)
      expect(g.visible.some((f) => f.key === 'population')).toBe(false)
      expect(g.visible.some((f) => f.key === 'structures')).toBe(false)
      expect(g.visible.some((f) => f.key === 'income')).toBe(false)
    }
  })

  it('the reveal delegates to the report machinery: formatted values and estimated state', () => {
    const g = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'full intelligence' })),
    )
    const radius = g.visible.find((f) => f.key === 'radius')
    const odds = g.visible.find((f) => f.key === 'estimatedOdds')
    expect(radius?.value).toBe('2.5M')
    expect(odds?.value).toBe('2.0:1')
    expect(odds?.state).toBe('estimated')
    expect(g.visible.some((f) => f.key === 'population')).toBe(false)
  })
})

describe('P6-T07 pvpGatedView — stranger decay interplay', () => {
  it('a scanned report that ages shows only the observed (public) fields', () => {
    const g = pvpGatedView(gate(STRANGER, OWNED, intel({ level: 'scanned' }), {
      at: BASE + 12 * HOUR_MS,
    }))
    expect(g.intelLevel).toBe('observed')
    expect(g.freshness).toBe('aging')
    expect(keys(g.visible)).toEqual(PUBLIC_KEYS)
    expect(g.blocked).toBeNull()
    expect(g.shownFromIntel).toBe(true)
  })

  it('decay strips the documented rungs: aging minus one, stale minus two', () => {
    const agingScouted = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'scouted' }), { at: BASE + 12 * HOUR_MS }),
    )
    const agingFull = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'full intelligence' }), {
        at: BASE + 12 * HOUR_MS,
      }),
    )
    const staleFull = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'full intelligence' }), {
        at: BASE + 48 * HOUR_MS,
      }),
    )
    expect(agingScouted).toMatchObject({ intelLevel: 'scanned', freshness: 'aging' })
    expect(keys(agingScouted.visible)).toEqual(SCANNED_KEYS)
    expect(agingFull.intelLevel).toBe('deep recon')
    expect(keys(agingFull.visible)).toEqual(INTEL_KEYS)
    expect(staleFull.intelLevel).toBe('scouted')
    expect(staleFull.freshness).toBe('stale')
    expect(keys(staleFull.visible)).toEqual(INTEL_KEYS)
  })

  it('a decayed-to-none reveal is empty but NOT blocked; boundaries land on the older state', () => {
    const zombie = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'observed' }), { at: BASE + 48 * HOUR_MS }),
    )
    expect(zombie.intelLevel).toBe('none')
    expect(zombie.freshness).toBe('stale')
    expect(zombie.visible).toEqual([])
    expect(zombie.blocked).toBeNull()
    expect(zombie.shownFromIntel).toBe(true)

    const atSix = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'scouted' }), { at: BASE + 6 * HOUR_MS }),
    )
    const atTwentyFour = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'scouted' }), {
        at: BASE + 24 * HOUR_MS,
      }),
    )
    const atSeventyTwo = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'scouted' }), {
        at: BASE + 72 * HOUR_MS,
      }),
    )
    expect(atSix.freshness).toBe('aging')
    expect(atTwentyFour.freshness).toBe('stale')
    expect(atSeventyTwo.blocked).toBe('expired-intel')
  })
})

describe('P6-T07 pvpGatedView — stranger with expired intel', () => {
  it('an expired report blocks with expired-intel and an empty picture', () => {
    const g = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'scouted' }), { at: BASE + 7 * 24 * HOUR_MS }),
    )
    expect(g.blocked).toBe('expired-intel')
    expect(g.visible).toEqual([])
    expect(g.intelLevel).toBe('none')
    expect(g.freshness).toBe('expired')
    expect(g.shownFromIntel).toBe(true)
  })

  it('a never-updated record is expired to the gate', () => {
    const g = pvpGatedView(
      gate(STRANGER, OWNED, intel({ lastUpdatedAt: null }), { at: BASE }),
    )
    expect(g.blocked).toBe('expired-intel')
    expect(g.visible).toEqual([])
  })
})

describe('P6-T07 pvpGatedView — stranger with no intel (strict no-leak)', () => {
  it('no record blocks with no-intel and an empty, non-intel picture', () => {
    const g = pvpGatedView(gate(STRANGER, OWNED, null))
    expect(g.blocked).toBe('no-intel')
    expect(g.visible).toEqual([])
    expect(g.intelLevel).toBe('none')
    expect(g.freshness).toBe('expired')
    expect(g.shownFromIntel).toBe(false)
  })

  it('THE STRICT RULE: a stranger on an owned target without intel sees NOTHING — not even public fields', () => {
    const g = pvpGatedView(gate(STRANGER, OWNED, null))
    for (const key of PUBLIC_KEYS) {
      expect(g.visible.some((f) => f.key === key)).toBe(false)
    }
  })

  it('unowned vs owned-by-other: an unowned target shows public, an owned target without intel shows nothing', () => {
    const unowned = pvpGatedView(gate(STRANGER, target({ ownerId: null }), null))
    const ownedNoIntel = pvpGatedView(gate(STRANGER, OWNED, null))
    expect(unowned.blocked).toBeNull()
    expect(keys(unowned.visible)).toEqual(PUBLIC_KEYS)
    expect(ownedNoIntel.blocked).toBe('no-intel')
    expect(ownedNoIntel.visible).toEqual([])
  })

  it('public fields appear for a stranger ONLY through the intel window', () => {
    const without = pvpGatedView(gate(STRANGER, OWNED, null))
    const withIntel = pvpGatedView(gate(STRANGER, OWNED, intel({ level: 'observed' })))
    expect(without.visible).toEqual([])
    expect(keys(withIntel.visible)).toEqual(PUBLIC_KEYS)
    expect(withIntel.shownFromIntel).toBe(true)
  })
})

describe('P6-T07 pvpGatedView — unowned target', () => {
  it('an unowned target is shown at the public tier only', () => {
    const g = pvpGatedView(gate(STRANGER, target({ ownerId: null }), null))
    expect(keys(g.visible)).toEqual(PUBLIC_KEYS)
    expect(g.blocked).toBeNull()
    expect(g.shownFromIntel).toBe(false)
    expect(g.intelLevel).toBe('none')
    expect(g.freshness).toBe('fresh')
  })

  it('an unowned target ignores the intel store and the alliance lists', () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    const unowned = target({ ownerId: null, ownerAlliances: ['guild-bravo'] })
    const withIntel = pvpGatedView(
      gate(ally, unowned, intel({ level: 'full intelligence' }), {
        at: BASE + 7 * 24 * HOUR_MS,
      }),
    )
    expect(keys(withIntel.visible)).toEqual(PUBLIC_KEYS)
    expect(withIntel.shownFromIntel).toBe(false)
    expect(withIntel.blocked).toBeNull()
  })
})

describe('P6-T07 pvpSummary — the deterministic one-line label', () => {
  it("renders 'Owner view · <intelLevel>' for the owner path", () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const empty = pvpGatedView(gate(owner, OWNED, null))
    const stored = pvpGatedView(gate(owner, OWNED, intel({ level: 'scanned' })))
    expect(pvpSummary(empty)).toBe('Owner view · full intelligence')
    expect(pvpSummary(stored)).toBe('Owner view · scanned')
  })

  it("renders 'Intel view · <level> (<freshness>) — <n> fields'", () => {
    const agingScouted = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'scouted' }), { at: BASE + 12 * HOUR_MS }),
    )
    const freshFull = pvpGatedView(
      gate(STRANGER, OWNED, intel({ level: 'full intelligence' })),
    )
    expect(pvpSummary(agingScouted)).toBe('Intel view · scanned (aging) — 7 fields')
    expect(pvpSummary(freshFull)).toBe('Intel view · deep recon (fresh) — 9 fields')
  })

  it("renders 'Blocked: <reason>' for blocked views", () => {
    const noIntel = pvpGatedView(gate(STRANGER, OWNED, null))
    const expired = pvpGatedView(
      gate(STRANGER, OWNED, intel(), { at: BASE + 7 * 24 * HOUR_MS }),
    )
    expect(pvpSummary(noIntel)).toBe('Blocked: no-intel')
    expect(pvpSummary(expired)).toBe('Blocked: expired-intel')
  })

  it("renders 'Alliance view' and 'Public view' with field counts", () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const alliance = pvpGatedView(gate(ally, tgt, null))
    const publicView = pvpGatedView(gate(STRANGER, target({ ownerId: null }), null))
    expect(pvpSummary(alliance)).toBe('Alliance view · 6 fields')
    expect(pvpSummary(publicView)).toBe('Public view · 5 fields')
  })

  it('is deterministic: identical views render identical lines', () => {
    const input = gate(STRANGER, OWNED, intel({ level: 'scouted' }), {
      at: BASE + 12 * HOUR_MS,
    })
    expect(pvpSummary(pvpGatedView(input))).toBe(pvpSummary(pvpGatedView(input)))
  })
})

describe('P6-T07 determinism and input immutability', () => {
  it('identical inputs produce deep-equal views across repeated calls', () => {
    const input = gate(STRANGER, OWNED, intel({ level: 'scouted' }))
    const inputTwo = gate(STRANGER, OWNED, intel({ level: 'scouted' }))
    expect(pvpGatedView(input)).toEqual(pvpGatedView(inputTwo))
    expect(pvpGatedView(input)).toEqual(pvpGatedView(input))
  })

  it('every call returns a fresh view and a fresh visible array', () => {
    const input = gate(viewer({ viewerId: 'owner-gamma' }), OWNED, null)
    const a = pvpGatedView(input)
    const b = pvpGatedView(input)
    expect(a).not.toBe(b)
    expect(a.visible).not.toBe(b.visible)
    expect(a.visible[0]).not.toBe(b.visible[0])
  })

  it('never mutates the caller-provided inputs', () => {
    const view = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const record = intel({ sources: ['mission-7'] })
    const fields = contractFor('body').fields
    const values = bodyValues()
    const viewSnapshot = { ...view, alliances: [...view.alliances] }
    const tgtSnapshot = { ...tgt, ownerAlliances: [...tgt.ownerAlliances] }
    const recordSnapshot: TargetIntel = { ...record, sources: [...record.sources] }
    const fieldsSnapshot = JSON.stringify(fields)
    const valuesSnapshot = JSON.stringify([...values])
    const input: PvpGatedViewInput = {
      viewer: view,
      target: tgt,
      intel: record,
      contractFields: fields,
      values,
      at: BASE + 12 * HOUR_MS,
    }
    pvpGatedView(input)
    expect(view).toEqual(viewSnapshot)
    expect(tgt).toEqual(tgtSnapshot)
    expect(record).toEqual(recordSnapshot)
    expect(JSON.stringify(fields)).toBe(fieldsSnapshot)
    expect(JSON.stringify([...values])).toBe(valuesSnapshot)
  })
})

describe('P6-T07 validation', () => {
  it('rejects a non-positive or non-finite at on every path', () => {
    for (const at of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pvpGatedView(gate(STRANGER, OWNED, null, { at }))).toThrow(
        RangeError,
      )
      expect(() =>
        pvpGatedView(
          gate(viewer({ viewerId: 'owner-gamma' }), OWNED, null, { at }),
        ),
      ).toThrow(RangeError)
    }
  })

  it('rejects a blank viewerId, targetId or non-null ownerId', () => {
    expect(() => pvpGatedView(gate(viewer({ viewerId: '   ' }), OWNED, null))).toThrow(
      RangeError,
    )
    expect(() => pvpGatedView(gate(STRANGER, target({ targetId: '' }), null))).toThrow(
      RangeError,
    )
    expect(() => pvpGatedView(gate(STRANGER, target({ ownerId: ' ' }), null))).toThrow(
      RangeError,
    )
  })

  it('rejects a stranger intel record with an invalid level', () => {
    expect(() =>
      pvpGatedView(gate(STRANGER, OWNED, intel({ level: 'bogus' as IntelLevel }))),
    ).toThrow(RangeError)
  })

  it('FINDING 1: rejects an intel record aimed at a different target — stranger path', () => {
    const foreign = intel({ targetId: 'body:slug|other|planet|9' })
    expect(() => pvpGatedView(gate(STRANGER, OWNED, foreign))).toThrow(RangeError)
  })

  it('FINDING 1: rejects an intel record aimed at a different target — owner path', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const foreign = intel({ targetId: 'body:slug|other|planet|9' })
    expect(() => pvpGatedView(gate(owner, OWNED, foreign))).toThrow(RangeError)
  })

  it('FINDING 1: the targetId match is enforced on every tier — admin, alliance, unowned', () => {
    const admin = viewer({ isAdmin: true })
    const ally = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const unowned = target({ ownerId: null })
    const foreign = intel({ targetId: 'body:slug|other|planet|9' })
    expect(() => pvpGatedView(gate(admin, OWNED, foreign))).toThrow(RangeError)
    expect(() => pvpGatedView(gate(ally, tgt, foreign))).toThrow(RangeError)
    expect(() => pvpGatedView(gate(STRANGER, unowned, foreign))).toThrow(RangeError)
  })

  it('FINDING 2: rejects an invalid stored level on every tier — owner, admin, alliance, unowned', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const admin = viewer({ isAdmin: true })
    const ally = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const unowned = target({ ownerId: null })
    const bad = intel({ level: 'bogus' as IntelLevel })
    expect(() => pvpGatedView(gate(owner, OWNED, bad))).toThrow(RangeError)
    expect(() => pvpGatedView(gate(admin, OWNED, bad))).toThrow(RangeError)
    expect(() => pvpGatedView(gate(ally, tgt, bad))).toThrow(RangeError)
    expect(() => pvpGatedView(gate(STRANGER, unowned, bad))).toThrow(RangeError)
  })

  it('FINDING 2: rejects a blank intel record targetId on every tier', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const admin = viewer({ isAdmin: true })
    const ally = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const unowned = target({ ownerId: null })
    const blank = intel({ targetId: '   ' })
    expect(() => pvpGatedView(gate(owner, OWNED, blank))).toThrow(RangeError)
    expect(() => pvpGatedView(gate(admin, OWNED, blank))).toThrow(RangeError)
    expect(() => pvpGatedView(gate(ally, tgt, blank))).toThrow(RangeError)
    expect(() => pvpGatedView(gate(STRANGER, unowned, blank))).toThrow(RangeError)
  })

  it('FINDING 2: rejects a non-finite or non-positive lastUpdatedAt on every tier', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const admin = viewer({ isAdmin: true })
    const ally = viewer({ alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    const unowned = target({ ownerId: null })
    const paths = [
      gate(owner, OWNED, intel({ lastUpdatedAt: Number.NaN })),
      gate(admin, OWNED, intel({ lastUpdatedAt: 0 })),
      gate(ally, tgt, intel({ lastUpdatedAt: -1 })),
      gate(STRANGER, unowned, intel({ lastUpdatedAt: Number.POSITIVE_INFINITY })),
    ]
    for (const input of paths) {
      expect(() => pvpGatedView(input)).toThrow(RangeError)
    }
  })

  it('returns a well-typed blocked reason or null — never a view with both', () => {
    const shown = pvpGatedView(gate(STRANGER, OWNED, intel()))
    const blocked: GatedView = pvpGatedView(gate(STRANGER, OWNED, null))
    expect(shown.blocked).toBeNull()
    expect(shown.visible.length).toBeGreaterThan(0)
    expect(blocked.blocked).not.toBeNull()
    expect(blocked.visible).toEqual([])
  })
})
