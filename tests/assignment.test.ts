import { describe, expect, it } from 'vitest'
import { PLANETS, PLANET_SNAPSHOT } from '../src/sim/data/planets'
import type { PlanetCatalogueEntry } from '../src/sim/data/planets'
import { fnv1a } from '../src/sim/planets/hash'
import { bodyId, parseCanonicalId, systemId } from '../src/sim/world/identity'
import type { BodyId } from '../src/sim/world/identity'
import { buildCatalogueMapping } from '../src/sim/world/catalogue'
import {
  assignHomeWorld,
  eligibleHomeBodies,
  HOME_WORLD_MAX_ATTEMPT_FACTOR,
  HOME_WORLD_SALT,
  hostGroupIndex,
  resolveExistingHome,
  selectHomeWorld,
} from '../src/sim/player/assignment'
import type { HomeAssignmentResult } from '../src/sim/player/assignment'
import { createPlayerProfile } from '../src/sim/player/profile'
import type {
  CreatePlayerProfileInput,
  PlayerProfile,
} from '../src/sim/player/profile'

const JOINED_AT = 1_700_000_000_000

function makeProfile(
  overrides: Partial<CreatePlayerProfileInput> = {},
): PlayerProfile {
  return createPlayerProfile({
    playerId: 'player-1',
    displayName: 'Jay',
    empireName: 'Starbaron',
    joinedAt: JOINED_AT,
    ...overrides,
  })
}

const ELIGIBLE: BodyId[] = [
  bodyId(systemId('catalogue', 'alpha'), 'planet', 0),
  bodyId(systemId('catalogue', 'beta'), 'planet', 0),
  bodyId(systemId('catalogue', 'gamma'), 'planet', 0),
  bodyId(systemId('catalogue', 'gamma'), 'planet', 1),
  bodyId(systemId('catalogue', 'delta'), 'planet', 0),
  bodyId(systemId('catalogue', 'delta'), 'planet', 1),
  bodyId(systemId('catalogue', 'epsilon'), 'planet', 0),
  bodyId(systemId('catalogue', 'zeta'), 'planet', 0),
]

// This odd-sized fixture observes same-base players DIVERGING onto distinct
// fallbacks via the player-specific phase-A offsets. This divergence is an
// observed property of this tested fixture, not a universal guarantee for
// every player pair/taken set (distinct modulo-n outcomes are not
// mathematically guaranteed). The conditional power-of-two convergence
// property (equal base hash state) is exercised by the next test.
const ODD_ELIGIBLE: BodyId[] = [
  bodyId(systemId('catalogue', 'alpha'), 'planet', 0),
  bodyId(systemId('catalogue', 'beta'), 'planet', 0),
  bodyId(systemId('catalogue', 'gamma'), 'planet', 0),
  bodyId(systemId('catalogue', 'gamma'), 'planet', 1),
  bodyId(systemId('catalogue', 'delta'), 'planet', 0),
  bodyId(systemId('catalogue', 'delta'), 'planet', 1),
  bodyId(systemId('catalogue', 'epsilon'), 'planet', 0),
]

const baseIndex = (playerId: string): number =>
  fnv1a(`${HOME_WORLD_SALT}|${playerId}`) % ELIGIBLE.length

const phaseAProbeIndex = (playerId: string, attempt: number): number =>
  (baseIndex(playerId) +
    (fnv1a(`${HOME_WORLD_SALT}|${playerId}|probe|${attempt}`) % ELIGIBLE.length)) %
  ELIGIBLE.length

