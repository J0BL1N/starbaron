import { describe, expect, it } from 'vitest'
import { buildBodyRecord } from '../src/sim/world/body'
import { buildGalaxyRecord, registerSystem } from '../src/sim/world/galaxy'
import { bodyId, galaxyId, systemId } from '../src/sim/world/identity'
import { ownershipFor } from '../src/sim/player/ownership'
import type { UniverseState } from '../src/sim/world/reconstruct'
import { buildSystemRecord, registerBody } from '../src/sim/world/system'
import { hoverInfoFor } from '../src/sim/ui/hover'
import { hoverIntelInfo, intelStatusLine } from '../src/sim/ui/hover-intel'
import type { HoverIntelInput } from '../src/sim/ui/hover-intel'
import type { TargetIntel } from '../src/sim/intel/levels'
import type { TargetContext, ViewerContext } from '../src/sim/intel/permissions'

const SLUG = 'hover-intel-fixture'
const NOW = 1_700_000_000_000
const HOUR = 60 * 60 * 1000
const OWNER_A = 'player-a'
const OWNER_B = 'player-b'

const GALAXY_ID = galaxyId(SLUG)
const ALPHA = systemId(SLUG, 'alpha')
const BETA = systemId(SLUG, 'beta')
const GAMMA = systemId(SLUG, 'gamma')

const ALPHA_STAR = bodyId(ALPHA, 'star', 0)
const ALPHA_PLANET = bodyId(ALPHA, 'planet', 1)
const ALPHA_MOON = bodyId(ALPHA, 'moon', 2)
const BETA_PLANET = bodyId(BETA, 'planet', 0)
const BETA_ASTEROID = bodyId(BETA, 'asteroid', 1)

/** Deterministic fixture mirroring the P4 hover fixture: one galaxy with
 * three systems; alpha's planet owns a 2.5M radius with a 342.6s orbit. */
function buildFixture(): UniverseState {
  const galaxy = registerSystem(
    registerSystem(
      registerSystem(
        buildGalaxyRecord({
          slug: SLUG,
          seed: SLUG,
          name: 'Fixture Home',
          position: { x: 0, y: 0, z: 0 },
        }),
        ALPHA,
      ),
      BETA,
    ),
    GAMMA,
  )

  const alpha = registerBody(
    registerBody(
      registerBody(
        buildSystemRecord({
          galaxy: galaxy.id,
          slug: 'alpha',
          name: 'Alpha',
          position: { x: 10, y: 0, z: 0 },
          starType: 'G2 V',
        }),
        ALPHA_STAR,
      ),
      ALPHA_MOON,
    ),
    ALPHA_PLANET,
  )

  const beta = registerBody(
    registerBody(
      buildSystemRecord({
        galaxy: galaxy.id,
        slug: 'beta',
        name: 'Beta',
        position: { x: 0, y: 0, z: 20 },
        starType: 'K1 V',
      }),
      BETA_PLANET,
    ),
    BETA_ASTEROID,
  )

  const gamma = buildSystemRecord({
    galaxy: galaxy.id,
    slug: 'gamma',
    name: 'Gamma',
    position: { x: 10, y: 5, z: 2 },
  })

  return {
    galaxy,
    systems: [alpha, beta, gamma],
    bodies: [
      buildBodyRecord({
        system: ALPHA,
        type: 'star',
        ordinal: 0,
        name: 'Alpha Prime',
        radius: 5,
      }),
      buildBodyRecord({
        system: ALPHA,
        type: 'planet',
        ordinal: 1,
        name: 'Alpha World',
        radius: 2_500_000,
        orbit: { period: 342.6 },
      }),
      buildBodyRecord({
        system: ALPHA,
        type: 'moon',
        ordinal: 2,
        name: 'Alpha Moon',
        radius: 0.2,
      }),
      buildBodyRecord({
        system: BETA,
        type: 'planet',
        ordinal: 0,
        name: 'Beta World',
        radius: 1.5,
        orbit: { period: 60 },
      }),
      buildBodyRecord({
        system: BETA,
        type: 'asteroid',
        ordinal: 1,
        name: 'SB-0042',
        radius: 0.1,
      }),
    ],
  }
}

