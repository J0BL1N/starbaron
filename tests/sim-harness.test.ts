import { describe, expect, it } from 'vitest'
import {
  replayCheck,
  runScenario,
  scenarioTable,
} from '../src/sim/combat/sim-harness'
import type { BattleScenario, ScenarioResult } from '../src/sim/combat/sim-harness'
import { attackLaunchCost } from '../src/sim/combat/attack-orders'
import type { CaptureSettlement } from '../src/sim/combat/capture'
import { conquestCostFor } from '../src/sim/combat/conquest-cost'
import { travelDuration } from '../src/sim/fleet/movement'
import { attackPower as lockedAttackPower } from '../src/sim/player/estimator'
import { defensePower as lockedDefensePower } from '../src/sim/structures/effects'
import { ownershipFor } from '../src/sim/player/ownership'
import type { OwnershipRecord } from '../src/sim/player/ownership'
import type { PlayerState } from '../src/sim/player/types'
import { bodyId, systemId } from '../src/sim/world/identity'
import type { BodyId } from '../src/sim/world/identity'

const AT = 1_700_000_000_000

// The DESIGN worked example: 5,000 troops × tier 2 = 10,000 AP vs 3 turrets +
// 10k population = 1,500 + 1,500 = 3,000 DP → VICTORY. distance 10 pc at
// 10/43200 pc/s gives a 43,200 s (12h) leg and a 1,300 cr launch (fleet 5,000).
// The target is a canonical body id (the capture-fixture convention).
const SLUG = 'sim-harness-fixture'
const ALPHA = systemId(SLUG, 'alpha')
const TARGET: BodyId = bodyId(ALPHA, 'planet', 0)

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
    ...over,
  }
}

function target(
  over: Partial<BattleScenario['target']> = {},
): BattleScenario['target'] {
  return {
    bodyId: TARGET,
    name: 'Kepler',
    tier: 2,
    ownerId: 'defender-1',
    ...over,
  }
}

// The REAL target owner: a normal colony scenario — the owner's home planet is
// a DIFFERENT world (name never equal to the target body id), so the T08
// home-immunity guard answers attackable.
function targetPlayer(
  over: Partial<PlayerState> = {},
): PlayerState {
  return {
    playerId: 'defender-1',
    homePlanet: {
      name: 'defender-1 home',
      entry: {
        name: 'defender-1 home',
        hostname: 'defender-1 home Host',
        systemCount: 1,
        tier: 1,
      },
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
    wallet: { credits: 0, alloys: 0 },
    structureLevels: {},
    lastTickAt: AT,
    ...over,
  }
}

// The defender's STORED ownership record of the target (a normal conquerable
// colony — colonisation, isHome/unconquerable false).
function targetOwnership(
  over: Partial<OwnershipRecord> = {},
): OwnershipRecord {
  const record = ownershipFor(
    TARGET,
    'defender-1',
    null,
    AT,
    'colonisation',
    false,
    false,
  )
  return { ...record, ...over }
}

// The REAL current settlement state of the target at conquest time.
function targetCurrent(
  over: Partial<CaptureSettlement> = {},
): CaptureSettlement {
  return {
    population: 10_000,
    garrison: 2_000,
    structures: {
      oreMine: 0,
      tradeHub: 0,
      housing: 0,
      hydroponics: 0,
      barracks: 0,
      shipyard: 0,
      defenseTurret: 3,
    },
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
    target: target(),
    targetPlayer: targetPlayer(),
    targetOwnership: targetOwnership(),
    targetCurrent: targetCurrent(),
    targetHistory: [],
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
      targetId: TARGET,
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
    expect(run.outcome.targetId).toBe(TARGET)
    expect(run.ledger.attackerId).toBe('attacker:scenario-1')
    expect(run.ledger.targetId).toBe(TARGET)
  })

  it('is deterministic: identical input yields deep-equal results', () => {
    expect(runScenario(scenario())).toEqual(runScenario(scenario()))
  })

  it('never mutates its input scenario', () => {
    const input = scenario()
    const snapshot = JSON.parse(JSON.stringify(input)) as BattleScenario
    runScenario(input)
    expect(input).toEqual(snapshot)
  })
})