describe('eligibleHomeBodies — real catalogue (P2-T02)', () => {
  it('counts exactly 6,321 bodies, one per catalogue planet', () => {
    expect(PLANETS.length).toBe(6321)
    expect(PLANET_SNAPSHOT.rows).toBe(6321)
    expect(eligibleHomeBodies(PLANETS)).toHaveLength(PLANETS.length)
  })

  it('every id parses as a body of type planet under the catalogue galaxy', () => {
    for (const id of eligibleHomeBodies(PLANETS)) {
      const parsed = parseCanonicalId(id)
      expect(parsed.ok).toBe(true)
      if (parsed.ok && parsed.kind === 'body') {
        expect(parsed.bodyType).toBe('planet')
        expect(parsed.galaxySlug).toBe('catalogue')
      }
    }
  })

  it('is deterministic: deep-equal across builds', () => {
    expect(eligibleHomeBodies(PLANETS)).toEqual(eligibleHomeBodies(PLANETS))
  })

  it('contains no duplicate ids', () => {
    const eligible = eligibleHomeBodies(PLANETS)
    expect(new Set(eligible).size).toBe(eligible.length)
  })

  it('equals the canonical buildCatalogueMapping body set', () => {
    const mapping = buildCatalogueMapping(PLANETS, PLANET_SNAPSHOT)
    expect(new Set(eligibleHomeBodies(PLANETS))).toEqual(
      new Set(mapping.bodies.map((body) => body.id)),
    )
  })

  it('each eligible id ordinal equals its host group index', () => {
    eligibleHomeBodies(PLANETS).forEach((id, index) => {
      const parsed = parseCanonicalId(id)
      expect(parsed.ok).toBe(true)
      if (parsed.ok && parsed.kind === 'body') {
        expect(parsed.ordinal).toBe(hostGroupIndex(PLANETS, index))
      }
    })
  })

  it('per-host ordinals are contiguous 0.. group size on the real catalogue', () => {
    const groups = new Map<string, number[]>()
    PLANETS.forEach((entry, index) => {
      const list = groups.get(entry.hostname) ?? []
      list.push(hostGroupIndex(PLANETS, index))
      groups.set(entry.hostname, list)
    })
    for (const ordinals of groups.values()) {
      const sorted = [...ordinals].sort((a, b) => a - b)
      expect(sorted).toEqual(sorted.map((_, i) => i))
    }
  })

  it('derives ids from hostname + per-host ordinal in catalogue order', () => {
    const entries: PlanetCatalogueEntry[] = [
      { name: 'Alpha b', hostname: 'Alpha', systemCount: 1, tier: 1 },
      { name: 'Alpha c', hostname: 'Alpha', systemCount: 2, tier: 1 },
      { name: 'Beta b', hostname: 'Beta', systemCount: 1, tier: 1 },
    ]
    expect(eligibleHomeBodies(entries)).toEqual([
      bodyId(systemId('catalogue', 'Alpha'), 'planet', 0),
      bodyId(systemId('catalogue', 'Alpha'), 'planet', 1),
      bodyId(systemId('catalogue', 'Beta'), 'planet', 0),
    ])
  })

  it('hostGroupIndex counts prior same-host entries', () => {
    const entries: PlanetCatalogueEntry[] = [
      { name: 'A b', hostname: 'A', systemCount: 1, tier: 1 },
      { name: 'A c', hostname: 'A', systemCount: 2, tier: 1 },
      { name: 'B b', hostname: 'B', systemCount: 1, tier: 1 },
      { name: 'A d', hostname: 'A', systemCount: 3, tier: 1 },
    ]
    expect(hostGroupIndex(entries, 0)).toBe(0)
    expect(hostGroupIndex(entries, 1)).toBe(1)
    expect(hostGroupIndex(entries, 2)).toBe(0)
    expect(hostGroupIndex(entries, 3)).toBe(2)
  })

  it('hostGroupIndex rejects out-of-range indices', () => {
    expect(() => hostGroupIndex(PLANETS, -1)).toThrow(RangeError)
    expect(() => hostGroupIndex(PLANETS, PLANETS.length)).toThrow(RangeError)
    expect(() => hostGroupIndex(PLANETS, 1.5)).toThrow(RangeError)
  })
})

describe('selectHomeWorld — deterministic base pick', () => {
  it('picks the fnv1a base index when nothing is taken (attempt 0)', () => {
    const playerId = 'alpha-player'
    const result = selectHomeWorld({ playerId, eligible: ELIGIBLE, taken: new Set() })
    expect(result).toEqual({ ok: true, bodyId: ELIGIBLE[baseIndex(playerId)], attempt: 0 })
  })

  it('uses the starbaron-home-v1 salt by default', () => {
    expect(HOME_WORLD_SALT).toBe('starbaron-home-v1')
    const playerId = 'salt-player'
    const input = { playerId, eligible: ELIGIBLE, taken: new Set<BodyId>() }
    expect(selectHomeWorld(input)).toEqual(
      selectHomeWorld({ ...input, salt: 'starbaron-home-v1' }),
    )
  })
})

