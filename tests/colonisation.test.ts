import { describe, expect, it } from 'vitest'
import { bodyId, systemId } from '../src/sim/world/identity'
import type { BodyId } from '../src/sim/world/identity'
import { fnv1a } from '../src/sim/planets/hash'
import type { HomeProtection } from '../src/sim/player/protection'
import type { OwnershipEvent, OwnershipRecord } from '../src/sim/player/ownership'
import {
  COLONISATION_BASE_COST,
  colonisationCostFor,
  colonise,
} from '../src/sim/player/colonisation'
import type {
  ColonisationCost,
  ColoniseInput,
  ColonisationResult,
} from '../src/sim/player/colonisation'

const TARGET: BodyId = bodyId(systemId('catalogue', 'alpha'), 'planet', 3)
const OWNER = 'player-a'
const NOW = 1_700_000_000_000

const BASE_BODIES: BodyId[] = Array.from({ length: 40 }, (_, index) =>
  bodyId(systemId('catalogue', `host-${index}`), 'planet', 1),
)

function makeInput(overrides: Partial<ColoniseInput> = {}): ColoniseInput {
  return {
    bodyId: TARGET,
    ownerId: OWNER,
    wallet: { credits: 100_000, alloys: 100_000 },
    requirements: { hasFleet: true, hasTravel: true },
    existingOwners: new Set<BodyId>(),
    at: NOW,
    ...overrides,
  }
}

function protectedHome(overrides: Partial<HomeProtection> = {}): HomeProtection {
  return { bodyId: TARGET, ownerId: 'other', protected: true, ...overrides }
}

function expectRejection(
  result: ColonisationResult,
  reason: ColonisationRejectionReasonForTest,
): void {
  expect(result.ok).toBe(false)
  if (result.ok) {
    throw new Error('expected a rejection, got success')
  }
  expect(result.reason).toBe(reason)
}

type ColonisationRejectionReasonForTest =
  | 'already-owned'
  | 'protected'
  | 'requirements-not-met'
  | 'insufficient-funds'
  | 'invalid-target'

describe('P2-T06 colonisationCostFor — variance + determinism', () => {
  it('exports the default base cost of 500 credits and 100 alloys', () => {
    expect(COLONISATION_BASE_COST).toEqual({ credits: 500, alloys: 100 })
  })

  it('is deterministic: the same body id always yields the same cost', () => {
    const first = colonisationCostFor(TARGET)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(colonisationCostFor(TARGET)).toEqual(first)
    }
  })

  it('stays within [0.9x, 1.1x] of the base for many body ids', () => {
    for (const body of BASE_BODIES) {
      const cost = colonisationCostFor(body)
      expect(cost.credits).toBeGreaterThanOrEqual(450)
      expect(cost.credits).toBeLessThanOrEqual(550)
      expect(cost.alloys).toBeGreaterThanOrEqual(90)
      expect(cost.alloys).toBeLessThanOrEqual(110)
    }
  })

  it('is not constant: different body ids produce different costs', () => {
    const costs = BASE_BODIES.map((body) => {
      const cost = colonisationCostFor(body)
      return `${cost.credits}:${cost.alloys}`
    })
    expect(new Set(costs).size).toBeGreaterThan(1)
  })

  it('matches the documented multiplier formula exactly', () => {
    for (const body of BASE_BODIES.slice(0, 10)) {
      const multiplier = 0.9 + (fnv1a(body) % 21) / 100
      expect(colonisationCostFor(body)).toEqual({
        credits: Math.round(500 * multiplier),
        alloys: Math.round(100 * multiplier),
      })
    }
  })

  it('scales a custom base by the same per-body multiplier', () => {
    const custom: ColonisationCost = { credits: 600, alloys: 300 }
    for (const body of BASE_BODIES) {
      const scaled = colonisationCostFor(body, custom)
      expect(scaled.credits).toBeGreaterThanOrEqual(540)
      expect(scaled.credits).toBeLessThanOrEqual(660)
      expect(scaled.alloys).toBeGreaterThanOrEqual(270)
      expect(scaled.alloys).toBeLessThanOrEqual(330)
    }
  })

  it('uses the default base when no base is supplied and a custom one when given', () => {
    const defaulted = colonisationCostFor(TARGET)
    const explicit = colonisationCostFor(TARGET, COLONISATION_BASE_COST)
    const custom: ColonisationCost = { credits: 1_000, alloys: 1_000 }
    const overridden = colonisationCostFor(TARGET, custom)
    expect(explicit).toEqual(defaulted)
    expect(overridden.credits).toBeGreaterThanOrEqual(900)
    expect(overridden.credits).toBeLessThanOrEqual(1_100)
  })
})

