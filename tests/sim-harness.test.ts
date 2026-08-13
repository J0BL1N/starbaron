import { describe, expect, it } from 'vitest'
import {
  replayCheck,
  runScenario,
  scenarioTable,
} from '../src/sim/combat/sim-harness'
import type { BattleScenario, ScenarioResult } from '../src/sim/combat/sim-harness'
import { attackLaunchCost } from '../src/sim/combat/attack-orders'
import { conquestCostFor } from '../src/sim/combat/conquest-cost'
import { travelDuration } from '../src/sim/fleet/movement'
import { attackPower as lockedAttackPower } from '../src/sim/player/estimator'
import { defensePower as lockedDefensePower } from '../src/sim/structures/effects'

const AT = 1_700_000_000_000

// The DESIGN worked example: 5,000 troops × tier 2 = 10,000 AP vs 3 turrets +
// 10k population = 1,500 + 1,500 = 3,000 DP → VICTORY. distance 10 pc at
// 10/43200 pc/s gives a 43,200 s (12h) leg and a 1,300 cr launch (fleet 5,000).
function attacker(
  over: Partial<BattleScenario['attacker']> = {},
): BattleScenario['attacker'] {
  return {
    troops: 5_000,
    shipyardTier: 2,
    fleetSize: 5_000,
    conquests: 0,
    ...over,
  }
}

function defender(
  over: Partial<BattleScenario['defender']> = {},
): BattleScenario['defender'] {
  return {
    turretLevels: 3,
    population: 10_000,
    garrison: 2_000,
    fleetSize: 0,
    tier: 2,
    ...over,
  }
}

function scenario(
  over: Partial<BattleScenario> = {},
): BattleScenario {
  return {
    scenarioId: 'scenario-1',
    name: 'Raid on Kepler',
    attacker: attacker(),
    defender: defender(),
    distancePc: 10,
    speedPcPerSec: 10 / 43_200,
    at: AT,
    ...over,
  }
}

// Exact-parity stalemate: 5,000 troops × tier 2 = 10,000 AP; 8 turrets + 40k
// pop = 4,000 + 6,000 = 10,000 DP.
function stalemateScenario(): BattleScenario {
  return scenario({
    scenarioId: 'stalemate-1',
    attacker: attacker(),
    defender: defender({ turretLevels: 8, population: 40_000 }),
  })
}

// A losing raid: 1,000 troops × tier 1 = 1,000 AP < 3,000 DP.
function defeatScenario(): BattleScenario {
  return scenario({
    scenarioId: 'defeat-1',
    attacker: attacker({ troops: 1_000, shipyardTier: 1, fleetSize: 1_000 }),
    defender: defender(),
  })
}

