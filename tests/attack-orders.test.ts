import { describe, expect, it } from 'vitest'
import {
  ATTACK_LAUNCH_BASE_CR,
  ATTACK_LAUNCH_PER_FLEET_CR,
  ATTACK_LAUNCH_PER_PC_CR,
  ATTACK_ORDER_STATUSES,
  ATTACK_OUTCOMES,
  ATTACK_TARGET_KINDS,
  abortAttack,
  attackLaunchCost,
  attackStatusAt,
  launchAttack,
} from '../src/sim/combat/attack-orders'
import type { AttackOrder } from '../src/sim/combat/attack-orders'
import { fnv1a } from '../src/sim/planets/hash'
import { PVP_CONSTANTS } from '../src/sim/player/estimator'
import type { PlayerState, WalletState } from '../src/sim/player/types'
import { HOME_WORLD_IMMUNITY_REASON } from '../src/sim/combat/home-immunity'

const AT = 1_700_000_000_000

function wallet(credits = 10_000, alloys = 0): WalletState {
  return { credits, alloys }
}

/** A target owner whose home world is a different, protected world. */
function player(ownerId: string, homeName: string): PlayerState {
  return {
    playerId: ownerId,
    homePlanet: {
      name: homeName,
      entry: { name: homeName, hostname: `${homeName} Host`, systemCount: 1, tier: 1 },
      tier: 1,
      baselineIncomePerSec: 10,
      populationCapMultiplier: 1,
      claimedAt: AT,
      isHome: true,
      unconquerable: true,
      population: 0,
      garrison: 0,
      fleet: 0,
    },
    colonies: [],
    wallet: wallet(),
    structureLevels: {},
    lastTickAt: AT,
  }
}

function targetRef(kind: 'planet' | 'system', id: string): {
  kind: 'planet' | 'system'
  id: string
} {
  return { kind, id }
}

function launchInput(
  overrides: Partial<Parameters<typeof launchAttack>[0]> = {},
): Parameters<typeof launchAttack>[0] {
  return {
    attackerId: 'attacker-1',
    fleetId: 'fleet-1',
    targetRef: targetRef('planet', 'target-1'),
    troopsCommitted: 5000,
    fleetSize: 5000,
    distancePc: 10,
    launchAt: AT,
    speedPcPerSec: 1,
    wallet: wallet(),
    targetOwner: null,
    ...overrides,
  }
}

function launchedOrder(
  overrides: Partial<Parameters<typeof launchAttack>[0]> = {},
): AttackOrder {
  return launchAttack(launchInput(overrides)).order
}

describe('attackLaunchCost — DESIGN-locked launch cost (§5a)', () => {
  it('a 5,000-fleet raid on a 10 pc target costs 1,300 cr (200 + 1000 + 100)', () => {
    expect(attackLaunchCost(5000, 10)).toEqual({ credits: 1300 })
  })

  it('delegates the LOCKED formula to the estimator launchCost (0006 seed parity)', () => {
    expect(attackLaunchCost(100, 1)).toEqual({ credits: 230 })
    expect(attackLaunchCost(0, 0)).toEqual({ credits: 200 })
    expect(attackLaunchCost(100, 0)).toEqual({ credits: 220 })
  })

  it('exports DESIGN-locked consts aliasing PVP_CONSTANTS (no balance drift)', () => {
    expect(ATTACK_LAUNCH_BASE_CR).toBe(PVP_CONSTANTS.launch_cost_base_credits)
    expect(ATTACK_LAUNCH_PER_FLEET_CR).toBe(PVP_CONSTANTS.launch_cost_per_fleet_credits)
    expect(ATTACK_LAUNCH_PER_PC_CR).toBe(PVP_CONSTANTS.launch_cost_per_pc_credits)
    expect(ATTACK_LAUNCH_BASE_CR).toBe(200)
    expect(ATTACK_LAUNCH_PER_FLEET_CR).toBe(0.2)
    expect(ATTACK_LAUNCH_PER_PC_CR).toBe(10)
  })

  it('throws RangeError for a non-integer or negative fleetSize, and a bad distancePc', () => {
    for (const bad of [5000.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => attackLaunchCost(bad, 10), String(bad)).toThrow(RangeError)
    }
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => attackLaunchCost(5000, bad), String(bad)).toThrow(RangeError)
    }
  })
})

