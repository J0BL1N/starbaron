import { describe, expect, it } from 'vitest'
import { COLONISATION_BASE_COST } from '../src/sim/player/colonisation'
import { buildBodyRecord } from '../src/sim/world/body'
import type { BodyRecord } from '../src/sim/world/body'
import { buildGalaxyRecord, registerSystem } from '../src/sim/world/galaxy'
import { bodyId, systemId } from '../src/sim/world/identity'
import { buildSystemRecord, registerBody } from '../src/sim/world/system'
import { systemOverviewFor, selectBody } from '../src/sim/ui/system-overview'
import type { SystemOverview } from '../src/sim/ui/system-overview'
import type { InfoLevel } from '../src/sim/ui/info'
import type { UniverseState } from '../src/sim/world/reconstruct'

const SLUG = 'system-overview-fixture'
const NOW = 1_700_000_000_000
const OWNER_A = 'player-a'

const ALPHA = systemId(SLUG, 'alpha')
const BETA = systemId(SLUG, 'beta')

const ALPHA_STAR = bodyId(ALPHA, 'star', 0)
const ALPHA_GAS = bodyId(ALPHA, 'planet', 1)
const ALPHA_ROCKY = bodyId(ALPHA, 'planet', 2)
const ALPHA_T5 = bodyId(ALPHA, 'planet', 3)
const ALPHA_OWNED = bodyId(ALPHA, 'planet', 4)
const ALPHA_MOON = bodyId(ALPHA, 'moon', 5)
const ALPHA_ASTEROID = bodyId(ALPHA, 'asteroid', 6)

const BETA_TIE_A = bodyId(BETA, 'planet', 0)
const BETA_TIE_B = bodyId(BETA, 'planet', 1)

/**
 * Deterministic fixture: one galaxy with two systems.
 *
 * ALPHA (G2 V star) carries every body type with distinct radii so ordering
 * and tier/colonisable invariants can be pinned:
 *   - ALPHA_STAR   radius 6.0 (star, not a planet)
 *   - ALPHA_GAS    radius 4.4  catalogue planet "AU Mic b" — tier 5 with low
 *                  density → GAS GIANT → tier null, not colonisable
 *   - ALPHA_ROCKY  radius 3.1  catalogue planet "Barnard b" — locked tier 1
 *   - ALPHA_T5     radius 2.6  catalogue planet "11 Com b" — tier 5 but NOT a
 *                  gas giant (no radiusEarth → density null) → tier 5
 *   - ALPHA_OWNED  radius 1.9  catalogue planet "51 Peg b" — locked tier 4,
 *                  owned by OWNER_A in the overlay
 *   - ALPHA_MOON   radius 0.8  (moon, not a planet)
 *   - ALPHA_ASTEROID radius 0.3 (asteroid, not a planet)
 *
 * BETA (no star type) carries two same-radius bodies to pin the tie-break.
 */
