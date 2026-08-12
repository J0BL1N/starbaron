import { describe, expect, it } from 'vitest'
import { structureCost } from '../src/sim/core/economy'
import { SHIP_CLASSES, SHIP_CLASS_IDS } from '../src/sim/fleet/ships'
import type { ShipClass, ShipClassId } from '../src/sim/fleet/ships'
import {
  canBuildShips,
  shipBuildCost,
  shipyardStateFor,
} from '../src/sim/fleet/shipyard'
import type { ShipBuildOutcome, ShipBuildRequest } from '../src/sim/fleet/shipyard'
import { STRUCTURES } from '../src/sim/structures/data'
import { SHIPYARD_INCOME_PER_MIN, structureEffect } from '../src/sim/structures/effects'
import { buildCost } from '../src/sim/structures/framework'
import { effectiveLevel } from '../src/sim/planets/levels'
import type { WalletState } from '../src/sim/player/types'

const AT = 1_700_000_000_000

function wallet(credits: number, alloys: number): WalletState {
  return { credits, alloys }
}

function request(overrides: Partial<ShipBuildRequest> = {}): ShipBuildRequest {
  return { shipClass: 'scout', count: 1, at: AT, ...overrides }
}

interface BuildOverrides {
  shipyardLevel?: number
  fleet?: number
  wallet?: WalletState
  request?: ShipBuildRequest
  classStats?: ShipClass
}

function build(overrides: BuildOverrides = {}): ShipBuildOutcome {
  return canBuildShips({
    shipyardLevel: overrides.shipyardLevel ?? 1,
    fleet: overrides.fleet ?? 0,
    wallet: overrides.wallet ?? wallet(1e9, 1e9),
    request: overrides.request ?? request(),
    ...(overrides.classStats === undefined
      ? {}
      : { classStats: overrides.classStats }),
  })
}

function customClass(
  cost: { credits: number; alloys: number },
  buildTimeSec = 60,
): ShipClass {
  return { ...SHIP_CLASSES.corvette, cost: { ...cost }, buildTimeSec }
}

function effectFleetCap(level: number): number {
  const effect = structureEffect('shipyard', level)
  if (effect.kind !== 'shipyard') {
    throw new Error(`unexpected shipyard effect kind: ${effect.kind}`)
  }
  return effect.fleetCap
}