describe('launchAttack — happy path', () => {
  it('launches an attack with status launched, outcome pending and every field set', () => {
    const { order, cost } = launchAttack(launchInput())
    expect(order.attackerId).toBe('attacker-1')
    expect(order.fleetId).toBe('fleet-1')
    expect(order.targetRef).toEqual({ kind: 'planet', id: 'target-1' })
    expect(order.troopsCommitted).toBe(5000)
    expect(order.launchAt).toBe(AT)
    expect(order.status).toBe('launched')
    expect(order.outcome).toBe('pending')
    expect(cost).toEqual({ credits: 1300 })
  })

  it('arrivalAt = launchAt + travelDuration(distance, speed) × 1000', () => {
    const order = launchAttack(launchInput()).order
    expect(order.arrivalAt).toBe(AT + 10 * 1000)
    const slow = launchAttack(launchInput({ speedPcPerSec: 0.25 })).order
    expect(slow.arrivalAt).toBe(AT + 40 * 1000)
  })

  it('returns the same launch cost in cost and order.launchCost', () => {
    const { order, cost } = launchAttack(launchInput())
    expect(cost).toEqual({ credits: 1300 })
    expect(order.launchCost).toEqual({ credits: 1300 })
  })

  it('id is the deterministic fnv1a(attackerId|fleetId|launchAt|targetId) hash', () => {
    const order = launchAttack(launchInput()).order
    expect(order.id).toBe(fnv1a('attacker-1|fleet-1|' + AT + '|target-1').toString(16))
    expect(order.id.length).toBeGreaterThan(0)
  })
})