describe('selectHomeWorld — collision prevention and probing', () => {
  it('returns a different, non-taken id when the base index is taken', () => {
    const playerId = 'beta-player'
    const taken = new Set<BodyId>([ELIGIBLE[baseIndex(playerId)]])
    const result = selectHomeWorld({ playerId, eligible: ELIGIBLE, taken })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bodyId).not.toBe(ELIGIBLE[baseIndex(playerId)])
      expect(taken.has(result.bodyId)).toBe(false)
      expect(ELIGIBLE).toContain(result.bodyId)
    }
  })

  it('is deterministic on the probing path with a partially-taken set', () => {
    const playerId = 'deterministic-prober'
    const taken = new Set<BodyId>([
      ELIGIBLE[baseIndex(playerId)],
      ELIGIBLE[phaseAProbeIndex(playerId, 1)],
    ])
    const input = { playerId, eligible: ELIGIBLE, taken }
    expect(selectHomeWorld(input)).toEqual(selectHomeWorld(input))
  })

  it('probes past the base when the first probes collide', () => {
    const playerId = 'gamma-player'
    const taken = new Set<BodyId>([
      ELIGIBLE[baseIndex(playerId)],
      ELIGIBLE[phaseAProbeIndex(playerId, 1)],
    ])
    const result = selectHomeWorld({ playerId, eligible: ELIGIBLE, taken })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.attempt).toBeGreaterThanOrEqual(2)
      expect(taken.has(result.bodyId)).toBe(false)
      expect(ELIGIBLE).toContain(result.bodyId)
    }
  })

  it('odd-sized set: same-base players observed to diverge onto distinct fallbacks (phase A, tested fixture)', () => {
    const playerA = 'p-0'
    const playerB = 'p-24'
    const sharedBase =
      fnv1a(`${HOME_WORLD_SALT}|${playerA}`) % ODD_ELIGIBLE.length
    expect(fnv1a(`${HOME_WORLD_SALT}|${playerB}`) % ODD_ELIGIBLE.length).toBe(
      sharedBase,
    )
    expect(ODD_ELIGIBLE.length % 2).toBe(1)
    const taken = new Set<BodyId>([ODD_ELIGIBLE[sharedBase]])
    const resultA = selectHomeWorld({ playerId: playerA, eligible: ODD_ELIGIBLE, taken })
    const resultB = selectHomeWorld({ playerId: playerB, eligible: ODD_ELIGIBLE, taken })
    expect(resultA.ok).toBe(true)
    expect(resultB.ok).toBe(true)
    if (resultA.ok && resultB.ok) {
      expect(resultA.bodyId).not.toBe(resultB.bodyId)
      expect(resultA.bodyId).not.toBe(ODD_ELIGIBLE[sharedBase])
      expect(resultB.bodyId).not.toBe(ODD_ELIGIBLE[sharedBase])
      expect(taken.has(resultA.bodyId)).toBe(false)
      expect(taken.has(resultB.bodyId)).toBe(false)
    }
  })

  it('power-of-two sized set: same-base players with equal base hash state converge (phase-A 2^k property)', () => {
    const powerTwoPlayerA = 'collide-0'
    const powerTwoPlayerB = 'collide-8'
    const sharedBase =
      fnv1a(`${HOME_WORLD_SALT}|${powerTwoPlayerA}`) % ELIGIBLE.length
    expect(ELIGIBLE.length % 2).toBe(0)
    expect(fnv1a(`${HOME_WORLD_SALT}|${powerTwoPlayerB}`) % ELIGIBLE.length).toBe(
      sharedBase,
    )
    const taken = new Set<BodyId>([ELIGIBLE[sharedBase]])
    const resultA = selectHomeWorld({
      playerId: powerTwoPlayerA,
      eligible: ELIGIBLE,
      taken,
    })
    const resultB = selectHomeWorld({
      playerId: powerTwoPlayerB,
      eligible: ELIGIBLE,
      taken,
    })
    expect(resultA).toEqual(resultB)
    if (resultA.ok && resultB.ok) {
      expect(resultA.bodyId).toBe(resultB.bodyId)
      expect(resultA.bodyId).not.toBe(ELIGIBLE[sharedBase])
      expect(taken.has(resultA.bodyId)).toBe(false)
    }
  })

  it('never returns a taken id across many players with a partially-taken set', () => {
    for (let i = 0; i < 40; i += 1) {
      const playerId = `stress-${i}`
      const taken = new Set<BodyId>([
        ELIGIBLE[baseIndex(playerId)],
        ELIGIBLE[phaseAProbeIndex(playerId, 1)],
      ])
      const result = selectHomeWorld({ playerId, eligible: ELIGIBLE, taken })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(taken.has(result.bodyId)).toBe(false)
        expect(ELIGIBLE).toContain(result.bodyId)
      }
    }
  })
})