describe('shipyardStateFor', () => {
  it('exposes the base shipyard state at level 0 (fleetCap 0, income 50/60, cost 5000, 300s)', () => {
    const state = shipyardStateFor(0)
    expect(state).toEqual({
      level: 0,
      fleetCap: 0,
      incomePerSec: SHIPYARD_INCOME_PER_MIN / 60,
      nextBuildCost: structureCost(STRUCTURES.shipyard.baseCost, 0),
      buildTimeSec: STRUCTURES.shipyard.buildTimeSec,
    })
    expect(state.nextBuildCost).toBe(5_000)
    expect(state.buildTimeSec).toBe(300)
    expect(state.incomePerSec).toBeCloseTo(50 / 60, 12)
  })

  it('fleetCap = 1000 × level via the LOCKED structureEffect for every level', () => {
    for (const level of [0, 1, 2, 5, 10]) {
      const state = shipyardStateFor(level)
      expect(state.fleetCap, `${level}`).toBe(1_000 * level)
      expect(state.fleetCap, `${level}`).toBe(effectFleetCap(level))
    }
    expect(shipyardStateFor(100).fleetCap).toBe(1_000 * effectiveLevel(100))
  })

  it('incomePerSec is the LOCKED flat base SHIPYARD_INCOME_PER_MIN / 60 (no level scaling)', () => {
    for (const level of [0, 1, 3, 25]) {
      expect(shipyardStateFor(level).incomePerSec).toBe(
        SHIPYARD_INCOME_PER_MIN / 60,
      )
    }
  })

  it('nextBuildCost delegates to the LOCKED framework.buildCost (hand-computed 1 and 3)', () => {
    expect(shipyardStateFor(1).nextBuildCost).toBeCloseTo(5_000 * 1.15, 10)
    expect(shipyardStateFor(3).nextBuildCost).toBeCloseTo(5_000 * 1.15 ** 3, 10)
    for (const level of [0, 1, 2, 5, 10, 25]) {
      expect(shipyardStateFor(level).nextBuildCost, `${level}`).toBe(
        buildCost('shipyard', level),
      )
      expect(shipyardStateFor(level).nextBuildCost, `${level}`).toBe(
        structureCost(5_000, level),
      )
    }
  })

  it('buildTimeSec is the LOCKED data.ts shipyard build time (300s) for every level', () => {
    for (const level of [0, 1, 9]) {
      expect(shipyardStateFor(level).buildTimeSec).toBe(
        STRUCTURES.shipyard.buildTimeSec,
      )
      expect(shipyardStateFor(level).buildTimeSec).toBe(300)
    }
  })

  it('throws RangeError for negative, fractional and non-finite levels', () => {
    for (const bad of [-1, -0.5, 1.5, NaN, Infinity, -Infinity]) {
      expect(() => shipyardStateFor(bad)).toThrow(RangeError)
    }
  })

  it('is deterministic and returns fresh objects', () => {
    const a = shipyardStateFor(5)
    const b = shipyardStateFor(5)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

describe('shipBuildCost', () => {
  it('cost = class cost × count for roster classes', () => {
    expect(shipBuildCost(request({ shipClass: 'scout', count: 2 }))).toEqual({
      credits: 1_000,
      alloys: 0,
    })
    expect(shipBuildCost(request({ shipClass: 'corvette', count: 3 }))).toEqual({
      credits: 6_000,
      alloys: 150,
    })
  })

  it('honors an injected classStats record', () => {
    const stats = customClass({ credits: 100, alloys: 7 })
    expect(shipBuildCost(request({ count: 4 }), stats)).toEqual({
      credits: 400,
      alloys: 28,
    })
  })

  it('throws RangeError for non-positive or non-integer counts', () => {
    for (const bad of [0, -1, -3, 1.5, NaN, Infinity, -Infinity]) {
      expect(() => shipBuildCost(request({ count: bad }))).toThrow(RangeError)
    }
  })

  it('is deterministic and returns fresh cost objects', () => {
    const req = request({ shipClass: 'frigate', count: 5 })
    const a = shipBuildCost(req)
    const b = shipBuildCost(req)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

describe('canBuildShips reason ladder', () => {
  it('no-shipyard fires first (level 0) even with a rich wallet, and outranks an invalid count', () => {
    const outcome = build({ shipyardLevel: 0 })
    expect(outcome).toEqual({
      ok: false,
      reason: 'no-shipyard',
      fleetAfter: 0,
      cost: { credits: 0, alloys: 0 },
      completesAt: AT,
    })
    expect(
      build({ shipyardLevel: 0, request: request({ count: 0 }) }).reason,
    ).toBe('no-shipyard')
  })

  it('invalid-count fires before fleet-cap and funds checks', () => {
    for (const bad of [0, -1, 1.5]) {
      const outcome = build({ fleet: 999, request: request({ count: bad }) })
      expect(outcome.reason, `${bad}`).toBe('invalid-count')
      expect(outcome.fleetAfter).toBe(999)
    }
  })

  it('fleet-cap fires before credits/alloys', () => {
    const outcome = build({
      fleet: 999,
      request: request({ count: 2 }),
      wallet: wallet(1, 0),
    })
    expect(outcome.reason).toBe('fleet-cap')
  })

  it('not-enough-credits fires before not-enough-alloys', () => {
    const outcome = build({
      request: request({ shipClass: 'corvette', count: 1 }),
      wallet: wallet(1_999, 100),
    })
    expect(outcome.reason).toBe('not-enough-credits')
    expect(outcome.cost).toEqual({ credits: 2_000, alloys: 50 })
  })

  it('not-enough-alloys fires only after credits pass', () => {
    const outcome = build({
      request: request({ shipClass: 'corvette', count: 1 }),
      wallet: wallet(2_000, 49),
    })
    expect(outcome.reason).toBe('not-enough-alloys')
  })

  it('ok with exact funds: fleetAfter, cost, completesAt = at + buildTime × 1000', () => {
    const outcome = build({
      request: request({ shipClass: 'scout', count: 1 }),
      wallet: wallet(500, 0),
    })
    expect(outcome).toEqual({
      ok: true,
      reason: 'ok',
      fleetAfter: 1,
      cost: { credits: 500, alloys: 0 },
      completesAt: AT + 15 * 1000,
    })
  })
})

describe('canBuildShips fleet-cap math', () => {
  it('fleet + count === fleetCap passes; fleet + count > fleetCap fails (inclusive boundary)', () => {
    const atCap = build({ fleet: 999, request: request({ count: 1 }) })
    expect(atCap.reason).toBe('ok')
    expect(atCap.fleetAfter).toBe(1_000)
    const over = build({ fleet: 999, request: request({ count: 2 }) })
    expect(over.reason).toBe('fleet-cap')
    const atCapHigh = build({ fleet: 0, request: request({ count: 1_000 }) })
    expect(atCapHigh.reason).toBe('ok')
  })

  it('fleet-cap scales with shipyard level', () => {
    const level2 = build({
      shipyardLevel: 2,
      fleet: 1_999,
      request: request({ count: 2 }),
    })
    expect(level2.reason).toBe('fleet-cap')
    const fits = build({
      shipyardLevel: 2,
      fleet: 1_500,
      request: request({ count: 500 }),
    })
    expect(fits.reason).toBe('ok')
    expect(fits.fleetAfter).toBe(2_000)
  })

  it('failed builds leave fleetAfter unchanged', () => {
    const cases: BuildOverrides[] = [
      { fleet: 100, request: request({ count: 2_000 }) },
      {
        fleet: 100,
        request: request({ shipClass: 'battleship', count: 1 }),
        wallet: wallet(0, 0),
      },
      {
        fleet: 100,
        request: request({ shipClass: 'corvette', count: 1 }),
        wallet: wallet(2_000, 0),
      },
    ]
    for (const cfg of cases) {
      const outcome = build(cfg)
      expect(outcome.ok).toBe(false)
      expect(outcome.reason).not.toBe('ok')
      expect(outcome.fleetAfter).toBe(100)
    }
  })
})

describe('canBuildShips cost math × count', () => {
  it('battleship × 2 costs 200,000 cr and 6,000 alloys', () => {
    const outcome = build({ request: request({ shipClass: 'battleship', count: 2 }) })
    expect(outcome.ok).toBe(true)
    expect(outcome.cost).toEqual({ credits: 200_000, alloys: 6_000 })
  })

  it('every roster class × n costs class.cost × n', () => {
    const n = 4
    for (const id of SHIP_CLASS_IDS) {
      const expected = {
        credits: SHIP_CLASSES[id].cost.credits * n,
        alloys: SHIP_CLASSES[id].cost.alloys * n,
      }
      expect(shipBuildCost(request({ shipClass: id, count: n })), id).toEqual(
        expected,
      )
      const outcome = build({ request: request({ shipClass: id, count: n }) })
      expect(outcome.cost, id).toEqual(expected)
      expect(outcome.ok).toBe(true)
    }
  })

  it('injected classStats drives the outcome cost', () => {
    const stats = customClass({ credits: 100, alloys: 7 })
    const outcome = build({
      request: request({ count: 4 }),
      classStats: stats,
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.cost).toEqual({ credits: 400, alloys: 28 })
  })
})

describe('canBuildShips completesAt overflow-safety', () => {
  it('completesAt = at + class.buildTimeSec × 1000 on the ok path', () => {
    expect(
      build({ request: request({ shipClass: 'scout', count: 1 }) }).completesAt,
    ).toBe(AT + 15_000)
    expect(
      build({ request: request({ shipClass: 'corvette', count: 1 }) }).completesAt,
    ).toBe(AT + 30_000)
    expect(
      build({ request: request({ shipClass: 'battleship', count: 1 }) }).completesAt,
    ).toBe(AT + 300_000)
  })

  it('an at whose completesAt would overflow throws RangeError (like queues)', () => {
    expect(() => build({ request: request({ at: Number.MAX_VALUE }) })).toThrow(
      /completesAt/,
    )
    const large = build({
      request: request({ shipClass: 'battleship', at: Number.MAX_SAFE_INTEGER }),
    })
    expect(large.completesAt).toBe(Number.MAX_SAFE_INTEGER + 300_000)
    expect(large.completesAt).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
  })
})

describe('canBuildShips validation', () => {
  it('throws RangeError for a negative or fractional shipyard level', () => {
    for (const bad of [-1, 0.5, 1.5, NaN]) {
      expect(() => build({ shipyardLevel: bad })).toThrow(RangeError)
    }
  })

  it('throws RangeError for a non-finite or non-positive at', () => {
    for (const bad of [0, -100, NaN, Infinity, -Infinity]) {
      expect(() => build({ request: request({ at: bad }) })).toThrow(RangeError)
    }
  })

  it('throws RangeError for a non-finite fleet or wallet', () => {
    expect(() => build({ fleet: -1 })).toThrow(RangeError)
    expect(() => build({ fleet: NaN })).toThrow(RangeError)
    expect(() => build({ wallet: wallet(NaN, 0) })).toThrow(RangeError)
    expect(() => build({ wallet: wallet(0, Infinity) })).toThrow(RangeError)
  })

  it('throws RangeError for an unknown ship class id (default roster lookup)', () => {
    expect(() =>
      build({ request: request({ shipClass: 'dreadnought' as ShipClassId }) }),
    ).toThrow(RangeError)
  })
})

describe('canBuildShips determinism and purity', () => {
  it('identical inputs produce identical outcomes and no input is mutated', () => {
    const req = request({ shipClass: 'frigate', count: 3 })
    const purse = wallet(1e9, 1e9)
    const input = { shipyardLevel: 2, fleet: 500, wallet: purse, request: req }
    const reqBefore = { ...req }
    const purseBefore = { ...purse }
    const a = canBuildShips(input)
    const b = canBuildShips(input)
    expect(a).toEqual(b)
    expect(req).toEqual(reqBefore)
    expect(purse).toEqual(purseBefore)
    expect(a.cost).toEqual(b.cost)
    expect(a.cost).not.toBe(b.cost)
  })
})
