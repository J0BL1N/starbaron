import { describe, expect, it } from 'vitest'
import {
  effectiveLevelFor,
  intelGrants,
  permissionFor,
} from '../src/sim/intel/permissions'
import type {
  PermissionResult,
  TargetContext,
  ViewerContext,
} from '../src/sim/intel/permissions'
import type { InfoLevel } from '../src/sim/ui/info'

const LEVELS: readonly InfoLevel[] = ['public', 'alliance', 'intel', 'owner']

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

describe('P6-T01 permissionFor — admin override', () => {
  it('grants an admin stranger the owner tier with reason admin', () => {
    const admin = viewer({ isAdmin: true })
    for (const level of LEVELS) {
      const result = permissionFor(admin, target(), level)
      expect(result).toEqual({ level: 'owner', allowed: true, reason: 'admin' })
    }
  })

  it('admin override wins over an unowned target', () => {
    const admin = viewer({ isAdmin: true })
    const result = permissionFor(admin, target({ ownerId: null }), 'owner')
    expect(result).toEqual({ level: 'owner', allowed: true, reason: 'admin' })
  })

  it('explicit isAdmin false is not an admin — falls to the stranger tier', () => {
    const notAdmin = viewer({ isAdmin: false })
    const result = permissionFor(notAdmin, target(), 'intel')
    expect(result).toEqual({ level: 'intel', allowed: true, reason: 'intel' })
  })
})

describe('P6-T01 permissionFor — owner', () => {
  it('owner sees the owner tier with reason owner', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    const result = permissionFor(owner, target(), 'owner')
    expect(result).toEqual({ level: 'owner', allowed: true, reason: 'owner' })
  })

  it('owner sees every level below owner too, reason owner', () => {
    const owner = viewer({ viewerId: 'owner-gamma' })
    for (const level of LEVELS) {
      const result = permissionFor(owner, target(), level)
      expect(result).toEqual({ level: 'owner', allowed: true, reason: 'owner' })
    }
  })

  it('owner beats a shared alliance membership — reason stays owner', () => {
    const owner = viewer({
      viewerId: 'owner-gamma',
      alliances: ['guild-bravo'],
    })
    const owned = target({ ownerAlliances: ['guild-bravo'] })
    const result = permissionFor(owner, owned, 'owner')
    expect(result).toEqual({ level: 'owner', allowed: true, reason: 'owner' })
  })

  it('admin plus owner resolves to admin', () => {
    const adminOwner = viewer({
      viewerId: 'owner-gamma',
      isAdmin: true,
      alliances: ['guild-bravo'],
    })
    const result = permissionFor(adminOwner, target(), 'owner')
    expect(result).toEqual({ level: 'owner', allowed: true, reason: 'admin' })
  })
})

describe('P6-T01 permissionFor — unowned is public only', () => {
  it('grants the public tier with reason public', () => {
    const stranger = viewer()
    const result = permissionFor(stranger, target({ ownerId: null }), 'public')
    expect(result).toEqual({ level: 'public', allowed: true, reason: 'public' })
  })

  it('denies every level above public with context public', () => {
    const stranger = viewer()
    for (const level of ['alliance', 'intel', 'owner'] as const) {
      const result = permissionFor(stranger, target({ ownerId: null }), level)
      expect(result).toEqual({ level: 'public', allowed: false, reason: 'denied' })
    }
  })

  it('stays public even when the viewer shares the owner alliances', () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    const unowned = target({ ownerId: null, ownerAlliances: ['guild-bravo'] })
    const result = permissionFor(ally, unowned, 'alliance')
    expect(result).toEqual({ level: 'public', allowed: false, reason: 'denied' })
  })
})