describe('selectHomeWorld — exhaustion and invalid sets', () => {
  it('returns exhausted after both phases when every eligible id is taken', () => {
    const result = selectHomeWorld({
      playerId: 'exhaust-player',
      eligible: ELIGIBLE,
      taken: new Set(ELIGIBLE),
    })
    expect(result).toEqual({
      ok: false,
      reason: 'exhausted',
      attempt: HOME_WORLD_MAX_ATTEMPT_FACTOR * ELIGIBLE.length,
    })
  })

  it('resolves a single free id among many taken', () => {
    const playerId = 'last-free-player'
    const freeIndex = baseIndex(playerId)
    const free = ELIGIBLE[freeIndex]
    const taken = new Set<BodyId>(ELIGIBLE.filter((id) => id !== free))
    const result = selectHomeWorld({ playerId, eligible: ELIGIBLE, taken })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bodyId).toBe(free)
      expect(result.attempt).toBe(0)
    }
  })

  it('returns invalid-eligible-set for an empty eligible set', () => {
    const result = selectHomeWorld({
      playerId: 'empty-player',
      eligible: [],
      taken: new Set(),
    })
    expect(result).toEqual({ ok: false, reason: 'invalid-eligible-set', attempt: 0 })
  })
})

describe('selectHomeWorld — two-phase collision prevention (P2-T02)', () => {
  const coverageEligible: BodyId[] = Array.from({ length: 19 }, (_, i) =>
    bodyId(systemId('catalogue', `host-${i}`), 'planet', 0),
  )

  it('resolves the round-1 coverage case (coverage-probe, 19 entries, only id 12 free)', () => {
    const playerId = 'coverage-probe'
    const freeId = coverageEligible[12]
    const taken = new Set<BodyId>(coverageEligible.filter((id) => id !== freeId))
    const result = selectHomeWorld({ playerId, eligible: coverageEligible, taken })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bodyId).toBe(freeId)
      expect(result.attempt).toBe(8)
      expect(result.attempt).toBeLessThanOrEqual(
        HOME_WORLD_MAX_ATTEMPT_FACTOR * coverageEligible.length,
      )
    }
  })

  it('probing stays deterministic: same inputs, same result', () => {
    const playerId = 'coverage-probe'
    const freeId = coverageEligible[12]
    const taken = new Set<BodyId>(coverageEligible.filter((id) => id !== freeId))
    const input = { playerId, eligible: coverageEligible, taken }
    expect(selectHomeWorld(input)).toEqual(selectHomeWorld(input))
  })

  it('reports exhausted after both phases (attempt 3 × n) when all taken', () => {
    const result = selectHomeWorld({
      playerId: 'coverage-probe',
      eligible: coverageEligible,
      taken: new Set(coverageEligible),
    })
    expect(result).toEqual({
      ok: false,
      reason: 'exhausted',
      attempt: HOME_WORLD_MAX_ATTEMPT_FACTOR * coverageEligible.length,
    })
  })
})