describe('P2-T06 colonise — eligibility ladder (each reason hits exactly)', () => {
  it('rejects an unparseable or empty body id with invalid-target', () => {
    for (const bad of ['not-a-body-id', '', '   ']) {
      const result = colonise(makeInput({ bodyId: bad as unknown as BodyId }))
      expectRejection(result, 'invalid-target')
      if (!result.ok) {
        expect(result.cost).toEqual(colonisationCostFor(bad as unknown as BodyId))
      }
    }
  })

  it('rejects a body id whose canonical kind is not body (a system id)', () => {
    const result = colonise(
      makeInput({ bodyId: systemId('catalogue', 'alpha') as unknown as BodyId }),
    )
    expectRejection(result, 'invalid-target')
  })

  it('rejects a body already in existingOwners with already-owned', () => {
    const result = colonise(
      makeInput({ existingOwners: new Set<BodyId>([TARGET]) }),
    )
    expectRejection(result, 'already-owned')
  })

  it('reports already-owned before later ladder reasons (protected, requirements)', () => {
    const ownedAndBlocked: Array<Partial<ColoniseInput>> = [
      { protection: protectedHome() },
      { requirements: { hasFleet: false, hasTravel: true } },
      { wallet: { credits: 0, alloys: 0 } },
    ]
    for (const overrides of ownedAndBlocked) {
      const result = colonise(
        makeInput({ existingOwners: new Set<BodyId>([TARGET]), ...overrides }),
      )
      expectRejection(result, 'already-owned')
    }
  })

  it('rejects a protected target with protected (P2-T03 integration)', () => {
    const result = colonise(makeInput({ protection: protectedHome() }))
    expectRejection(result, 'protected')
  })

  it('does not block when protection is absent or its flag is false', () => {
    const absent = colonise(makeInput())
    const notProtected = colonise(
      makeInput({ protection: protectedHome({ protected: false }) }),
    )
    expect(absent.ok).toBe(true)
    expect(notProtected.ok).toBe(true)
  })

  it('rejects when either fleet or travel is missing with requirements-not-met', () => {
    const missingFleet = colonise(
      makeInput({ requirements: { hasFleet: false, hasTravel: true } }),
    )
    const missingTravel = colonise(
      makeInput({ requirements: { hasFleet: true, hasTravel: false } }),
    )
    const missingBoth = colonise(
      makeInput({ requirements: { hasFleet: false, hasTravel: false } }),
    )
    expectRejection(missingFleet, 'requirements-not-met')
    expectRejection(missingTravel, 'requirements-not-met')
    expectRejection(missingBoth, 'requirements-not-met')
  })

  it('reports requirements-not-met before insufficient-funds (ladder order)', () => {
    const result = colonise(
      makeInput({
        requirements: { hasFleet: false, hasTravel: true },
        wallet: { credits: 0, alloys: 0 },
      }),
    )
    expectRejection(result, 'requirements-not-met')
  })

  it('rejects with insufficient-funds when credits fall below the cost', () => {
    const cost = colonisationCostFor(TARGET)
    const result = colonise(
      makeInput({ wallet: { credits: cost.credits - 1, alloys: cost.alloys } }),
    )
    expectRejection(result, 'insufficient-funds')
  })

  it('rejects with insufficient-funds when alloys fall below the cost', () => {
    const cost = colonisationCostFor(TARGET)
    const result = colonise(
      makeInput({ wallet: { credits: cost.credits, alloys: cost.alloys - 1 } }),
    )
    expectRejection(result, 'insufficient-funds')
  })

  it('rejects with insufficient-funds when both resources are short', () => {
    const result = colonise(makeInput({ wallet: { credits: 0, alloys: 0 } }))
    expectRejection(result, 'insufficient-funds')
  })

  it('succeeds when the wallet exactly equals the cost (needs < to reject)', () => {
    const cost = colonisationCostFor(TARGET)
    const result = colonise(
      makeInput({ wallet: { credits: cost.credits, alloys: cost.alloys } }),
    )
    expect(result.ok).toBe(true)
  })
})

