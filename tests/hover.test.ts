import { describe, expect, it } from 'vitest'
import { formatNumber } from '../src/sim/core/format'
import { buildBodyRecord } from '../src/sim/world/body'
import type { BodyRecord } from '../src/sim/world/body'
import { buildGalaxyRecord, registerSystem } from '../src/sim/world/galaxy'
import { bodyId, galaxyId, systemId } from '../src/sim/world/identity'
import { ownershipFor } from '../src/sim/player/ownership'
import type { OwnershipRecord } from '../src/sim/player/ownership'
import { buildUniverseState } from '../src/sim/world/reconstruct'
import type { UniverseState } from '../src/sim/world/reconstruct'
import { buildSystemRecord, registerBody } from '../src/sim/world/system'
import {
  BODY_TYPE_LABELS,
  GALAXY_CLASS_LABELS,
  hoverInfoFor,
  resolveHoverTarget,
  smoothSwitch,
} from '../src/sim/ui/hover'
import type { HoverInfoInput, HoverTarget } from '../src/sim/ui/hover'
import type { InfoLevel } from '../src/sim/ui/info'

const SLUG = 'hover-fixture'
const NOW = 1_700_000_000_000
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

/**
 * Deterministic fixture: one galaxy with three systems (alpha: G2 V star +
 * planet + moon, beta: K1 V star + planet + asteroid, gamma: no star type and
 * no bodies). Alpha's planet sits at radius 2_500_000 with a 342.6s orbit, so
 * the locked formatNumber and rounding paths are exercised.
 */
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

  const bodies: BodyRecord[] = [
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
  ]

  return { galaxy, systems: [alpha, beta, gamma], bodies }
}

const UNIVERSE = buildFixture()

function ownershipRecords(): OwnershipRecord[] {
  return [
    ownershipFor(ALPHA_PLANET, OWNER_A, null, NOW, 'home-assignment', true, true),
    ownershipFor(BETA_PLANET, OWNER_B, null, NOW, 'colonisation', false, false),
  ]
}

function ownershipMap(): ReadonlyMap<string, string> {
  return new Map(ownershipRecords().map((record) => [record.bodyId, record.ownerId]))
}

describe('P4-T02 resolveHoverTarget — id kind mapping', () => {
  it('maps a galaxy id to a galaxy target with the id preserved', () => {
    expect(resolveHoverTarget(GALAXY_ID)).toEqual({ kind: 'galaxy', id: GALAXY_ID })
  })

  it('maps a system id to a system target with the id preserved', () => {
    expect(resolveHoverTarget(ALPHA)).toEqual({ kind: 'system', id: ALPHA })
  })

  it('maps a body id to a body target with the id preserved', () => {
    expect(resolveHoverTarget(ALPHA_PLANET)).toEqual({
      kind: 'body',
      id: ALPHA_PLANET,
    })
  })

  it('round-trips every canonical id kind without altering the id string', () => {
    const ids = [GALAXY_ID, ALPHA, BETA, ALPHA_PLANET, BETA_ASTEROID]
    for (const id of ids) {
      const target = resolveHoverTarget(id)
      expect(target).not.toBeNull()
      expect(target!.id).toBe(id)
    }
  })

  it('is null for unparseable or malformed ids', () => {
    const raws = [
      '',
      'not-an-id',
      'sys:only-one-segment',
      'body:x|y|z',
      'gal:a|b',
      'body:a|b|planet|01',
    ]
    for (const raw of raws) {
      expect(resolveHoverTarget(raw)).toBeNull()
    }
  })
})