function buildFixture(): UniverseState {
  let galaxy = buildGalaxyRecord({
    slug: SLUG,
    seed: SLUG,
    name: 'Fixture Home',
  })
  galaxy = registerSystem(registerSystem(galaxy, ALPHA), BETA)

  let alpha = buildSystemRecord({
    galaxy: galaxy.id,
    slug: 'alpha',
    name: 'Alpha',
    starType: 'G2 V',
  })
  alpha = registerBody(registerBody(registerBody(registerBody(
    registerBody(registerBody(registerBody(
      alpha,
      ALPHA_STAR,
    ), ALPHA_ASTEROID), ALPHA_MOON), ALPHA_OWNED), ALPHA_T5), ALPHA_ROCKY), ALPHA_GAS)

  let beta = buildSystemRecord({
    galaxy: galaxy.id,
    slug: 'beta',
    name: 'Beta',
  })
  beta = registerBody(registerBody(beta, BETA_TIE_A), BETA_TIE_B)

  const bodies: BodyRecord[] = [
    buildBodyRecord({
      system: ALPHA,
      type: 'star',
      ordinal: 0,
      name: 'Alpha Prime',
      radius: 6.0,
    }),
    buildBodyRecord({
      system: ALPHA,
      type: 'planet',
      ordinal: 1,
      name: 'AU Mic b',
      radius: 4.4,
    }),
    buildBodyRecord({
      system: ALPHA,
      type: 'planet',
      ordinal: 2,
      name: 'Barnard b',
      radius: 3.1,
    }),
    buildBodyRecord({
      system: ALPHA,
      type: 'planet',
      ordinal: 3,
      name: '11 Com b',
      radius: 2.6,
    }),
    buildBodyRecord({
      system: ALPHA,
      type: 'planet',
      ordinal: 4,
      name: '51 Peg b',
      radius: 1.9,
    }),
    buildBodyRecord({
      system: ALPHA,
      type: 'moon',
      ordinal: 5,
      name: 'Alpha Moon',
      radius: 0.8,
    }),
    buildBodyRecord({
      system: ALPHA,
      type: 'asteroid',
      ordinal: 6,
      name: 'SB-0042',
      radius: 0.3,
    }),
    buildBodyRecord({
      system: BETA,
      type: 'planet',
      ordinal: 0,
      name: 'Beta World A',
      radius: 2.0,
    }),
    buildBodyRecord({
      system: BETA,
      type: 'planet',
      ordinal: 1,
      name: 'Beta World B',
      radius: 2.0,
    }),
  ]

  return { galaxy, systems: [alpha, beta], bodies }
}

const UNIVERSE = buildFixture()

function ownershipMap(): ReadonlyMap<string, string> {
  return new Map<string, string>([[ALPHA_OWNED, OWNER_A]])
}

function overview(
  systemIdValue: string = ALPHA,
  at: number = NOW,
  options: {
    ownership?: ReadonlyMap<string, string>
    selectedBodyId?: string | null
    viewerLevel?: InfoLevel
  } = {},
): SystemOverview {
  return systemOverviewFor({
    systemId: systemIdValue,
    universe: UNIVERSE,
    ...(options.ownership === undefined ? {} : { ownership: options.ownership }),
    ...(options.selectedBodyId === undefined
      ? {}
      : { selectedBodyId: options.selectedBodyId }),
    viewerLevel: options.viewerLevel ?? 'owner',
    at,
  })
}

function cardIds(overviewValue: SystemOverview): string[] {
  return overviewValue.bodies.map((card) => card.id)
}

function cardById(overviewValue: SystemOverview, id: string) {
  const card = overviewValue.bodies.find((candidate) => candidate.id === id)
  expect(card).toBeDefined()
  return card!
}

describe('P4-T05 star summary', () => {
  it('labels the star class from the spectral type and appends the body count', () => {
    const result = overview()
    expect(result.starSummary).toBe('G-class star · 7 bodies')
  })

  it('falls back to Unknown star for a blank or missing star type', () => {
    const result = overview(BETA)
    expect(result.starSummary).toBe('Unknown star · 2 bodies')
  })

  it('uses singular body wording for a one-body system', () => {
    let galaxy = buildGalaxyRecord({ slug: SLUG, seed: SLUG })
    galaxy = registerSystem(galaxy, BETA)
    const beta = buildSystemRecord({
      galaxy: galaxy.id,
      slug: 'beta',
      name: 'Beta',
    })
    const single = registerBody(beta, BETA_TIE_A)
    const universe: UniverseState = {
      galaxy,
      systems: [single],
      bodies: [
        buildBodyRecord({
          system: BETA,
          type: 'planet',
          ordinal: 0,
          name: 'Beta World A',
          radius: 2.0,
        }),
      ],
    }
    expect(systemOverviewFor({ systemId: BETA, universe, viewerLevel: 'owner', at: NOW }).starSummary).toBe(
      'Unknown star · 1 body',
    )
  })

  it('includes the system id and display name', () => {
    const result = overview()
    expect(result.systemId).toBe(ALPHA)
    expect(result.systemName).toBe('Alpha')
  })

  it('is deterministic for identical inputs', () => {
    const first = overview(ALPHA, NOW, { ownership: ownershipMap() })
    const second = overview(ALPHA, NOW, { ownership: ownershipMap() })
    expect(second).toEqual(first)
  })
})