const UNIVERSE = buildFixture()

function ownershipMap(): ReadonlyMap<string, string> {
  return new Map([
    ownershipFor(ALPHA_PLANET, OWNER_A, null, NOW, 'home-assignment', true, true),
    ownershipFor(BETA_PLANET, OWNER_B, null, NOW, 'colonisation', false, false),
  ].map((record) => [record.bodyId, record.ownerId]))
}

function viewer(overrides: Partial<ViewerContext> = {}): ViewerContext {
  return { viewerId: 'viewer-x', alliances: [], ...overrides }
}

function targetContext(
  targetId: string,
  ownerId: string | null,
  ownerAlliances: readonly string[] = [],
): TargetContext {
  return { targetId, ownerId, ownerAlliances }
}

function intel(overrides: Partial<TargetIntel> = {}): TargetIntel {
  return {
    targetId: ALPHA_PLANET,
    level: 'scouted',
    lastUpdatedAt: NOW,
    sources: [],
    ...overrides,
  }
}

function hoverInput(overrides: Partial<HoverIntelInput> = {}): HoverIntelInput {
  return {
    target: { kind: 'body', id: ALPHA_PLANET },
    universe: UNIVERSE,
    viewer: viewer(),
    targetContext: targetContext(ALPHA_PLANET, OWNER_A),
    intel: null,
    ownership: ownershipMap(),
    at: NOW,
    ...overrides,
  }
}

const OWNER = viewer({ viewerId: OWNER_A })

function labels(stats: Array<{ label: string; value: string }>): string[] {
  return stats.map((stat) => stat.label)
}

describe('P6-T09 hoverIntelInfo — owner path', () => {
  it('an owner hover is unchanged: byte-identical to the P4 hover, no intel line', () => {
    const input = hoverInput({
      viewer: OWNER,
      targetContext: targetContext(ALPHA_PLANET, OWNER_A),
    })
    const result = hoverIntelInfo(input)!
    expect(result.blocked).toBeNull()
    expect(result.intelLine).toBeNull()
    expect(result.shownFromIntel).toBe(false)
    const plain = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(result.base).toEqual(plain)
    expect(result.base.ownedBy).toBe(OWNER_A)
  })

  it('the intel store never gates the owner — even an expired record leaves the hover unchanged', () => {
    const result = hoverIntelInfo(
      hoverInput({
        viewer: OWNER,
        targetContext: targetContext(ALPHA_PLANET, OWNER_A),
        intel: intel({ lastUpdatedAt: NOW - 7 * 24 * HOUR }),
      }),
    )!
    expect(result.blocked).toBeNull()
    expect(result.intelLine).toBeNull()
    expect(result.base.ownedBy).toBe(OWNER_A)
  })

  it('an owner keeps the plain per-kind stats, not the gated projection', () => {
    const result = hoverIntelInfo(
      hoverInput({
        viewer: OWNER,
        targetContext: targetContext(ALPHA_PLANET, OWNER_A),
      }),
    )!
    expect(labels(result.base.stats)).toEqual(['Radius', 'Type', 'Orbit period'])
  })
})