describe('P4-T02 hoverInfoFor — galaxy', () => {
  it('titles the galaxy by name and subtitles it by class (resolve chain)', () => {
    const target = resolveHoverTarget(GALAXY_ID)
    expect(target).toEqual({ kind: 'galaxy', id: GALAXY_ID })
    const info = hoverInfoFor({ target: target!, universe: UNIVERSE, viewerLevel: 'owner', at: NOW })
    expect(info).not.toBeNull()
    expect(info!.target).toEqual({ kind: 'galaxy', id: GALAXY_ID })
    expect(info!.title).toBe('Fixture Home')
    expect(info!.subtitle).toBe('Spiral galaxy')
  })

  it('reports the systems count and the real-data flag as stats', () => {
    const info = hoverInfoFor({
      target: { kind: 'galaxy', id: GALAXY_ID },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(info.stats).toEqual([
      { label: 'Systems', value: formatNumber(UNIVERSE.galaxy.systemIds.length) },
      { label: 'Real data', value: 'No' },
    ])
  })

  it('never reports an owner for a galaxy (galaxies are not owned in v1)', () => {
    const info = hoverInfoFor({
      target: { kind: 'galaxy', id: GALAXY_ID },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(info.ownedBy).toBeNull()
  })

  it('reports zero systems for a galaxy without registered systems', () => {
    const empty = buildUniverseState({ seed: 'hover-empty', includeCatalogue: false })
    const info = hoverInfoFor({
      target: { kind: 'galaxy', id: empty.galaxy.id },
      universe: empty,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(info.stats).toContainEqual({ label: 'Systems', value: '0' })
    expect(info.summary).toBe('hover-empty · Spiral galaxy · 0 systems')
  })

  it('flips the real-data stat for a real galaxy and stays deterministic', () => {
    const realUniverse: UniverseState = {
      galaxy: { ...buildGalaxyRecord({ slug: 'hover-real' }), realData: true },
      systems: [],
      bodies: [],
    }
    const input: HoverInfoInput = {
      target: { kind: 'galaxy', id: realUniverse.galaxy.id },
      universe: realUniverse,
      viewerLevel: 'owner',
      at: NOW,
    }
    const info = hoverInfoFor(input)!
    expect(info.stats).toContainEqual({ label: 'Real data', value: 'Yes' })
    expect(hoverInfoFor(input)).toEqual(info)
  })
})

describe('P4-T02 hoverInfoFor — system', () => {
  it('titles the system by name and subtitles it from the star type', () => {
    const info = hoverInfoFor({
      target: { kind: 'system', id: ALPHA },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })
    expect(info).not.toBeNull()
    expect(info!.title).toBe('Alpha')
    expect(info!.subtitle).toBe('G-class star')
    expect(info!.summary).toBe('Alpha · G-class star · 3 bodies')
  })

  it('reports the body count and the rounded position magnitude', () => {
    const alpha = hoverInfoFor({
      target: { kind: 'system', id: ALPHA },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(alpha.stats).toEqual([
      { label: 'Bodies', value: '3' },
      { label: 'Position', value: '10' },
    ])
    const gamma = hoverInfoFor({
      target: { kind: 'system', id: GAMMA },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(gamma.stats).toContainEqual({ label: 'Position', value: '11' })
  })

  it('falls back to an unknown-star subtitle when the star type is missing', () => {
    const info = hoverInfoFor({
      target: { kind: 'system', id: GAMMA },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(info.subtitle).toBe('Unknown star')
    expect(info.stats).toContainEqual({ label: 'Bodies', value: '0' })
  })

  it('applies the shared star summary trimming and capitalisation to the subtitle', () => {
    const delta = systemId(SLUG, 'delta')
    let galaxy = buildGalaxyRecord({
      slug: SLUG,
      seed: SLUG,
      name: 'Fixture Home',
      position: { x: 0, y: 0, z: 0 },
    })
    galaxy = registerSystem(galaxy, delta)
    const custom = buildSystemRecord({
      galaxy: galaxy.id,
      slug: 'delta',
      name: 'Delta',
      position: { x: 5, y: 0, z: 0 },
      starType: ' m2 iii ',
    })
    const universe: UniverseState = {
      galaxy,
      systems: [custom],
      bodies: [],
    }
    const info = hoverInfoFor({
      target: { kind: 'system', id: delta },
      universe,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(info.subtitle).toBe('M-class star')
  })

  it('never reports an owner for a system (ownership derives from bodies)', () => {
    const info = hoverInfoFor({
      target: { kind: 'system', id: ALPHA },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(info.ownedBy).toBeNull()
  })

  it('is deterministic across repeated calls', () => {
    const input: HoverInfoInput = {
      target: { kind: 'system', id: ALPHA },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    }
    expect(hoverInfoFor(input)).toEqual(hoverInfoFor(input))
  })
})

describe('P4-T02 hoverInfoFor — body', () => {
  it('titles the body by name and subtitles it by its type label', () => {
    const info = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })
    expect(info).not.toBeNull()
    expect(info!.title).toBe('Alpha World')
    expect(info!.subtitle).toBe('Planet')
    expect(info!.stats).toContainEqual({ label: 'Type', value: 'planet' })
    expect(info!.summary).toBe('Alpha World · Planet · R 2.5M')
  })

  it('formats the radius with the locked formatNumber', () => {
    const info = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(info.stats).toContainEqual({ label: 'Radius', value: '2.5M' })
    expect(info.stats).toContainEqual({
      label: 'Radius',
      value: formatNumber(2_500_000),
    })
  })

  it('reports the orbit period rounded to whole seconds', () => {
    const alpha = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(alpha.stats).toContainEqual({ label: 'Orbit period', value: '343s' })
    const beta = hoverInfoFor({
      target: { kind: 'body', id: BETA_PLANET },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(beta.stats).toContainEqual({ label: 'Orbit period', value: '60s' })
  })

  it('reads ownedBy from the ownership map when present and null otherwise', () => {
    const owned = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(owned.ownedBy).toBe(OWNER_A)
    const beta = hoverInfoFor({
      target: { kind: 'body', id: BETA_PLANET },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(beta.ownedBy).toBe(OWNER_B)
    const unowned = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_MOON },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(unowned.ownedBy).toBeNull()
    const noMap = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(noMap.ownedBy).toBeNull()
  })

  it('resolves star, planet, moon and asteroid bodies with correct labels', () => {
    const cases: Array<{ id: string; type: string; subtitle: string }> = [
      { id: ALPHA_STAR, type: 'star', subtitle: 'Star' },
      { id: ALPHA_PLANET, type: 'planet', subtitle: 'Planet' },
      { id: ALPHA_MOON, type: 'moon', subtitle: 'Moon' },
      { id: BETA_ASTEROID, type: 'asteroid', subtitle: 'Asteroid' },
    ]
    for (const { id, type, subtitle } of cases) {
      const info = hoverInfoFor({
        target: { kind: 'body', id },
        universe: UNIVERSE,
        viewerLevel: 'owner',
        at: NOW,
      })!
      expect(info.subtitle).toBe(subtitle)
      expect(info.stats).toContainEqual({ label: 'Type', value: type })
    }
  })

  it('never mutates the ownership map and is deterministic across calls', () => {
    const map = ownershipMap()
    const snapshot = [...map].sort()
    const input: HoverInfoInput = {
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      ownership: map,
      viewerLevel: 'owner',
      at: NOW,
    }
    const first = hoverInfoFor(input)!
    expect(hoverInfoFor(input)).toEqual(first)
    expect([...map].sort()).toEqual(snapshot)
    expect(map.get(ALPHA_PLANET)).toBe(OWNER_A)
  })
})

describe('P4-T02 info-gating — viewerLevel', () => {
  it('a public viewer never sees an owner, even when the overlay names one', () => {
    const info = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'public',
      at: NOW,
    })!
    expect(info.ownedBy).toBeNull()

    const galaxy = hoverInfoFor({
      target: { kind: 'galaxy', id: GALAXY_ID },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'public',
      at: NOW,
    })!
    expect(galaxy.ownedBy).toBeNull()

    const system = hoverInfoFor({
      target: { kind: 'system', id: ALPHA },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'public',
      at: NOW,
    })!
    expect(system.ownedBy).toBeNull()
  })

  it('an owner-level viewer sees the overlay owner for a body', () => {
    const info = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'owner',
      at: NOW,
    })!
    expect(info.ownedBy).toBe(OWNER_A)
  })

  it('a public viewer still sees public stats and identity (only ownership is gated)', () => {
    const info = hoverInfoFor({
      target: { kind: 'body', id: ALPHA_PLANET },
      universe: UNIVERSE,
      ownership: ownershipMap(),
      viewerLevel: 'public',
      at: NOW,
    })!
    expect(info.title).toBe('Alpha World')
    expect(info.stats).toContainEqual({ label: 'Radius', value: '2.5M' })
  })

  it('throws RangeError for an invalid viewerLevel', () => {
    for (const bad of ['guest', 'admin', '', 'OWNER']) {
      expect(() =>
        hoverInfoFor({
          target: { kind: 'body', id: ALPHA_PLANET },
          universe: UNIVERSE,
          viewerLevel: bad as InfoLevel,
          at: NOW,
        }),
      ).toThrow(RangeError)
    }
  })
})

describe('P4-T02 module purity — frozen lookup tables', () => {
  it('deep-freezes the galaxy class and body type label tables', () => {
    expect(Object.isFrozen(GALAXY_CLASS_LABELS)).toBe(true)
    expect(Object.isFrozen(BODY_TYPE_LABELS)).toBe(true)
    expect(GALAXY_CLASS_LABELS.spiral).toBe('Spiral galaxy')
    expect(BODY_TYPE_LABELS.planet).toBe('Planet')
  })
})

describe('P4-T02 hoverInfoFor — miss and unparseable targets', () => {
  it('returns null for a galaxy id that is not the state galaxy', () => {
    const info = hoverInfoFor({
      target: { kind: 'galaxy', id: galaxyId('other-slug') },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })
    expect(info).toBeNull()
  })

  it('returns null for a fabricated system id absent from the state', () => {
    const info = hoverInfoFor({
      target: { kind: 'system', id: systemId(SLUG, 'nope') },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })
    expect(info).toBeNull()
  })

  it('returns null for a fabricated body id absent from the state', () => {
    const info = hoverInfoFor({
      target: { kind: 'body', id: bodyId(ALPHA, 'planet', 99) },
      universe: UNIVERSE,
      viewerLevel: 'owner',
      at: NOW,
    })
    expect(info).toBeNull()
  })

  it('returns null when a valid kind carries an unparseable id', () => {
    const targets: HoverTarget[] = [
      { kind: 'galaxy', id: 'garbage' },
      { kind: 'system', id: 'garbage' },
      { kind: 'body', id: 'garbage' },
    ]
    for (const target of targets) {
      expect(hoverInfoFor({ target, universe: UNIVERSE, viewerLevel: 'owner', at: NOW })).toBeNull()
    }
  })
})

describe('P4-T02 validation — bad at', () => {
  it('throws RangeError on a non-positive or non-finite at in hoverInfoFor', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        hoverInfoFor({
          target: { kind: 'galaxy', id: GALAXY_ID },
          universe: UNIVERSE,
          viewerLevel: 'owner',
          at: bad,
        }),
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError on a non-positive or non-finite at in smoothSwitch', () => {
    const target: HoverTarget = { kind: 'system', id: ALPHA }
    for (const bad of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => smoothSwitch(null, target, bad)).toThrow(RangeError)
    }
  })
})

describe('P4-T02 smoothSwitch — smooth target switching contract', () => {
  it('is immediate when there is no previous target', () => {
    const result = smoothSwitch(null, { kind: 'system', id: ALPHA }, NOW)
    expect(result.immediate).toBe(true)
    expect(result.from).toBeNull()
  })

  it('is smooth (not immediate) for same-kind switches, even across ids', () => {
    const same = smoothSwitch(
      { kind: 'system', id: ALPHA },
      { kind: 'system', id: BETA },
      NOW,
    )
    expect(same.immediate).toBe(false)
    const bodyToBody = smoothSwitch(
      { kind: 'body', id: ALPHA_PLANET },
      { kind: 'body', id: BETA_PLANET },
      NOW,
    )
    expect(bodyToBody.immediate).toBe(false)
  })

  it('is immediate for cross-kind switches', () => {
    const galaxyToSystem = smoothSwitch(
      { kind: 'galaxy', id: GALAXY_ID },
      { kind: 'system', id: ALPHA },
      NOW,
    )
    expect(galaxyToSystem.immediate).toBe(true)
    const bodyToGalaxy = smoothSwitch(
      { kind: 'body', id: ALPHA_PLANET },
      { kind: 'galaxy', id: GALAXY_ID },
      NOW,
    )
    expect(bodyToGalaxy.immediate).toBe(true)
  })

  it('records the transition faithfully, clones inputs, and is deterministic', () => {
    const from: HoverTarget = { kind: 'system', id: ALPHA }
    const to: HoverTarget = { kind: 'system', id: BETA }
    const result = smoothSwitch(from, to, NOW)
    expect(result).toEqual({
      from: { kind: 'system', id: ALPHA },
      to: { kind: 'system', id: BETA },
      at: NOW,
      immediate: false,
    })
    from.id = 'mutated'
    to.id = 'mutated-too'
    expect(result.from).toEqual({ kind: 'system', id: ALPHA })
    expect(result.to).toEqual({ kind: 'system', id: BETA })
    expect(
      smoothSwitch(
        { kind: 'system', id: ALPHA },
        { kind: 'system', id: BETA },
        NOW,
      ),
    ).toEqual(result)
  })
})