describe('P4-T05 body ordering — radius descending, id tie-break', () => {
  it('emits cards in radius-descending order (star first, asteroid last)', () => {
    const result = overview()
    const radii = result.bodies.map((card) => card.radiusKm)
    expect(radii).toEqual([6.0, 4.4, 3.1, 2.6, 1.9, 0.8, 0.3])
  })

  it('contains exactly one card per resolved body of the system', () => {
    const result = overview()
    expect(cardIds(result)).toHaveLength(7)
    expect(cardIds(result)).toEqual(
      expect.arrayContaining([
        ALPHA_STAR,
        ALPHA_GAS,
        ALPHA_ROCKY,
        ALPHA_T5,
        ALPHA_OWNED,
        ALPHA_MOON,
        ALPHA_ASTEROID,
      ]),
    )
  })

  it('breaks equal-radius ties by body id ascending (deterministic)', () => {
    const result = overview(BETA)
    const ids = cardIds(result)
    expect(ids).toEqual([BETA_TIE_A, BETA_TIE_B].sort())
    expect(result.bodies.every((card) => card.radiusKm === 2.0)).toBe(true)
  })

  it('produces a stable ordering across repeated calls', () => {
    const a = cardIds(overview())
    const b = cardIds(overview())
    expect(b).toEqual(a)
  })
})

describe('P4-T05 tier mapping', () => {
  it('carries the locked catalogue tier for a colonisable planet (Barnard b → 1)', () => {
    expect(cardById(overview(), ALPHA_ROCKY).tier).toBe(1)
  })

  it('carries tier 5 for a giant that is not a gas giant (11 Com b)', () => {
    expect(cardById(overview(), ALPHA_T5).tier).toBe(5)
  })

  it('maps a gas giant (tier 5 + low density) to null tier', () => {
    expect(cardById(overview(), ALPHA_GAS).tier).toBeNull()
  })

  it('maps every non-planet type to null tier (star/moon/asteroid)', () => {
    const result = overview()
    expect(cardById(result, ALPHA_STAR).tier).toBeNull()
    expect(cardById(result, ALPHA_MOON).tier).toBeNull()
    expect(cardById(result, ALPHA_ASTEROID).tier).toBeNull()
  })

  it('maps a planet with no catalogue entry (procedural) to null tier', () => {
    const result = overview(BETA)
    expect(cardById(result, BETA_TIE_A).tier).toBeNull()
  })
})

describe('P4-T05 ownership overlay', () => {
  it('reads the owner for a body present in the overlay map', () => {
    const result = overview(ALPHA, NOW, { ownership: ownershipMap() })
    expect(cardById(result, ALPHA_OWNED).ownerId).toBe(OWNER_A)
  })

  it('reports null owner when the body is not in the overlay map', () => {
    const result = overview(ALPHA, NOW, { ownership: ownershipMap() })
    expect(cardById(result, ALPHA_ROCKY).ownerId).toBeNull()
    expect(cardById(result, ALPHA_GAS).ownerId).toBeNull()
  })

  it('reports null owner for every body when no ownership is supplied', () => {
    const result = overview()
    expect(result.bodies.every((card) => card.ownerId === null)).toBe(true)
  })

  it('ignores overlay entries for bodies outside the system', () => {
    const stray = bodyId(systemId(SLUG, 'nope'), 'planet', 0)
    const map = new Map<string, string>([[stray, OWNER_A]])
    const result = overview(ALPHA, NOW, { ownership: map })
    expect(result.bodies.every((card) => card.ownerId === null)).toBe(true)
  })
})