describe('runScenario — the locked combat chain', () => {
  it('hand-computed victory: 5,000 × tier 2 = 10,000 AP beats 3 turrets + 10k pop = 3,000 DP and captures the planet', () => {
    const run = runScenario(scenario())
    expect(run.outcome.result).toBe('victory')
    expect(run.outcome.victory).toBe(true)
    expect(run.outcome.attackPower).toBe(10_000)
    expect(run.outcome.defensePower).toBe(3_000)
    expect(run.captured).toBe(true)
  })

  it('delegates the powers to the locked estimators (never re-derived)', () => {
    const run = runScenario(scenario())
    expect(run.outcome.attackPower).toBe(lockedAttackPower(5_000, 2))
    expect(run.outcome.defensePower).toBe(lockedDefensePower(3, 10_000))
  })

  it('delegates the launch cost and travel seconds to the locked modules', () => {
    const run = runScenario(scenario())
    expect(run.launchCost).toBe(attackLaunchCost(5_000, 10).credits)
    expect(run.launchCost).toBe(1_300)
    expect(run.travelSeconds).toBe(travelDuration(10, 10 / 43_200))
    expect(run.travelSeconds).toBe(43_200)
  })

  it('victory survivors and the attacker ledger: 3,500 survive, 1,500 lost, none fleet-lost', () => {
    const run = runScenario(scenario())
    expect(run.outcome.survivingTroops).toBe(3_500)
    expect(run.ledger.attacker.troopsCommitted).toBe(5_000)
    expect(run.ledger.attacker.survivors).toBe(3_500)
    expect(run.ledger.attacker.populationLoss).toBe(1_500)
    expect(run.ledger.attacker.fleetLost).toBe(false)
  })

  it('victory defender losses: 1,000 population (floor 10k × 0.1) and the garrison wiped in the fall', () => {
    const run = runScenario(scenario())
    expect(run.ledger.defender.populationLoss).toBe(1_000)
    expect(run.ledger.defender.garrisonLoss).toBe(2_000)
  })

  it('a victory carries the locked conquest cost (T2, no prior conquests) and escalation raises it', () => {
    const run = runScenario(scenario())
    const locked = conquestCostFor({
      targetId: 'target:scenario-1',
      tier: 2,
      attackerConquests: 0,
    })
    expect(run.cost).toEqual(locked)
    expect(run.cost!.escalation.multiplier).toBe(1)
    expect(run.cost!.total).toEqual({ population: 4_000, fleet: 2_000, credits: 100_000 })

    const escalated = runScenario(
      scenario({ attacker: attacker({ conquests: 3 }) }),
    )
    expect(escalated.cost!.escalation).toEqual({
      multiplier: 1.3,
      reason: 'recent conquest #3',
    })
    expect(escalated.cost!.total).toEqual({
      population: 5_200,
      fleet: 2_600,
      credits: 130_000,
    })
  })

  it('a losing raid: repelled, no cost, no capture, fleet lost, every committed troop lost', () => {
    const run = runScenario(defeatScenario())
    expect(run.outcome.result).toBe('defeat')
    expect(run.outcome.victory).toBe(false)
    expect(run.outcome.attackPower).toBe(1_000)
    expect(run.outcome.defensePower).toBe(3_000)
    expect(run.outcome.survivingTroops).toBe(0)
    expect(run.captured).toBe(false)
    expect(run.cost).toBeNull()
    expect(run.ledger.attacker.populationLoss).toBe(1_000)
    expect(run.ledger.attacker.fleetLost).toBe(true)
    expect(run.ledger.defender.populationLoss).toBe(2_000)
    expect(run.ledger.defender.garrisonLoss).toBe(400)
  })

  it('a stalemate at exact parity: AP == DP → defenders hold, half the force withdraws, no cost', () => {
    const run = runScenario(stalemateScenario())
    expect(run.outcome.attackPower).toBe(10_000)
    expect(run.outcome.defensePower).toBe(10_000)
    expect(run.outcome.result).toBe('stalemate')
    expect(run.outcome.survivingTroops).toBe(2_500)
    expect(run.outcome.defenderCasualties).toBe(0)
    expect(run.captured).toBe(false)
    expect(run.cost).toBeNull()
    expect(run.ledger.attacker.populationLoss).toBe(2_500)
    expect(run.ledger.defender.populationLoss).toBe(0)
    expect(run.ledger.defender.garrisonLoss).toBe(0)
  })

  it('derives the outcome identities deterministically from the scenarioId', () => {
    const run = runScenario(scenario())
    expect(run.outcome.attackerId).toBe('attacker:scenario-1')
    expect(run.outcome.targetId).toBe('target:scenario-1')
    expect(run.ledger.attackerId).toBe('attacker:scenario-1')
    expect(run.ledger.targetId).toBe('target:scenario-1')
  })

  it('is deterministic: identical input yields deep-equal results', () => {
    expect(runScenario(scenario())).toEqual(runScenario(scenario()))
  })

  it('never mutates its input scenario', () => {
    const input = scenario()
    const snapshot = {
      ...input,
      attacker: { ...input.attacker },
      defender: { ...input.defender },
    }
    runScenario(input)
    expect(input).toEqual(snapshot)
  })
})

describe('runScenario — the deterministic report', () => {
  it('renders the DESIGN worked-example one-liner', () => {
    const run = runScenario(scenario())
    expect(run.report).toBe(
      'VICTORY · 1,300 cr launch · 12h travel · 1,500 troops lost',
    )
  })

  it('renders a defeat report with all committed troops lost', () => {
    const run = runScenario(defeatScenario())
    expect(run.report).toBe('DEFEAT · 500 cr launch · 12h travel · 1,000 troops lost')
  })

  it('renders a stalemate report with the withdrawn force', () => {
    const run = runScenario(stalemateScenario())
    expect(run.report).toBe(
      'STALEMATE · 1,300 cr launch · 12h travel · 2,500 troops lost',
    )
  })

  it('renders the travel duration as seconds, minutes and hours deterministically', () => {
    expect(runScenario(scenario({ distancePc: 45, speedPcPerSec: 1 })).report).toContain(
      '45s travel',
    )
    expect(runScenario(scenario({ distancePc: 90, speedPcPerSec: 1 })).report).toContain(
      '2m travel',
    )
    expect(runScenario(scenario({ distancePc: 10, speedPcPerSec: 10 / 43_200 })).report).toContain(
      '12h travel',
    )
  })

  it('keeps the report part of the deterministic result (same input → same report)', () => {
    expect(runScenario(scenario()).report).toBe(runScenario(scenario()).report)
  })
})

describe('scenarioTable', () => {
  it('emits one row per scenario, sorted by scenarioId', () => {
    const rows = scenarioTable([
      scenario({ scenarioId: 'zeta' }),
      scenario({ scenarioId: 'alpha' }),
      scenario({ scenarioId: 'mike' }),
    ])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatch(/^alpha /)
    expect(rows[1]).toMatch(/^mike /)
    expect(rows[2]).toMatch(/^zeta /)
  })

  it('each row carries the scenarioId and its one-line report', () => {
    const rows = scenarioTable([
      scenario({ scenarioId: 'alpha' }),
      scenario({ scenarioId: 'beta', attacker: attacker({ troops: 1_000, fleetSize: 1_000 }) }),
    ])
    expect(rows[0]).toBe(
      'alpha → VICTORY · 1,300 cr launch · 12h travel · 1,500 troops lost',
    )
    expect(rows[1]).toBe(
      'beta → DEFEAT · 500 cr launch · 12h travel · 1,000 troops lost',
    )
  })

  it('is deterministic and handles an empty list', () => {
    expect(scenarioTable([])).toEqual([])
    const scenarios = [
      scenario({ scenarioId: 'zeta' }),
      scenario({ scenarioId: 'alpha' }),
    ]
    expect(scenarioTable(scenarios)).toEqual(scenarioTable(scenarios))
  })
})