describe('P6-T01 permissionFor — alliance', () => {
  it('grants the alliance tier (and public) with reason alliance', () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    const owned = target({ ownerAlliances: ['guild-bravo'] })
    for (const level of ['public', 'alliance'] as const) {
      const result = permissionFor(ally, owned, level)
      expect(result).toEqual({ level: 'alliance', allowed: true, reason: 'alliance' })
    }
  })

  it('denies intel and owner with context alliance', () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    const owned = target({ ownerAlliances: ['guild-bravo'] })
    for (const level of ['intel', 'owner'] as const) {
      const result = permissionFor(ally, owned, level)
      expect(result).toEqual({ level: 'alliance', allowed: false, reason: 'denied' })
    }
  })

  it('a viewer in several alliances is granted when only one matches', () => {
    const ally = viewer({ alliances: ['guild-alpha', 'guild-bravo', 'guild-zeta'] })
    const owned = target({ ownerAlliances: ['guild-bravo'] })
    const result = permissionFor(ally, owned, 'alliance')
    expect(result).toEqual({ level: 'alliance', allowed: true, reason: 'alliance' })
  })

  it('a target in several owner alliances is granted when one matches', () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    const owned = target({ ownerAlliances: ['guild-alpha', 'guild-bravo', 'guild-zeta'] })
    const result = permissionFor(ally, owned, 'alliance')
    expect(result).toEqual({ level: 'alliance', allowed: true, reason: 'alliance' })
  })
})

describe('P6-T01 permissionFor — stranger intel tier', () => {
  it('grants the intel tier (and public) with reason intel', () => {
    const stranger = viewer()
    for (const level of ['public', 'intel'] as const) {
      const result = permissionFor(stranger, target(), level)
      expect(result).toEqual({ level: 'intel', allowed: true, reason: 'intel' })
    }
  })

  it('denies alliance and owner with context intel', () => {
    const stranger = viewer()
    for (const level of ['alliance', 'owner'] as const) {
      const result = permissionFor(stranger, target(), level)
      expect(result).toEqual({ level: 'intel', allowed: false, reason: 'denied' })
    }
  })

  it('empty viewer alliances still yields the stranger tier on an owned target', () => {
    const stranger = viewer({ alliances: [] })
    const owned = target({ ownerAlliances: [] })
    const result = permissionFor(stranger, owned, 'intel')
    expect(result).toEqual({ level: 'intel', allowed: true, reason: 'intel' })
  })
})

describe('P6-T01 permissionFor — validation', () => {
  it('throws RangeError for an empty viewerId', () => {
    expect(() => permissionFor(viewer({ viewerId: '' }), target(), 'public')).toThrow(
      RangeError,
    )
  })

  it('throws RangeError for a blank viewerId', () => {
    expect(() => permissionFor(viewer({ viewerId: '   ' }), target(), 'public')).toThrow(
      RangeError,
    )
  })

  it('throws RangeError for an empty targetId', () => {
    expect(() => permissionFor(viewer(), target({ targetId: '' }), 'public')).toThrow(
      RangeError,
    )
  })

  it('throws RangeError for an empty non-null ownerId', () => {
    expect(() => permissionFor(viewer(), target({ ownerId: '' }), 'public')).toThrow(
      RangeError,
    )
  })

  it('throws RangeError for an invalid requested level', () => {
    expect(() =>
      permissionFor(viewer(), target(), 'superuser' as InfoLevel),
    ).toThrow(RangeError)
  })
})

describe('P6-T01 effectiveLevelFor — ordering', () => {
  it('owner resolves to owner; admin resolves to owner', () => {
    expect(effectiveLevelFor(viewer({ viewerId: 'owner-gamma' }), target())).toBe('owner')
    expect(effectiveLevelFor(viewer({ isAdmin: true }), target())).toBe('owner')
  })

  it('alliance member resolves to alliance', () => {
    const ally = viewer({ alliances: ['guild-bravo'] })
    expect(effectiveLevelFor(ally, target({ ownerAlliances: ['guild-bravo'] }))).toBe(
      'alliance',
    )
  })

  it('stranger resolves to intel; unowned resolves to public', () => {
    expect(effectiveLevelFor(viewer(), target())).toBe('intel')
    expect(effectiveLevelFor(viewer(), target({ ownerId: null }))).toBe('public')
  })

  it('produces four distinct levels in the corrected owner-top order', () => {
    const owner = effectiveLevelFor(viewer({ viewerId: 'owner-gamma' }), target())
    const stranger = effectiveLevelFor(viewer(), target())
    const ally = effectiveLevelFor(
      viewer({ alliances: ['guild-bravo'] }),
      target({ ownerAlliances: ['guild-bravo'] }),
    )
    const publicLevel = effectiveLevelFor(viewer(), target({ ownerId: null }))
    const rank = { public: 0, alliance: 1, intel: 2, owner: 3 }
    expect(rank[owner]).toBeGreaterThan(rank[stranger])
    expect(rank[stranger]).toBeGreaterThan(rank[ally])
    expect(rank[ally]).toBeGreaterThan(rank[publicLevel])
    expect(new Set([owner, stranger, ally, publicLevel]).size).toBe(4)
  })
})