describe('P4-T05 colonisable flags and cost', () => {
  it('marks an unowned, tiered planet colonisable with the locked base cost', () => {
    const result = overview()
    const rocky = cardById(result, ALPHA_ROCKY)
    expect(rocky.colonisable).toBe(true)
    expect(rocky.coloniseCost).toBe(COLONISATION_BASE_COST.credits)
  })

  it('keeps a tier-5 non-gas-giant planet colonisable', () => {
    const t5 = cardById(overview(), ALPHA_T5)
    expect(t5.colonisable).toBe(true)
    expect(t5.coloniseCost).toBe(COLONISATION_BASE_COST.credits)
  })

  it('excludes an owned planet (colonisable false, no cost) even though it is a planet', () => {
    const result = overview(ALPHA, NOW, { ownership: ownershipMap() })
    const owned = cardById(result, ALPHA_OWNED)
    expect(owned.colonisable).toBe(false)
    expect(owned.coloniseCost).toBeNull()
    expect(owned.tier).toBe(4)
  })

  it('excludes a gas giant (colonisable false, no cost) despite being unowned', () => {
    const gas = cardById(overview(), ALPHA_GAS)
    expect(gas.colonisable).toBe(false)
    expect(gas.coloniseCost).toBeNull()
  })

  it('excludes a star, moon, and asteroid from colonisation with no cost', () => {
    const result = overview()
    for (const id of [ALPHA_STAR, ALPHA_MOON, ALPHA_ASTEROID]) {
      const card = cardById(result, id)
      expect(card.colonisable).toBe(false)
      expect(card.coloniseCost).toBeNull()
    }
  })

  it('excludes a procedural planet with no catalogue tier from colonisation', () => {
    const card = cardById(overview(BETA), BETA_TIE_A)
    expect(card.colonisable).toBe(false)
    expect(card.coloniseCost).toBeNull()
  })

  it('exposes the body id, name, type, and radius on every card', () => {
    const result = overview()
    const rocky = cardById(result, ALPHA_ROCKY)
    expect(rocky.id).toBe(ALPHA_ROCKY)
    expect(rocky.name).toBe('Barnard b')
    expect(rocky.type).toBe('planet')
    expect(rocky.radiusKm).toBe(3.1)
    const asteroid = cardById(result, ALPHA_ASTEROID)
    expect(asteroid.type).toBe('asteroid')
    expect(asteroid.radiusKm).toBe(0.3)
  })
})

describe('P4-T05 selection contract', () => {
  it('passes through a selectedBodyId that names a body in the list', () => {
    const result = overview(ALPHA, NOW, { selectedBodyId: ALPHA_ROCKY })
    expect(result.selectedBodyId).toBe(ALPHA_ROCKY)
  })

  it('projects selectedBodyId to null when it is not in the body list', () => {
    const stray = bodyId(systemId(SLUG, 'nope'), 'planet', 0)
    const result = overview(ALPHA, NOW, { selectedBodyId: stray })
    expect(result.selectedBodyId).toBeNull()
  })

  it('projects selectedBodyId to null when it is from another system', () => {
    const result = overview(ALPHA, NOW, { selectedBodyId: BETA_TIE_A })
    expect(result.selectedBodyId).toBeNull()
  })

  it('defaults selectedBodyId to null when omitted', () => {
    expect(overview().selectedBodyId).toBeNull()
  })

  it('returns an immutable update from selectBody without mutating the input', () => {
    const before = overview()
    const after = selectBody(before, ALPHA_ROCKY)
    expect(after).not.toBe(before)
    expect(after.selectedBodyId).toBe(ALPHA_ROCKY)
    expect(before.selectedBodyId).toBeNull()
    expect(after.bodies).toEqual(before.bodies)
  })

  it('reselects a different body, leaving the previous overview untouched', () => {
    const one = selectBody(overview(), ALPHA_ROCKY)
    const two = selectBody(one, ALPHA_GAS)
    expect(two.selectedBodyId).toBe(ALPHA_GAS)
    expect(one.selectedBodyId).toBe(ALPHA_ROCKY)
  })

  it('throws a RangeError for an unknown bodyId in selectBody', () => {
    expect(() => selectBody(overview(), 'body:nope|whatever|planet|0')).toThrow(
      RangeError,
    )
    expect(() => selectBody(overview(), 'body:nope|whatever|planet|0')).toThrow(
      /unknown body id/,
    )
  })
})