describe('P6-T09 hoverIntelInfo — stranger with fresh intel', () => {
  it('a fresh scouted report shows the intel line, gated stats and no owner', () => {
    const result = hoverIntelInfo(hoverInput({ intel: intel() }))!
    expect(result.shownFromIntel).toBe(true)
    expect(result.blocked).toBeNull()
    expect(result.intelLine).toBe('Scouted intel · fresh · updated 0s ago')
    expect(result.base.ownedBy).toBeNull()
  })

  it('the stats are the gate reveal mapped onto the hover shape', () => {
    const result = hoverIntelInfo(hoverInput({ intel: intel() }))!
    const stats = result.base.stats
    expect(stats).toContainEqual({ label: 'Radius', value: '2.5M' })
    expect(stats).toContainEqual({ label: 'Garrison', value: 'Unknown' })
    expect(stats).toContainEqual({ label: 'Defense power', value: 'Unknown' })
    expect(stats).toContainEqual({ label: 'Estimated odds', value: 'Unknown' })
    expect(stats.some((stat) => stat.label === 'Population')).toBe(false)
    expect(stats.some((stat) => stat.label === 'Income')).toBe(false)
  })

  it('an observed report reveals only the public identity stats', () => {
    const result = hoverIntelInfo(hoverInput({ intel: intel({ level: 'observed' }) }))!
    expect(labels(result.base.stats)).toEqual(['Name', 'ID', 'Type', 'Class', 'Radius'])
    expect(result.base.stats.some((stat) => stat.label === 'Garrison')).toBe(false)
  })

  it('full intelligence reveals owner-tier fields as Unknown but never the owner identity', () => {
    const result = hoverIntelInfo(
      hoverInput({ intel: intel({ level: 'full intelligence' }) }),
    )!
    expect(result.base.stats).toContainEqual({ label: 'Population', value: 'Unknown' })
    expect(result.base.stats).toContainEqual({ label: 'Structures', value: 'Unknown' })
    expect(result.base.ownedBy).toBeNull()
    expect(result.intelLine).toBe('Full intelligence · fresh · updated 0s ago')
  })

  it('the status line reports the stored level with the current freshness and age', () => {
    const result = hoverIntelInfo(hoverInput({ intel: intel(), at: NOW + 8 * HOUR }))!
    expect(result.shownFromIntel).toBe(true)
    expect(result.intelLine).toBe('Scouted intel · aging · updated 8h ago')
  })
})

describe('P6-T09 hoverIntelInfo — blocked paths', () => {
  it('a stranger without intel is blocked with a public-safe base', () => {
    const result = hoverIntelInfo(hoverInput())!
    expect(result.blocked).toBe('no-intel')
    expect(result.shownFromIntel).toBe(false)
    expect(result.intelLine).toBeNull()
    expect(result.base.ownedBy).toBeNull()
  })

  it('a no-intel block leaks nothing: public identity only, no owner or intel stats', () => {
    const result = hoverIntelInfo(hoverInput())!
    expect(labels(result.base.stats)).toEqual(['Radius', 'Type', 'Orbit period'])
    expect(result.base.title).toBe('Alpha World')
    expect(result.base.ownedBy).toBeNull()
    expect(result.base.stats.some((stat) => stat.label === 'Population')).toBe(false)
    expect(result.base.stats.some((stat) => stat.label === 'Garrison')).toBe(false)
  })

  it('an expired report blocks with expired-intel and a public-safe base', () => {
    const result = hoverIntelInfo(hoverInput({ intel: intel(), at: NOW + 7 * 24 * HOUR }))!
    expect(result.blocked).toBe('expired-intel')
    expect(result.shownFromIntel).toBe(false)
    expect(result.intelLine).toBeNull()
    expect(result.base.ownedBy).toBeNull()
  })

  it('a never-updated record is expired to the gate', () => {
    const result = hoverIntelInfo(hoverInput({ intel: intel({ lastUpdatedAt: null }) }))!
    expect(result.blocked).toBe('expired-intel')
  })
})

