import { describe, expect, it } from 'vitest'
import {
  INVASION_STATUSES,
  commitInvasion,
  invasionInvariants,
  recruitTroops,
} from '../src/sim/combat/invasion'
import type {
  InvasionForce,
  RecruitTroopsInput,
} from '../src/sim/combat/invasion'
import type { OwnedPlanet } from '../src/sim/player/types'

const AT = 1_700_000_000_000

function planet(name: string, population: number): OwnedPlanet {
  return {
    name,
    entry: { name, hostname: `${name} Host`, systemCount: 1, tier: 1 },
    tier: 1,
    baselineIncomePerSec: 10,
    populationCapMultiplier: 1,
    claimedAt: AT,
    isHome: false,
    unconquerable: false,
    population,
    garrison: 0,
    fleet: 0,
  }
}

function input(overrides: Partial<RecruitTroopsInput> = {}): RecruitTroopsInput {
  return {
    attackerId: 'p1',
    planets: [planet('Alpha', 3_000), planet('Beta', 3_000)],
    desiredTroops: 5_000,
    fleetSize: 5_000,
    raisedAt: AT,
    at: AT,
    barracksLevels: new Map([
      ['Alpha', 1],
      ['Beta', 1],
    ]),
    ...overrides,
  }
}

function force(overrides: Partial<InvasionForce> = {}): InvasionForce {
  return {
    attackerId: 'p1',
    troops: 5_000,
    recruitedFrom: new Map([
      ['Alpha', 3_000],
      ['Beta', 2_000],
    ]),
    fleetSize: 1_000,
    raisedAt: AT,
    status: 'ready',
    ...overrides,
  }
}

describe('module-level lookup table is deep-frozen', () => {
  it('INVASION_STATUSES is frozen with the union', () => {
    expect(Object.isFrozen(INVASION_STATUSES)).toBe(true)
    expect([...INVASION_STATUSES]).toEqual([
      'assembling',
      'ready',
      'committed',
      'destroyed',
    ])
  })

  it('mutating the frozen table throws TypeError (runtime-immutable)', () => {
    expect(() => {
      ;(INVASION_STATUSES as unknown as string[]).push('flying')
    }).toThrow(TypeError)
  })
})