describe('P6-T01 intelGrants — cumulative canSee', () => {
  it('owner grants every level', () => {
    const result = intelGrants(viewer({ viewerId: 'owner-gamma' }), target())
    expect(result.level).toBe('owner')
    expect(result.canSee).toEqual({ public: true, alliance: true, intel: true, owner: true })
  })

  it('alliance member grants public and alliance only', () => {
    const result = intelGrants(
      viewer({ alliances: ['guild-bravo'] }),
      target({ ownerAlliances: ['guild-bravo'] }),
    )
    expect(result.level).toBe('alliance')
    expect(result.canSee).toEqual({ public: true, alliance: true, intel: false, owner: false })
  })

  it('stranger grants public and intel but not alliance or owner', () => {
    const result = intelGrants(viewer(), target())
    expect(result.level).toBe('intel')
    expect(result.canSee).toEqual({ public: true, alliance: false, intel: true, owner: false })
  })

  it('unowned grants public only', () => {
    const result = intelGrants(viewer(), target({ ownerId: null }))
    expect(result.level).toBe('public')
    expect(result.canSee).toEqual({ public: true, alliance: false, intel: false, owner: false })
  })

  it('canSee flags agree with permissionFor at every level', () => {
    const cases: Array<{ view: ViewerContext; tgt: TargetContext }> = [
      { view: viewer({ viewerId: 'owner-gamma' }), tgt: target() },
      { view: viewer({ alliances: ['guild-bravo'] }), tgt: target({ ownerAlliances: ['guild-bravo'] }) },
      { view: viewer(), tgt: target() },
      { view: viewer(), tgt: target({ ownerId: null }) },
      { view: viewer({ isAdmin: true }), tgt: target() },
    ]
    for (const { view, tgt } of cases) {
      const grants = intelGrants(view, tgt)
      for (const level of LEVELS) {
        const result = permissionFor(view, tgt, level)
        expect(grants.canSee[level]).toBe(result.allowed)
        expect(result.level).toBe(grants.level)
      }
    }
  })
})

describe('P6-T01 intelGrants — validation', () => {
  it('throws RangeError for an empty viewerId', () => {
    expect(() => intelGrants(viewer({ viewerId: '' }), target())).toThrow(RangeError)
  })

  it('throws RangeError for an empty targetId', () => {
    expect(() => intelGrants(viewer(), target({ targetId: '' }))).toThrow(RangeError)
  })
})

describe('P6-T01 determinism and input immutability', () => {
  it('identical inputs produce deep-equal results across repeated calls', () => {
    const view = viewer({ viewerId: 'owner-gamma', alliances: ['guild-bravo'] })
    const tgt = target({ ownerAlliances: ['guild-bravo'] })
    for (const level of LEVELS) {
      expect(permissionFor(view, tgt, level)).toEqual(permissionFor(view, tgt, level))
      expect(effectiveLevelFor(view, tgt)).toBe(effectiveLevelFor(view, tgt))
      expect(intelGrants(view, tgt)).toEqual(intelGrants(view, tgt))
    }
  })

  it('every call returns a fresh result object, never a shared reference', () => {
    const view = viewer({ viewerId: 'owner-gamma' })
    const tgt = target()
    const first: PermissionResult = permissionFor(view, tgt, 'owner')
    const second: PermissionResult = permissionFor(view, tgt, 'owner')
    expect(first).not.toBe(second)
    expect(intelGrants(view, tgt)).not.toBe(intelGrants(view, tgt))
  })

  it('never mutates the caller-provided contexts', () => {
    const view = viewer({ alliances: ['guild-bravo', 'guild-zeta'] })
    const tgt = target({ ownerAlliances: ['guild-alpha', 'guild-bravo'] })
    const viewSnapshot = { ...view, alliances: [...view.alliances] }
    const tgtSnapshot = { ...tgt, ownerAlliances: [...tgt.ownerAlliances] }
    permissionFor(view, tgt, 'owner')
    effectiveLevelFor(view, tgt)
    intelGrants(view, tgt)
    expect(view).toEqual(viewSnapshot)
    expect(tgt).toEqual(tgtSnapshot)
  })
})