describe('selectHomeWorld — attempt budget (P2-T02)', () => {
  it('never exceeds 3 × n attempts across collision and exhaustion scenarios', () => {
    const scenarios: Array<{ playerId: string; eligible: BodyId[]; taken: Set<BodyId> }> = []
    for (let i = 0; i < 60; i += 1) {
      const playerId = `budget-${i}`
      const base = baseIndex(playerId)
      scenarios.push(
        { playerId, eligible: ELIGIBLE, taken: new Set([ELIGIBLE[base]]) },
        {
          playerId,
          eligible: ELIGIBLE,
          taken: new Set([ELIGIBLE[base], ELIGIBLE[phaseAProbeIndex(playerId, 1)]]),
        },
        {
          playerId,
          eligible: ODD_ELIGIBLE,
          taken: new Set([ODD_ELIGIBLE[base % ODD_ELIGIBLE.length]]),
        },
      )
    }
    scenarios.push(
      { playerId: 'budget-full', eligible: ELIGIBLE, taken: new Set(ELIGIBLE) },
      { playerId: 'budget-full-odd', eligible: ODD_ELIGIBLE, taken: new Set(ODD_ELIGIBLE) },
      {
        playerId: 'budget-single-free',
        eligible: ELIGIBLE,
        taken: new Set(ELIGIBLE.filter((_, index) => index !== 0)),
      },
    )
    for (const scenario of scenarios) {
      const result = selectHomeWorld(scenario)
      expect(result.attempt).toBeLessThanOrEqual(
        HOME_WORLD_MAX_ATTEMPT_FACTOR * scenario.eligible.length,
      )
    }
  })

  it('exhaustion reports exactly the 3 × n bound after both phases', () => {
    for (const eligible of [ELIGIBLE, ODD_ELIGIBLE]) {
      const result = selectHomeWorld({
        playerId: 'budget-exhaust',
        eligible,
        taken: new Set(eligible),
      })
      expect(result).toEqual({
        ok: false,
        reason: 'exhausted',
        attempt: HOME_WORLD_MAX_ATTEMPT_FACTOR * eligible.length,
      })
    }
  })
})

describe('assignHomeWorld — immutable application', () => {
  it('applies the assigned body id without mutating the original', () => {
    const profile = makeProfile()
    const assigned = ELIGIBLE[3]
    const result: HomeAssignmentResult = { ok: true, bodyId: assigned, attempt: 0 }
    const next = assignHomeWorld(profile, result)
    expect(next).not.toBe(profile)
    expect(next.homeWorld).toBe(assigned)
    expect(profile.homeWorld).toBeUndefined()
    expect(next.playerId).toBe(profile.playerId)
    expect(next.settings).toEqual(profile.settings)
    expect(next.progression).toEqual(profile.progression)
  })

  it('returns the profile unchanged when the result is not ok', () => {
    const profile = makeProfile()
    const result: HomeAssignmentResult = {
      ok: false,
      reason: 'exhausted',
      attempt: 24,
    }
    const next = assignHomeWorld(profile, result)
    expect(next).toBe(profile)
    expect(next.homeWorld).toBeUndefined()
  })
})

describe('resolveExistingHome — repeat-login idempotency', () => {
  it('is ok when the homeWorld is present and registered in taken', () => {
    const profile = makeProfile({ homeWorld: ELIGIBLE[0] })
    expect(resolveExistingHome(profile, new Set(ELIGIBLE))).toEqual({ ok: true })
  })

  it('flags home-not-in-taken when the homeWorld is absent from taken', () => {
    const profile = makeProfile({ homeWorld: ELIGIBLE[0] })
    expect(resolveExistingHome(profile, new Set([ELIGIBLE[1]]))).toEqual({
      ok: false,
      reason: 'home-not-in-taken',
    })
  })

  it('flags not-assigned when the profile has no homeWorld', () => {
    const profile = makeProfile()
    expect(resolveExistingHome(profile, new Set())).toEqual({
      ok: false,
      reason: 'not-assigned',
    })
  })
})

describe('selectHomeWorld — real catalogue integration', () => {
  it('selects against the full 6,321-body eligible set', () => {
    const eligible = eligibleHomeBodies(PLANETS)
    const result = selectHomeWorld({
      playerId: 'real-catalogue-player',
      eligible,
      taken: new Set(),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.attempt).toBe(0)
      expect(eligible).toContain(result.bodyId)
      const parsed = parseCanonicalId(result.bodyId)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        expect(parsed.kind).toBe('body')
      }
    }
  })

  it('collision on the real catalogue returns a distinct non-taken body', () => {
    const eligible = eligibleHomeBodies(PLANETS)
    const playerId = 'real-catalogue-collide'
    const base = fnv1a(`${HOME_WORLD_SALT}|${playerId}`) % eligible.length
    const taken = new Set<BodyId>([eligible[base]])
    const result = selectHomeWorld({ playerId, eligible, taken })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bodyId).not.toBe(eligible[base])
      expect(taken.has(result.bodyId)).toBe(false)
    }
  })

  it('reports exhaustion on the real catalogue when every body is taken', () => {
    const eligible = eligibleHomeBodies(PLANETS)
    const result = selectHomeWorld({
      playerId: 'real-exhaust',
      eligible,
      taken: new Set(eligible),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('exhausted')
    }
  })
})