describe('P2-T06 colonise — success record/event/cost', () => {
  it('succeeds when every eligibility condition passes', () => {
    const result = colonise(makeInput())
    expect(result.ok).toBe(true)
  })

  it('produces an ownership record with method colonisation, isHome false, unconquerable false', () => {
    const result = colonise(makeInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const record: OwnershipRecord = result.record
    expect(record.bodyId).toBe(TARGET)
    expect(record.ownerId).toBe(OWNER)
    expect(record.previousOwnerId).toBeNull()
    expect(record.acquiredAt).toBe(NOW)
    expect(record.acquisitionMethod).toBe('colonisation')
    expect(record.isHome).toBe(false)
    expect(record.unconquerable).toBe(false)
  })

  it('produces an ownership event mirroring the record', () => {
    const result = colonise(makeInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const event: OwnershipEvent = result.event
    expect(event.bodyId).toBe(TARGET)
    expect(event.fromOwnerId).toBeNull()
    expect(event.toOwnerId).toBe(OWNER)
    expect(event.at).toBe(NOW)
    expect(event.method).toBe('colonisation')
  })

  it('reports the consumed cost equal to colonisationCostFor(bodyId)', () => {
    const result = colonise(makeInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cost).toEqual(colonisationCostFor(TARGET))
  })

  it('every rejection reports the same cost colonisationCostFor reports', () => {
    const ladderInputs: Array<Partial<ColoniseInput>> = [
      { bodyId: 'not-a-body' as unknown as BodyId },
      { existingOwners: new Set<BodyId>([TARGET]) },
      { protection: protectedHome() },
      { requirements: { hasFleet: false, hasTravel: true } },
      { wallet: { credits: 0, alloys: 0 } },
    ]
    for (const overrides of ladderInputs) {
      const result = colonise(makeInput(overrides))
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.cost).toEqual(colonisationCostFor(overrides.bodyId ?? TARGET))
    }
  })
})

describe('P2-T06 colonise — determinism, immutability, empty edges', () => {
  it('is deterministic: identical inputs produce identical results', () => {
    expect(colonise(makeInput())).toEqual(colonise(makeInput()))
  })

  it('never mutates the wallet input', () => {
    const wallet = { credits: 5_000, alloys: 1_000 }
    colonise(makeInput({ wallet }))
    expect(wallet).toEqual({ credits: 5_000, alloys: 1_000 })
  })

  it('never mutates the existingOwners set', () => {
    const existing = new Set<BodyId>([TARGET])
    colonise(makeInput({ existingOwners: existing }))
    expect(existing.size).toBe(1)
    expect(existing.has(TARGET)).toBe(true)
  })

  it('never mutates the protection input', () => {
    const protection = protectedHome()
    colonise(makeInput({ protection }))
    expect(protection).toEqual(protectedHome())
  })

  it('colonises an empty target when existingOwners is empty', () => {
    const result = colonise(makeInput({ existingOwners: new Set<BodyId>() }))
    expect(result.ok).toBe(true)
  })

  it('supports many owners in existingOwners without false duplicates', () => {
    const existing = new Set<BodyId>([
      bodyId(systemId('catalogue', 'gamma'), 'planet', 0),
      bodyId(systemId('catalogue', 'gamma'), 'planet', 1),
    ])
    const result = colonise(makeInput({ existingOwners: existing }))
    expect(result.ok).toBe(true)
  })

  it('throws RangeError on the success path when at is not a positive finite time', () => {
    for (const badAt of [0, -5, NaN, Infinity]) {
      expect(() => colonise(makeInput({ at: badAt }))).toThrow(RangeError)
    }
  })

  it('throws RangeError on the success path when ownerId is empty', () => {
    expect(() => colonise(makeInput({ ownerId: '' }))).toThrow(RangeError)
  })
})