describe('recruitTroops recruitment math (DESIGN §5 locked semantics)', () => {
  it('hand-computed 2-planet pool: 3,000 + 3,000 → 5,000 recruited, 3,000 from the first', () => {
    const result = recruitTroops(input())
    expect(result.force.troops).toBe(5_000)
    expect([...result.force.recruitedFrom]).toEqual([
      ['Alpha', 3_000],
      ['Beta', 2_000],
    ])
    expect(result.deficiencies).toEqual([])
    expect(result.recruitmentCost.population).toBe(5_000)
  })

  it('tie-break is name asc: reversing the input order yields the same ledger', () => {
    const forward = recruitTroops(input())
    const reversed = recruitTroops(
      input({ planets: [planet('Beta', 3_000), planet('Alpha', 3_000)] }),
    )
    expect([...reversed.force.recruitedFrom]).toEqual([
      ['Alpha', 3_000],
      ['Beta', 2_000],
    ])
    expect(reversed.force.recruitedFrom).toEqual(forward.force.recruitedFrom)
  })

  it('larger pools are drawn from first: 4,000 + 2,000 desired 5,000 → 4,000 + 1,000', () => {
    const result = recruitTroops(
      input({
        planets: [planet('Small', 2_000), planet('Big', 4_000)],
        barracksLevels: new Map([
          ['Small', 1],
          ['Big', 1],
        ]),
      }),
    )
    expect([...result.force.recruitedFrom]).toEqual([
      ['Big', 4_000],
      ['Small', 1_000],
    ])
    expect(result.force.troops).toBe(5_000)
  })

  it('exact fit (desired === available) recruits everything with no deficiency', () => {
    const result = recruitTroops(
      input({ desiredTroops: 3_000, planets: [planet('Alpha', 3_000)] }),
    )
    expect(result.force.troops).toBe(3_000)
    expect(result.deficiencies).toEqual([])
    expect([...result.force.recruitedFrom]).toEqual([['Alpha', 3_000]])
  })

  it('deficiency: desired > available recruits the whole pool', () => {
    const result = recruitTroops(input({ desiredTroops: 8_000, fleetSize: 8_000 }))
    expect(result.force.troops).toBe(6_000)
    expect([...result.force.recruitedFrom]).toEqual([
      ['Alpha', 3_000],
      ['Beta', 3_000],
    ])
    expect(result.recruitmentCost.population).toBe(6_000)
  })

  it('deficiency message is the locked "insufficient population: need N, have M"', () => {
    const result = recruitTroops(input({ desiredTroops: 8_000, fleetSize: 8_000 }))
    expect(result.deficiencies).toEqual([
      'insufficient population: need 8000, have 6000',
    ])
  })

  it('zero-fleet edge: a fleet of 0 carries no troops (every desired > 0 is rejected)', () => {
    expect(() => recruitTroops(input({ fleetSize: 0 }))).toThrow(RangeError)
    expect(() => recruitTroops(input({ fleetSize: 0 }))).toThrow(/cannot recruit/)
    expect(() => recruitTroops(input({ fleetSize: 0, desiredTroops: 0 }))).toThrow(
      RangeError,
    )
  })

  it('records fleetSize, raisedAt and status ready on the force', () => {
    const result = recruitTroops(input({ fleetSize: 5_000, raisedAt: AT }))
    expect(result.force.fleetSize).toBe(5_000)
    expect(result.force.raisedAt).toBe(AT)
    expect(result.force.status).toBe('ready')
    expect(result.force.attackerId).toBe('p1')
  })

  it('recruitmentCost.credits is 0 (the launch cost is T01) and population is the recruited count', () => {
    const result = recruitTroops(input())
    expect(result.recruitmentCost).toEqual({ credits: 0, population: 5_000 })
  })

  it('garrison cap binds the pool via the locked helper: population 6,000 at barracks 1 → 5,000', () => {
    const result = recruitTroops(
      input({
        planets: [planet('Capped', 6_000)],
        barracksLevels: new Map([['Capped', 1]]),
        desiredTroops: 6_000,
        fleetSize: 6_000,
      }),
    )
    expect(result.force.troops).toBe(5_000)
    expect([...result.force.recruitedFrom]).toEqual([['Capped', 5_000]])
    expect(result.deficiencies).toEqual([
      'insufficient population: need 6000, have 5000',
    ])
  })

  it('effectiveLevel delegation: barracks 11 caps at 5,000 × 10.5 = 52,500', () => {
    const result = recruitTroops(
      input({
        planets: [planet('Tall', 60_000)],
        barracksLevels: new Map([['Tall', 11]]),
        desiredTroops: 60_000,
        fleetSize: 60_000,
      }),
    )
    expect(result.force.troops).toBe(52_500)
  })

  it('a planet missing from barracksLevels contributes nothing (cap 0), others still recruit', () => {
    const result = recruitTroops(
      input({
        planets: [planet('Alpha', 3_000), planet('NoBarracks', 9_000)],
        barracksLevels: new Map([['Alpha', 1]]),
        desiredTroops: 3_000,
      }),
    )
    expect(result.force.troops).toBe(3_000)
    expect([...result.force.recruitedFrom]).toEqual([['Alpha', 3_000]])
  })
})