describe('runScenario — the real capture chain (T07) and the combat report (T09)', () => {
  it('the full chain captures the planet via the REAL T07 transfer (not a derived flag)', () => {
    const run = runScenario(scenario())
    expect(run.captured).toBe(true)
    expect(run.report.result).toBe('victory')
    expect(run.report.attackerId).toBe('attacker:scenario-1')
    expect(run.report.defenderId).toBe('defender-1')
    expect(run.report.targetId).toBe(TARGET)
    expect(run.report.sections.winner).toBe('attacker:scenario-1')
    expect(run.report.sections.loser).toBe('defender-1')
  })

  it('a defeat and a stalemate never reach the capture (captured stays false)', () => {
    expect(runScenario(defeatScenario()).captured).toBe(false)
    expect(runScenario(stalemateScenario()).captured).toBe(false)
    expect(runScenario(stalemateScenario()).report.result).toBe('stalemate')
    expect(runScenario(stalemateScenario()).report.sections.winner).toBe('')
  })

  it('rejects a non-canonical target body id up front (even before the chain runs)', () => {
    expect(() =>
      runScenario(scenario({ target: { ...scenario().target, bodyId: 'target:scenario-1' } })),
    ).toThrow(RangeError)
    expect(() =>
      runScenario(scenario({ target: { ...scenario().target, bodyId: 'not-a-body' } })),
    ).toThrow(/valid body id/)
  })

  it('the launch and resolution both run the T08 home-immunity guard against the real owner', () => {
    const run = runScenario(scenario())
    expect(run.outcome.targetId).toBe(TARGET)
    expect(run.outcome.result).toBe('victory')
  })

  it('a protected-home target (targetPlayer whose home IS the target) is refused by the T08 guard', () => {
    const protectedHome: PlayerState = {
      ...targetPlayer(),
      homePlanet: {
        ...targetPlayer().homePlanet,
        name: TARGET,
        entry: {
          name: TARGET,
          hostname: `${TARGET} Host`,
          systemCount: 1,
          tier: 1,
        },
      },
    }
    expect(() => runScenario(scenario({ targetPlayer: protectedHome }))).toThrow(
      /home world/,
    )
  })

  it('a victory whose targetOwnership is protected replays the locked refusal unchanged', () => {
    const protectedRecord = ownershipFor(
      TARGET,
      'defender-1',
      null,
      AT,
      'home-assignment',
      true,
      true,
    )
    expect(() =>
      runScenario(
        scenario({ targetOwnership: { ...protectedRecord } }),
      ),
    ).toThrow(/cannot be captured/)
  })
})