describe('P4-T05 info-gating — viewerLevel', () => {
  it('a public viewer sees no ownership or colonisation data, even with an overlay', () => {
    const result = overview(ALPHA, NOW, {
      ownership: ownershipMap(),
      viewerLevel: 'public',
    })
    expect(result.bodies.every((card) => card.ownerId === null)).toBe(true)
    const owned = cardById(result, ALPHA_OWNED)
    expect(owned.ownerId).toBeNull()
    expect(owned.colonisable).toBe(false)
    expect(owned.coloniseCost).toBeNull()
    const rocky = cardById(result, ALPHA_ROCKY)
    expect(rocky.ownerId).toBeNull()
    expect(rocky.colonisable).toBe(false)
    expect(rocky.coloniseCost).toBeNull()
  })

  it('an owner-level viewer sees the overlay owner and colonisation flags', () => {
    const result = overview(ALPHA, NOW, {
      ownership: ownershipMap(),
      viewerLevel: 'owner',
    })
    expect(cardById(result, ALPHA_OWNED).ownerId).toBe(OWNER_A)
    expect(cardById(result, ALPHA_OWNED).colonisable).toBe(false)
    const rocky = cardById(result, ALPHA_ROCKY)
    expect(rocky.ownerId).toBeNull()
    expect(rocky.colonisable).toBe(true)
    expect(rocky.coloniseCost).toBe(COLONISATION_BASE_COST.credits)
  })

  it('a public viewer still sees identity, radius and tier', () => {
    const result = overview(ALPHA, NOW, { viewerLevel: 'public' })
    const rocky = cardById(result, ALPHA_ROCKY)
    expect(rocky.id).toBe(ALPHA_ROCKY)
    expect(rocky.name).toBe('Barnard b')
    expect(rocky.type).toBe('planet')
    expect(rocky.radiusKm).toBe(3.1)
    expect(rocky.tier).toBe(1)
  })

  it('throws RangeError for an invalid viewerLevel', () => {
    for (const bad of ['guest', 'admin', '', 'OWNER']) {
      expect(() =>
        systemOverviewFor({
          systemId: ALPHA,
          universe: UNIVERSE,
          viewerLevel: bad as InfoLevel,
          at: NOW,
        }),
      ).toThrow(RangeError)
    }
  })
})

describe('P4-T05 validation', () => {
  it('throws a RangeError for a system id not in the state', () => {
    expect(() => overview(systemId(SLUG, 'missing'))).toThrow(RangeError)
    expect(() => overview(systemId(SLUG, 'missing'))).toThrow(
      /unknown system id/,
    )
  })

  it('throws a RangeError for a system id that does not parse', () => {
    expect(() => overview('not-a-system-id')).toThrow(RangeError)
    expect(() => overview('not-a-system-id')).toThrow(/unknown system id/)
  })

  it('throws a RangeError for a non-positive at', () => {
    expect(() => overview(ALPHA, 0)).toThrow(RangeError)
    expect(() => overview(ALPHA, -1)).toThrow(RangeError)
  })

  it('throws a RangeError for a non-finite at', () => {
    expect(() => overview(ALPHA, Number.NaN)).toThrow(RangeError)
    expect(() => overview(ALPHA, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