describe('commitInvasion transitions (committed = lost whether win or lose)', () => {
  it('ready → committed', () => {
    const committed = commitInvasion(force(), AT)
    expect(committed.status).toBe('committed')
  })

  it('returns a fresh object and never mutates the input force', () => {
    const original = force()
    const committed = commitInvasion(original, AT)
    expect(committed).not.toBe(original)
    expect(original.status).toBe('ready')
    expect(committed.status).toBe('committed')
  })

  it('preserves troops, ledger, fleetSize and raisedAt on commit', () => {
    const committed = commitInvasion(force(), AT)
    expect(committed.troops).toBe(5_000)
    expect(committed.recruitedFrom).toEqual(force().recruitedFrom)
    expect(committed.fleetSize).toBe(1_000)
    expect(committed.raisedAt).toBe(AT)
    expect(committed.attackerId).toBe('p1')
  })

  it('assembling forces cannot be committed', () => {
    expect(() => commitInvasion(force({ status: 'assembling' }), AT)).toThrow(
      RangeError,
    )
  })

  it('already-committed forces cannot be committed again', () => {
    expect(() => commitInvasion(force({ status: 'committed' }), AT)).toThrow(
      RangeError,
    )
  })

  it('destroyed forces cannot be committed', () => {
    expect(() => commitInvasion(force({ status: 'destroyed' }), AT)).toThrow(
      RangeError,
    )
  })

  it('commitInvasion validates at', () => {
    expect(() => commitInvasion(force(), 0)).toThrow(RangeError)
    expect(() => commitInvasion(force(), Number.NaN)).toThrow(RangeError)
  })
})

describe('invasionInvariants structural checks', () => {
  it('ok on a valid force', () => {
    const { ok, problems } = invasionInvariants(force())
    expect(ok).toBe(true)
    expect(problems).toEqual([])
  })

  it('troops must be positive finite (0 and negative flagged)', () => {
    expect(invasionInvariants(force({ troops: 0 })).ok).toBe(false)
    expect(invasionInvariants(force({ troops: -100 })).ok).toBe(false)
  })

  it('recruitedFrom must sum to troops (mismatch and negative draws flagged)', () => {
    const sumMismatch = invasionInvariants(
      force({ recruitedFrom: new Map([['Alpha', 4_999]]) }),
    )
    expect(sumMismatch.ok).toBe(false)
    expect(sumMismatch.problems.join()).toContain('sums to')
    const negative = invasionInvariants(
      force({
        troops: 2_000,
        recruitedFrom: new Map([
          ['Alpha', 3_000],
          ['Beta', -1_000],
        ]),
      }),
    )
    expect(negative.ok).toBe(false)
  })

  it('recruitedFrom must be a Map', () => {
    const broken = invasionInvariants(
      force({ recruitedFrom: 'not-a-map' as unknown as Map<string, number> }),
    )
    expect(broken.ok).toBe(false)
    expect(broken.problems.join()).toContain('must be a Map')
  })

  it('fleetSize must be finite non-negative', () => {
    expect(invasionInvariants(force({ fleetSize: -1 })).ok).toBe(false)
    expect(invasionInvariants(force({ fleetSize: Number.NaN })).ok).toBe(false)
  })

  it('status must be in the union', () => {
    const bad = invasionInvariants(
      force({ status: 'flying' as InvasionForce['status'] }),
    )
    expect(bad.ok).toBe(false)
  })

  it('raisedAt must be a finite positive number', () => {
    expect(invasionInvariants(force({ raisedAt: 0 })).ok).toBe(false)
    expect(invasionInvariants(force({ raisedAt: Number.NaN })).ok).toBe(false)
  })

  it('attackerId must be non-empty', () => {
    expect(invasionInvariants(force({ attackerId: '' })).ok).toBe(false)
  })
})