describe('runScenario — the deterministic summary', () => {
  it('renders the DESIGN worked-example one-liner', () => {
    const run = runScenario(scenario())
    expect(run.summary).toBe(
      'VICTORY · 1,300 cr launch · 12h travel · 1,500 troops lost',
    )
  })

  it('renders a defeat summary with all committed troops lost', () => {
    const run = runScenario(defeatScenario())
    expect(run.summary).toBe('DEFEAT · 500 cr launch · 12h travel · 1,000 troops lost')
  })

  it('renders a stalemate summary with the withdrawn force', () => {
    const run = runScenario(stalemateScenario())
    expect(run.summary).toBe(
      'STALEMATE · 1,300 cr launch · 12h travel · 2,500 troops lost',
    )
  })

  it('renders the travel duration as seconds, minutes and hours deterministically', () => {
    expect(runScenario(scenario({ distancePc: 45, speedPcPerSec: 1 })).summary).toContain(
      '45s travel',
    )
    expect(runScenario(scenario({ distancePc: 90, speedPcPerSec: 1 })).summary).toContain(
      '2m travel',
    )
    expect(runScenario(scenario({ distancePc: 10, speedPcPerSec: 10 / 43_200 })).summary).toContain(
      '12h travel',
    )
  })

  it('keeps the summary part of the deterministic result (same input → same summary)', () => {
    expect(runScenario(scenario()).summary).toBe(runScenario(scenario()).summary)
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

  it('each row carries the scenarioId and its one-line summary', () => {
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

  it('names a tampered summary as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = { ...recorded, summary: `${recorded.summary} X` }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('summary')
  })

  it('names a tampered combat-report winner as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      report: {
        ...recorded.report,
        sections: { ...recorded.report.sections, winner: 'intruder' },
      },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe(
      'report.sections.winner',
    )
  })

  it('names a tampered combat-report defenderId as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      report: { ...recorded.report, defenderId: 'intruder' },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('report.defenderId')
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

  it('names a tampered outcome.battleId as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      outcome: { ...recorded.outcome, battleId: `${recorded.outcome.battleId}x` },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('outcome.battleId')
  })

  it('names a tampered outcome.victory as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      outcome: { ...recorded.outcome, victory: !recorded.outcome.victory },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('outcome.victory')
  })

  it('names a tampered ledger.result as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      ledger: { ...recorded.ledger, result: 'stalemate' },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('ledger.result')
  })

  it('names a tampered cost.tier as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      cost: { ...recorded.cost!, tier: recorded.cost!.tier + 1 },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe('cost.tier')
  })

  it('names a tampered cost.escalation.reason as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      cost: {
        ...recorded.cost!,
        escalation: {
          ...recorded.cost!.escalation,
          reason: `${recorded.cost!.escalation.reason}x`,
        },
      },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe(
      'cost.escalation.reason',
    )
  })

  it('names a tampered cost.total.population as the first difference', () => {
    const recorded = runScenario(scenario())
    const rerun: ScenarioResult = {
      ...recorded,
      cost: {
        ...recorded.cost!,
        total: {
          ...recorded.cost!.total,
          population: recorded.cost!.total.population + 1,
        },
      },
    }
    expect(replayCheck(recorded, rerun).firstDifference).toBe(
      'cost.total.population',
    )
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

  it('rejects a bad target tier even on a scenario that ends in defeat', () => {
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
          target: { ...scenario().target, tier: 0 },
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

  it('rejects a targetOwnership whose bodyId or ownerId does not bind to the target (the capture binding check)', () => {
    expect(() =>
      runScenario(
        scenario({ targetOwnership: { ...targetOwnership(), bodyId: bodyId(ALPHA, 'planet', 1) } }),
      ),
    ).toThrow(/targetOwnership\.bodyId must be the capture target/)
    expect(() =>
      runScenario(
        scenario({ targetOwnership: { ...targetOwnership(), ownerId: 'someone-else' } }),
      ),
    ).toThrow(/targetOwnership\.ownerId must be the defender/)
  })

  it('rejects a malformed targetPlayer shape and a malformed targetCurrent envelope', () => {
    expect(() =>
      runScenario(
        scenario({ targetPlayer: { ...targetPlayer(), playerId: '' } }),
      ),
    ).toThrow(RangeError)
    expect(() =>
      runScenario(
        scenario({
          targetPlayer: {
            ...targetPlayer(),
            homePlanet: { ...targetPlayer().homePlanet, name: '' },
          },
        }),
      ),
    ).toThrow(/homePlanet must carry a non-empty name/)
    expect(() =>
      runScenario(
        scenario({ targetCurrent: { ...targetCurrent(), population: -1 } }),
      ),
    ).toThrow(RangeError)
    expect(() =>
      runScenario(
        scenario({ targetCurrent: { ...targetCurrent(), garrison: Number.NaN } }),
      ),
    ).toThrow(RangeError)
    expect(() =>
      runScenario(
        scenario({
          targetCurrent: {
            ...targetCurrent(),
            structures: { ...targetCurrent().structures, shipyard: -1 },
          },
        }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects a non-array targetHistory (the audit trail must be an array)', () => {
    expect(() =>
      runScenario(scenario({ targetHistory: 'not-an-array' as never })),
    ).toThrow(RangeError)
  })
})