describe('P6-T09 hoverIntelInfo — unowned and relationship paths', () => {
  it('an unowned body shows the plain public hover', () => {
    const result = hoverIntelInfo(
      hoverInput({
        target: { kind: 'body', id: ALPHA_MOON },
        targetContext: targetContext(ALPHA_MOON, null),
      }),
    )!
    expect(result.blocked).toBeNull()
    expect(result.intelLine).toBeNull()
    expect(result.shownFromIntel).toBe(false)
    expect(result.base.ownedBy).toBeNull()
    expect(labels(result.base.stats)).toEqual(['Radius', 'Type', 'Orbit period'])
  })

  it('an unowned target ignores the intel store entirely', () => {
    const result = hoverIntelInfo(
      hoverInput({
        target: { kind: 'body', id: ALPHA_MOON },
        targetContext: targetContext(ALPHA_MOON, null),
        intel: {
          targetId: ALPHA_MOON,
          level: 'full intelligence',
          lastUpdatedAt: NOW,
          sources: [],
        },
      }),
    )!
    expect(result.shownFromIntel).toBe(false)
    expect(result.intelLine).toBeNull()
    expect(labels(result.base.stats)).toEqual(['Radius', 'Type', 'Orbit period'])
  })

  it('an unowned galaxy shows the plain public galaxy hover', () => {
    const result = hoverIntelInfo(
      hoverInput({
        target: { kind: 'galaxy', id: GALAXY_ID },
        targetContext: targetContext(GALAXY_ID, null),
      }),
    )!
    expect(result.blocked).toBeNull()
    expect(result.intelLine).toBeNull()
    expect(result.base.title).toBe('Fixture Home')
    expect(result.base.stats).toContainEqual({ label: 'Systems', value: '3' })
  })

  it('an owned system gates a stranger through the intel window', () => {
    const result = hoverIntelInfo(
      hoverInput({
        target: { kind: 'system', id: ALPHA },
        targetContext: targetContext(ALPHA, OWNER_B),
        intel: { targetId: ALPHA, level: 'scouted', lastUpdatedAt: NOW, sources: [] },
      }),
    )!
    expect(result.shownFromIntel).toBe(true)
    expect(result.intelLine).toBe('Scouted intel · fresh · updated 0s ago')
    expect(result.base.stats).toContainEqual({ label: 'Star type', value: 'G2 V' })
    expect(result.base.stats).toContainEqual({ label: 'Bodies', value: '3' })
    expect(result.base.stats).toContainEqual({ label: 'Defense power', value: 'Unknown' })
    expect(result.base.stats.some((stat) => stat.label === 'Owned bodies')).toBe(false)
  })

  it('an alliance member gets the plain hover with no intel line', () => {
    const ally = viewer({ viewerId: 'viewer-ally', alliances: ['guild-bravo'] })
    const result = hoverIntelInfo(
      hoverInput({
        viewer: ally,
        targetContext: targetContext(ALPHA_PLANET, OWNER_A, ['guild-bravo']),
      }),
    )!
    expect(result.blocked).toBeNull()
    expect(result.intelLine).toBeNull()
    expect(result.shownFromIntel).toBe(false)
    expect(result.base.ownedBy).toBeNull()
    expect(labels(result.base.stats)).toEqual(['Radius', 'Type', 'Orbit period'])
  })
})

describe('P6-T09 hoverIntelInfo — decay and miss edges', () => {
  it('a decayed-to-none reveal shows an empty stat list but is not blocked', () => {
    const result = hoverIntelInfo(
      hoverInput({ intel: intel({ level: 'observed' }), at: NOW + 48 * HOUR }),
    )!
    expect(result.shownFromIntel).toBe(true)
    expect(result.blocked).toBeNull()
    expect(result.base.stats).toEqual([])
    expect(result.intelLine).toBe('Observed intel · stale · updated 2d ago')
  })

  it('returns null when the target does not resolve against the universe', () => {
    const missBody = hoverInput({
      target: { kind: 'body', id: bodyId(ALPHA, 'planet', 99) },
      targetContext: targetContext(bodyId(ALPHA, 'planet', 99), OWNER_A),
    })
    expect(hoverIntelInfo(missBody)).toBeNull()
    const missGalaxy = hoverInput({
      target: { kind: 'galaxy', id: galaxyId('other') },
      targetContext: targetContext(galaxyId('other'), null),
    })
    expect(hoverIntelInfo(missGalaxy)).toBeNull()
  })

  it('rejects a target whose targetContext names a different object', () => {
    expect(() =>
      hoverIntelInfo(
        hoverInput({ targetContext: targetContext(BETA_PLANET, OWNER_B) }),
      ),
    ).toThrow(RangeError)
  })
})