describe('recruitTroops validation', () => {
  it('desiredTroops must be a positive integer', () => {
    expect(() => recruitTroops(input({ desiredTroops: 0 }))).toThrow(RangeError)
    expect(() => recruitTroops(input({ desiredTroops: -500 }))).toThrow(
      RangeError,
    )
    expect(() => recruitTroops(input({ desiredTroops: 1.5 }))).toThrow(
      RangeError,
    )
    expect(() => recruitTroops(input({ desiredTroops: Number.NaN }))).toThrow(
      RangeError,
    )
  })

  it('fleetSize must be finite non-negative', () => {
    expect(() => recruitTroops(input({ fleetSize: -1 }))).toThrow(RangeError)
    expect(() => recruitTroops(input({ fleetSize: Number.NaN }))).toThrow(
      RangeError,
    )
  })

  it('at, raisedAt and attackerId are validated', () => {
    expect(() => recruitTroops(input({ at: 0 }))).toThrow(RangeError)
    expect(() => recruitTroops(input({ raisedAt: 0 }))).toThrow(RangeError)
    expect(() => recruitTroops(input({ raisedAt: Number.NaN }))).toThrow(
      RangeError,
    )
    expect(() => recruitTroops(input({ attackerId: '  ' }))).toThrow(RangeError)
  })

  it('planets and barracksLevels are validated structurally', () => {
    expect(() =>
      recruitTroops(input({ planets: 'nope' as unknown as OwnedPlanet[] })),
    ).toThrow(RangeError)
    expect(() =>
      recruitTroops(input({ barracksLevels: 'nope' as unknown as Map<string, number> })),
    ).toThrow(RangeError)
  })

  it('duplicate planet names are rejected (ledger is keyed by name)', () => {
    expect(() =>
      recruitTroops(
        input({
          planets: [planet('Alpha', 3_000), planet('Alpha', 3_000)],
          desiredTroops: 5_000,
          barracksLevels: new Map([['Alpha', 1]]),
        }),
      ),
    ).toThrow(RangeError)
    expect(() =>
      recruitTroops(
        input({
          planets: [planet('Alpha', 3_000), planet('Alpha', 3_000)],
          desiredTroops: 5_000,
          barracksLevels: new Map([['Alpha', 1]]),
        }),
      ),
    ).toThrow(/duplicate/)
  })

  it('recruitedFrom always sums to troops on a valid recruitment', () => {
    const result = recruitTroops(input())
    const sum = [...result.force.recruitedFrom].reduce(
      (total, [, drawn]) => total + drawn,
      0,
    )
    expect(sum).toBe(result.force.troops)
    expect(result.force.troops).toBe(5_000)
  })

  it('negative planet population is rejected', () => {
    expect(() =>
      recruitTroops(input({ planets: [planet('Neg', -500)] })),
    ).toThrow(RangeError)
  })

  it('a zero recruitable pool cannot raise a force', () => {
    expect(() =>
      recruitTroops(
        input({
          planets: [planet('Empty', 0)],
          barracksLevels: new Map([['Empty', 1]]),
        }),
      ),
    ).toThrow(RangeError)
  })
})

describe('recruitTroops — fleet capacity (the fleet carries the committed force)', () => {
  it('rejects desiredTroops > fleetSize with the capacity RangeError', () => {
    expect(() => recruitTroops(input({ fleetSize: 4_000 }))).toThrow(RangeError)
    expect(() => recruitTroops(input({ fleetSize: 4_000 }))).toThrow(
      /cannot recruit 5000 troops into a fleet of 4000/,
    )
  })

  it('accepts desiredTroops === fleetSize (the whole-fleet edge)', () => {
    const result = recruitTroops(input({ fleetSize: 5_000 }))
    expect(result.force.troops).toBe(5_000)
    expect(result.force.fleetSize).toBe(5_000)
  })

  it('desiredTroops below fleetSize is accepted and the fleet is recorded', () => {
    const result = recruitTroops(input({ desiredTroops: 3_000, fleetSize: 5_000 }))
    expect(result.force.troops).toBe(3_000)
    expect(result.force.fleetSize).toBe(5_000)
  })
})

describe('recruitTroops purity', () => {
  it('is deterministic: repeated calls with the same input are deep-equal', () => {
    const a = recruitTroops(input())
    const b = recruitTroops(input())
    expect(a.force).toEqual(b.force)
    expect([...a.force.recruitedFrom]).toEqual([...b.force.recruitedFrom])
    expect(a.recruitmentCost).toEqual(b.recruitmentCost)
    expect(a.deficiencies).toEqual(b.deficiencies)
  })

  it('never mutates the input planets or barracksLevels', () => {
    const planets = [planet('Alpha', 3_000), planet('Beta', 3_000)]
    const barracksLevels = new Map([
      ['Alpha', 1],
      ['Beta', 1],
    ])
    const before = {
      planets: planets.map((p) => ({ ...p })),
      levels: new Map(barracksLevels),
    }
    recruitTroops(input({ planets, barracksLevels }))
    expect(planets).toEqual(before.planets)
    expect(planets[0].population).toBe(3_000)
    expect(barracksLevels).toEqual(before.levels)
    expect(barracksLevels.get('Alpha')).toBe(1)
  })
})