describe('launchAttack — validation', () => {
  it('throws when troopsCommitted exceeds fleetSize (the committed subset rule)', () => {
    expect(() =>
      launchAttack(launchInput({ troopsCommitted: 5001, fleetSize: 5000 })),
    ).toThrow(Error)
  })

  it('accepts troopsCommitted === fleetSize (the whole fleet committed)', () => {
    const { order, cost } = launchAttack(
      launchInput({ troopsCommitted: 2500, fleetSize: 2500 }),
    )
    expect(order.troopsCommitted).toBe(2500)
    expect(cost).toEqual({ credits: 800 })
  })

  it('throws RangeError for non-positive, non-integer troops/fleetSize', () => {
    for (const bad of [0, -5, 2.5, Number.NaN]) {
      expect(() => launchAttack(launchInput({ troopsCommitted: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
    for (const bad of [-1, 2.5, Number.NaN]) {
      expect(() => launchAttack(launchInput({ fleetSize: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
  })

  it('throws Error when the wallet is short of the launch cost; exact balance is fine', () => {
    expect(() => launchAttack(launchInput({ wallet: wallet(1299) }))).toThrow(Error)
    expect(launchAttack(launchInput({ wallet: wallet(1300) })).cost).toEqual({
      credits: 1300,
    })
  })

  it('throws RangeError for a malformed wallet (negative or non-finite credits)', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        launchAttack(launchInput({ wallet: { credits: bad, alloys: 0 } })),
      ).toThrow(RangeError)
    }
  })

  it('throws RangeError for empty attackerId or fleetId', () => {
    expect(() => launchAttack(launchInput({ attackerId: '' }))).toThrow(RangeError)
    expect(() => launchAttack(launchInput({ fleetId: '' }))).toThrow(RangeError)
  })

  it('throws RangeError for an invalid targetRef kind or empty target id', () => {
    expect(() =>
      launchAttack(launchInput({ targetRef: { kind: 'moon' as never, id: 'x' } })),
    ).toThrow(RangeError)
    expect(() =>
      launchAttack(launchInput({ targetRef: targetRef('planet', '') })),
    ).toThrow(RangeError)
  })

  it('throws RangeError for a non-positive or non-finite launchAt', () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => launchAttack(launchInput({ launchAt: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
  })

  it('delegates arrival validation to movement (bad speed, zero distance, overflow)', () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => launchAttack(launchInput({ speedPcPerSec: bad })), String(bad)).toThrow(
        RangeError,
      )
    }
    expect(() => launchAttack(launchInput({ distancePc: 0 }))).toThrow(RangeError)
    expect(() =>
      launchAttack(launchInput({ speedPcPerSec: 1e-308 })),
    ).toThrow(RangeError)
  })
})

describe('launchAttack — home-immunity guard (T08 wired)', () => {
  it('throws the guard Error when the target is a protected home world of its owner', () => {
    const owner = player('owner-1', 'home-1')
    expect(() =>
      launchAttack(
        launchInput({
          targetOwner: owner,
          targetRef: targetRef('planet', 'home-1'),
        }),
      ),
    ).toThrow(Error)
    expect(() =>
      launchAttack(
        launchInput({
          targetOwner: owner,
          targetRef: targetRef('planet', 'home-1'),
        }),
      ),
    ).toThrow(HOME_WORLD_IMMUNITY_REASON)
  })

  it('allows a launch against an owned non-home world (a colony of the owner)', () => {
    const owner = player('owner-1', 'owner-home')
    const { order } = launchAttack(
      launchInput({ targetOwner: owner, targetRef: targetRef('planet', 'colony-9') }),
    )
    expect(order.status).toBe('launched')
    expect(order.targetRef.id).toBe('colony-9')
  })

  it('allows a launch against an unowned target (targetOwner null)', () => {
    const { order } = launchAttack(launchInput({ targetOwner: null }))
    expect(order.status).toBe('launched')
  })
})

describe('attackStatusAt — time projection windows', () => {
  it('projects at < launchAt as launched (pre-departure)', () => {
    const order = launchedOrder()
    expect(attackStatusAt(order, order.launchAt - 1).status).toBe('launched')
    expect(attackStatusAt(order, order.launchAt - 5000).status).toBe('launched')
  })

  it('boundary: at == launchAt is traveling (inclusive, positioning convention)', () => {
    const projection = attackStatusAt(launchedOrder(), AT)
    expect(projection.status).toBe('traveling')
    expect(projection.outcome).toBe('pending')
  })

  it('projects mid-travel as traveling with outcome pending', () => {
    const order = launchedOrder()
    const projection = attackStatusAt(order, order.launchAt + 4000)
    expect(projection.status).toBe('traveling')
    expect(projection.outcome).toBe('pending')
  })

  it('boundary: at == arrivalAt is arrived (inclusive, positioning convention)', () => {
    const order = launchedOrder()
    expect(attackStatusAt(order, order.arrivalAt).status).toBe('arrived')
  })

  it('projects after arrivalAt as arrived — the resolution window is [arrivalAt, ∞)', () => {
    const order = launchedOrder()
    expect(attackStatusAt(order, order.arrivalAt + 1).status).toBe('arrived')
    expect(attackStatusAt(order, order.arrivalAt + 86_400_000).status).toBe('arrived')
  })

  it('projects a stored aborted order as aborted with outcome aborted', () => {
    const aborted = abortAttack(launchedOrder(), AT + 5000)
    const projection = attackStatusAt(aborted, AT + 5000)
    expect(projection.status).toBe('aborted')
    expect(projection.outcome).toBe('aborted')
  })

  it('projects a stored resolved order as resolved carrying its outcome', () => {
    const order: AttackOrder = { ...launchedOrder(), status: 'resolved', outcome: 'victory' }
    const projection = attackStatusAt(order, order.arrivalAt + 1000)
    expect(projection.status).toBe('resolved')
    expect(projection.outcome).toBe('victory')
  })

  it('projects a stored resolving order as resolving with outcome pending', () => {
    const order: AttackOrder = { ...launchedOrder(), status: 'resolving' }
    const projection = attackStatusAt(order, order.arrivalAt)
    expect(projection.status).toBe('resolving')
    expect(projection.outcome).toBe('pending')
  })
})

describe('attackStatusAt — progress string', () => {
  it('progress is en route · 0% at launchAt, clamped 100% at/after arrival, 0% before launch', () => {
    const order = launchedOrder()
    expect(attackStatusAt(order, order.launchAt).progress).toBe('en route · 0%')
    expect(attackStatusAt(order, order.arrivalAt).progress).toBe('en route · 100%')
    expect(attackStatusAt(order, order.arrivalAt + 5000).progress).toBe('en route · 100%')
    expect(attackStatusAt(order, order.launchAt - 5000).progress).toBe('en route · 0%')
  })

  it('progress is en route · 45% at 45% of the leg (round of clamped ratio), and is deterministic', () => {
    const order = launchedOrder() // 10 s leg = 10,000 ms
    const at = order.launchAt + 4500
    const projection = attackStatusAt(order, at)
    expect(projection.progress).toBe('en route · 45%')
    expect(projection).toEqual(attackStatusAt(order, at))
  })

  it('aborted and resolved orders report their terminal progress strings', () => {
    const aborted = abortAttack(launchedOrder(), AT + 5000)
    expect(attackStatusAt(aborted, AT + 5000).progress).toBe('aborted')
    const resolved: AttackOrder = { ...launchedOrder(), status: 'resolved', outcome: 'defeat' }
    expect(attackStatusAt(resolved, resolved.arrivalAt).progress).toBe('resolved')
  })
})

describe('abortAttack — lifecycle transition', () => {
  it('aborts a launched order (status + outcome become aborted)', () => {
    const order = launchedOrder()
    const aborted = abortAttack(order, AT + 1)
    expect(aborted.status).toBe('aborted')
    expect(aborted.outcome).toBe('aborted')
    expect(aborted.arrivalAt).toBe(order.arrivalAt)
  })

  it('aborts a traveling order', () => {
    const order = launchedOrder()
    const aborted = abortAttack(order, order.launchAt + 4000)
    expect(aborted.status).toBe('aborted')
    expect(aborted.outcome).toBe('aborted')
  })

  it('returns a fresh order and never mutates the input (copied targetRef)', () => {
    const order = launchedOrder()
    const aborted = abortAttack(order, AT + 5000)
    expect(aborted).not.toBe(order)
    expect(order.status).toBe('launched')
    expect(order.outcome).toBe('pending')
    expect(aborted.targetRef).toEqual(order.targetRef)
    expect(aborted.targetRef).not.toBe(order.targetRef)
  })

  it('throws when aborting an arrived or resolving order (on the ground / in resolution)', () => {
    const arrived: AttackOrder = { ...launchedOrder(), status: 'arrived' }
    expect(() => abortAttack(arrived, arrived.arrivalAt)).toThrow(Error)
    const resolving: AttackOrder = { ...launchedOrder(), status: 'resolving' }
    expect(() => abortAttack(resolving, resolving.arrivalAt)).toThrow(Error)
  })

  it('throws when aborting a resolved or aborted order (terminal states)', () => {
    const resolved: AttackOrder = { ...launchedOrder(), status: 'resolved', outcome: 'victory' }
    expect(() => abortAttack(resolved, resolved.arrivalAt)).toThrow(Error)
    const aborted = abortAttack(launchedOrder(), AT + 1000)
    expect(() => abortAttack(aborted, AT + 2000)).toThrow(Error)
  })

  it('throws RangeError for a non-positive or non-finite abort at', () => {
    const order = launchedOrder()
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => abortAttack(order, bad), String(bad)).toThrow(RangeError)
    }
  })
})

describe('purity — determinism, immutability and frozen tables', () => {
  it('launchAttack is deterministic and never mutates its inputs', () => {
    const input = launchInput()
    const walletBefore = { ...input.wallet }
    const targetBefore = { ...input.targetRef }
    const a = launchAttack(input)
    const b = launchAttack(input)
    expect(a).toEqual(b)
    expect(a.order).not.toBe(b.order)
    expect(input.wallet).toEqual(walletBefore)
    expect(input.targetRef).toEqual(targetBefore)
  })

  it('module-level lookup tables are deep-frozen (runtime-immutable)', () => {
    for (const table of [ATTACK_TARGET_KINDS, ATTACK_ORDER_STATUSES, ATTACK_OUTCOMES]) {
      expect(Object.isFrozen(table)).toBe(true)
    }
    expect([...ATTACK_TARGET_KINDS]).toEqual(['planet', 'system'])
    expect([...ATTACK_ORDER_STATUSES]).toEqual([
      'launched',
      'traveling',
      'arrived',
      'resolving',
      'resolved',
      'aborted',
    ])
    expect([...ATTACK_OUTCOMES]).toEqual(['pending', 'victory', 'defeat', 'aborted'])
    expect(() => {
      ;(ATTACK_ORDER_STATUSES as unknown as string[]).push('moon')
    }).toThrow(TypeError)
  })
})