describe('replayCheck — deterministic replay', () => {
  it('replays the same scenario as identical (no first difference)', () => {
    const recorded = runScenario(scenario())
    const rerun = runScenario(scenario())
    const check = replayCheck(recorded, rerun)
    expect(check.identical).toBe(true)
    expect(check.firstDifference).toBeNull()
  })

  it('names a tampered attack power as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      outcome: { ...recorded.outcome, attackPower: recorded.outcome.attackPower + 1 },
    }
    expect(replayCheck(recorded, rerun)).toEqual({
      identical: false,
      firstDifference: 'outcome.attackPower',
    })
  })

  it('names a tampered survivor count as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      outcome: {
        ...recorded.outcome,
        survivingTroops: recorded.outcome.survivingTroops + 1,
      },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe(
      'outcome.survivingTroops',
    )
  })

  it('names a tampered ledger loss as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      ledger: {
        ...recorded.ledger,
        attacker: {
          ...recorded.ledger.attacker,
          populationLoss: recorded.ledger.attacker.populationLoss + 1,
        },
      },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe(
      'ledger.attacker.populationLoss',
    )
  })

  it('names a tampered captured flag as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = { ...recorded, captured: !recorded.captured }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('captured')
  })

  it('names a tampered report as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = { ...recorded, report: `${recorded.report} X` }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('report')
  })

  it('names a tampered conquest-cost total as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      cost: {
        ...recorded.cost!,
        total: { ...recorded.cost!.total, credits: recorded.cost!.total.credits + 1 },
      },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe(
      'cost.total.credits',
    )
  })

  it('names cost when a victory payload drops its conquest cost', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = { ...recorded, cost: null }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('cost')
  })

  it('names a tampered travelSeconds as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      travelSeconds: recorded.travelSeconds + 1,
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('travelSeconds')
  })

  it('names a tampered launchCost as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      launchCost: recorded.launchCost + 1,
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('launchCost')
  })

  it('names a tampered scenarioId as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = { ...recorded, scenarioId: 'other' }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('scenarioId')
  })
})

describe('runScenario — validation', () => {
  it('rejects a bad shipyard tier', () => {
    for (const bad of [101, -1, 2.5, Number.NaN]) {
      expect(
        () =>
          runScenario(
            scenario({ attacker: attacker({ shipyardTier: bad }) }),
          ),
        `shipyardTier ${bad}`,
      ).toThrow(RangeError)
    }
  })

  it('rejects a bad speed', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => runScenario(scenario({ speedPcPerSec: bad })),
        `speedPcPerSec ${bad}`,
      ).toThrow(RangeError)
    }
  })

  it('rejects a bad population and a bad at', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () =>
          runScenario(
            scenario({ defender: defender({ population: bad }) }),
          ),
        `population ${bad}`,
      ).toThrow(RangeError)
    }
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => runScenario(scenario({ at: bad })),
        `at ${bad}`,
      ).toThrow(RangeError)
    }
  })

  it('rejects a bad defender tier even on a scenario that ends in defeat', () => {
    expect(
      () =>
        runScenario(
          defeatScenario(),
        ),
    ).not.toThrow()
    expect(
      () =>
        runScenario({
          ...defeatScenario(),
          defender: defender({ tier: 0 }),
        }),
    ).toThrow(RangeError)
  })

  it('rejects a malformed envelope: empty id, bad troops, turrets, garrison, conquests, fleet or distance', () => {
    expect(() => runScenario(scenario({ scenarioId: '   ' }))).toThrow(RangeError)
    expect(() => runScenario(scenario({ name: '' }))).toThrow(RangeError)
    expect(() => runScenario(scenario({ attacker: attacker({ troops: 0 }) }))).toThrow(RangeError)
    expect(() => runScenario(scenario({ attacker: attacker({ fleetSize: -1 }) }))).toThrow(RangeError)
    expect(() => runScenario(scenario({ attacker: attacker({ conquests: -1 }) }))).toThrow(RangeError)
    expect(() => runScenario(scenario({ defender: defender({ turretLevels: -1 }) }))).toThrow(RangeError)
    expect(() => runScenario(scenario({ defender: defender({ garrison: -1 }) }))).toThrow(RangeError)
    expect(() => runScenario(scenario({ defender: defender({ fleetSize: -1 }) }))).toThrow(RangeError)
    expect(() => runScenario(scenario({ distancePc: -1 }))).toThrow(RangeError)
  })
})