describe('P6-T09 intelStatusLine — deterministic formatting', () => {
  it('formats the fresh case with a zero-second age', () => {
    expect(intelStatusLine(intel(), NOW)).toBe('Scouted intel · fresh · updated 0s ago')
  })

  it('formats the aging case with floored hours', () => {
    expect(intelStatusLine(intel(), NOW + 8 * HOUR)).toBe(
      'Scouted intel · aging · updated 8h ago',
    )
  })

  it('formats the stale case with floored days', () => {
    expect(intelStatusLine(intel(), NOW + 48 * HOUR)).toBe(
      'Scouted intel · stale · updated 2d ago',
    )
  })

  it('formats an expired record with a timestamp by its age', () => {
    expect(intelStatusLine(intel(), NOW + 80 * HOUR)).toBe(
      'Scouted intel · expired · updated 3d ago',
    )
  })

  it('formats a never-updated record without an age', () => {
    expect(intelStatusLine(intel({ lastUpdatedAt: null }), NOW)).toBe(
      'Scouted intel · expired · never updated',
    )
  })

  it('handles every ladder headline deterministically', () => {
    expect(intelStatusLine(intel({ level: 'full intelligence' }), NOW)).toBe(
      'Full intelligence · fresh · updated 0s ago',
    )
    expect(intelStatusLine(intel({ level: 'deep recon' }), NOW)).toBe(
      'Deep recon intel · fresh · updated 0s ago',
    )
  })
})

describe('P6-T09 determinism, immutability and validation', () => {
  it('identical inputs produce deep-equal results across repeated calls', () => {
    const a = hoverIntelInfo(hoverInput({ intel: intel() }))!
    const b = hoverIntelInfo(hoverInput({ intel: intel() }))!
    expect(a).toEqual(b)
    expect(intelStatusLine(intel(), NOW)).toBe(intelStatusLine(intel(), NOW))
  })

  it('never mutates the caller-provided ownership map', () => {
    const map = ownershipMap()
    const snapshot = [...map].sort()
    hoverIntelInfo(hoverInput({ ownership: map }))
    expect([...map].sort()).toEqual(snapshot)
  })

  it('throws RangeError on a non-positive or non-finite at in hoverIntelInfo', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => hoverIntelInfo(hoverInput({ at: bad }))).toThrow(RangeError)
    }
  })

  it('throws RangeError on a non-positive or non-finite at in intelStatusLine', () => {
    for (const bad of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => intelStatusLine(intel(), bad)).toThrow(RangeError)
    }
  })
})

describe('P6-T09 hoverIntelInfo — admin and identity header', () => {
  it('an admin resolves to the owner tier and sees the unchanged owner hover', () => {
    const admin = viewer({ isAdmin: true })
    const result = hoverIntelInfo(
      hoverInput({
        viewer: admin,
        targetContext: targetContext(ALPHA_PLANET, OWNER_A),
      }),
    )!
    expect(result.blocked).toBeNull()
    expect(result.intelLine).toBeNull()
    expect(result.shownFromIntel).toBe(false)
    expect(result.base.ownedBy).toBe(OWNER_A)
    expect(labels(result.base.stats)).toEqual(['Radius', 'Type', 'Orbit period'])
  })

  it('an intel view keeps the base identity header with no owner', () => {
    const result = hoverIntelInfo(hoverInput({ intel: intel() }))!
    expect(result.base.title).toBe('Alpha World')
    expect(result.base.subtitle).toBe('Planet')
    expect(result.base.summary).toBe('Alpha World · Planet · R 2.5M')
    expect(result.base.ownedBy).toBeNull()
  })
})
