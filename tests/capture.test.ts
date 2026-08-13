import { describe, expect, it } from 'vitest'
import {
  BATTLE_DURATION_HOURS,
  captureInvariants,
  capturePlanet,
  captureSummary,
  survivalFor,
} from '../src/sim/combat/capture'
import type {
  CaptureInput,
  CaptureResult,
  CaptureSettlement,
} from '../src/sim/combat/capture'
import { applyCasualties } from '../src/sim/combat/casualties'
import type { CasualtyLedger } from '../src/sim/combat/casualties'
import { conquestCostFor } from '../src/sim/combat/conquest-cost'
import type { ConquestCost } from '../src/sim/combat/conquest-cost'
import type { BattleOutcome } from '../src/sim/combat/resolution'
import { conquestTransfer, structureSurvivors } from '../src/sim/player/transfer'
import type { ConquestTransferResult, TransferOutcome } from '../src/sim/player/transfer'
import { ownershipFor } from '../src/sim/player/ownership'
import type { OwnershipEvent } from '../src/sim/player/ownership'
import type { StructureGrid } from '../src/sim/player/types'
import { buildBodyRecord } from '../src/sim/world/body'
import type { BodyRecord } from '../src/sim/world/body'
import { buildGalaxyRecord, registerSystem } from '../src/sim/world/galaxy'
import { bodyId, systemId } from '../src/sim/world/identity'
import type { BodyId } from '../src/sim/world/identity'
import type { UniverseState } from '../src/sim/world/reconstruct'
import { buildSystemRecord, registerBody } from '../src/sim/world/system'
import { fnv1a } from '../src/sim/planets/hash'
import { STRUCTURE_IDS } from '../src/sim/structures/data'

const SLUG = 'capture-fixture'
const AT = 1_700_000_000_000
const ATTACKER = 'attacker-1'
const DEFENDER = 'defender-1'
const TIER = 4
const SURVIVAL = 0.5

const ALPHA = systemId(SLUG, 'alpha')
const TARGET: BodyId = bodyId(ALPHA, 'planet', 0)

const SETTLEMENT_VERSION = 'capture-settlement-v1'
const STRUCTURE_LEVEL_BOUND = 6
const POPULATION_BASE = 1000
const POPULATION_VARIANCE = 9000
const GARRISON_BOUND = 5000

/**
 * The deterministic TARGET-STATE FIXTURE (test-side only): population, garrison
 * and a full structure grid derived from a body id via fnv1a — the old
 * module-level `settlementFor` draft, now a pure test fixture because the
 * capture module itself takes the real target state as an input. The fixture
 * guarantees housing >= 1 and defenseTurret >= 1 so the P2 turret-destruction
 * contract stays observable in the tests. A fresh object per call; nothing is
 * shared.
 */
function fixtureSettlement(bodyId: string): CaptureSettlement {
  const structures = {} as StructureGrid
  for (const structureId of STRUCTURE_IDS) {
    structures[structureId] =
      fnv1a(`${SETTLEMENT_VERSION}|${bodyId}|${structureId}`) % STRUCTURE_LEVEL_BOUND
  }
  structures.housing += 1
  structures.defenseTurret += 1
  const population =
    POPULATION_BASE +
    (fnv1a(`${SETTLEMENT_VERSION}|${bodyId}|population`) % POPULATION_VARIANCE)
  const garrison =
    fnv1a(`${SETTLEMENT_VERSION}|${bodyId}|garrison`) % GARRISON_BOUND
  return { population, garrison, structures }
}

/** The REAL ownership trail of the target before the battle: one colonisation. */
function historyFor(): OwnershipEvent[] {
  return [
    {
      bodyId: TARGET,
      fromOwnerId: null,
      toOwnerId: DEFENDER,
      at: AT - 86_400_000,
      method: 'colonisation',
    },
  ]
}

/** Minimal world: one galaxy, one system, one planet (the target body). */
function buildFixture(): UniverseState {
  let galaxy = buildGalaxyRecord({ slug: SLUG, seed: SLUG, name: 'Capture Home' })
  galaxy = registerSystem(galaxy, ALPHA)
  const alpha = registerBody(
    buildSystemRecord({ galaxy: galaxy.id, slug: 'alpha', name: 'Alpha' }),
    TARGET,
  )
  const bodies: BodyRecord[] = [
    buildBodyRecord({ system: ALPHA, type: 'planet', ordinal: 0 }),
  ]
  return { galaxy, systems: [alpha], bodies }
}

function outcome(overrides: Partial<BattleOutcome> = {}): BattleOutcome {
  return {
    battleId: 'battle-capture-1',
    attackerId: ATTACKER,
    targetId: TARGET,
    resolvedAt: AT,
    attackPower: 15_000,
    defensePower: 10_000,
    victory: true,
    survivingTroops: 3_500,
    defenderCasualties: 4_000,
    result: 'victory',
    ...overrides,
  }
}

function costFor(): ConquestCost {
  return conquestCostFor({ targetId: TARGET, tier: TIER, attackerConquests: 3 })
}

function ledgerFor(battle: BattleOutcome = outcome()): CasualtyLedger {
  return applyCasualties({
    outcome: battle,
    committedTroops: 5_000,
    defenderPopulationBefore: 40_000,
    defenderGarrisonBefore: 2_000,
  })
}

function input(overrides: Partial<CaptureInput> = {}): CaptureInput {
  return {
    attackerId: ATTACKER,
    defenderId: DEFENDER,
    targetId: TARGET,
    outcome: outcome(),
    cost: costFor(),
    casualties: ledgerFor(),
    structureSurvival: SURVIVAL,
    capturedAt: AT,
    universe: buildFixture(),
    targetOwnership: ownershipFor(
      TARGET,
      DEFENDER,
      null,
      AT,
      'colonisation',
      false,
      false,
    ),
    targetCurrent: fixtureSettlement(TARGET),
    previousHistory: historyFor(),
    ...overrides,
  }
}

function asTransferOutcome(result: ConquestTransferResult): TransferOutcome {
  if ('ok' in result) {
    throw new Error(`unexpected conquest transfer rejection: ${result.reason}`)
  }
  return result
}

describe('P7-T07 capturePlanet — victory hands the world over', () => {
  it('a victory produces outcome captured and hands the world to the attacker', () => {
    const result = capturePlanet(input())
    expect(result.outcome).toBe('captured')
    expect(result.transfer).not.toBeNull()
    expect(result.transfer!.toOwnerId).toBe(ATTACKER)
    expect(result.transfer!.fromOwnerId).toBe(DEFENDER)
    expect(result.transfer!.method).toBe('conquest')
    expect(result.transfer!.bodyId).toBe(TARGET)
    expect(result.transfer!.at).toBe(AT)
    expect(result.survivingStructures).not.toBeNull()
  })

  it('DELEGATES the handover to the locked conquestTransfer (event + survivors deep-equal to a direct call)', () => {
    const base = input()
    const result = capturePlanet(base)
    const settlement = base.targetCurrent
    const expected = conquestTransfer({
      record: base.targetOwnership,
      toOwnerId: ATTACKER,
      at: AT,
      survival: {
        populationSurvival: survivalFor(settlement, base.casualties).populationSurvival,
        structureSurvival: SURVIVAL,
        garrisonSurvival: survivalFor(settlement, base.casualties).garrisonSurvival,
      },
      structures: settlement.structures,
      previousHistory: base.previousHistory,
      current: { population: settlement.population, garrison: settlement.garrison },
    })
    expect(result.transfer).toEqual(asTransferOutcome(expected).event)
    expect(result.survivingStructures).toEqual(asTransferOutcome(expected).structures)
  })

  it('applies the T05-derived population/garrison survival onto the transfer from the REAL target state', () => {
    const base = input()
    const result = capturePlanet(base)
    const settlement = base.targetCurrent
    const survival = survivalFor(settlement, base.casualties)
    const envelope = conquestTransfer({
      record: base.targetOwnership,
      toOwnerId: ATTACKER,
      at: AT,
      survival: {
        populationSurvival: survival.populationSurvival,
        structureSurvival: SURVIVAL,
        garrisonSurvival: survival.garrisonSurvival,
      },
      structures: settlement.structures,
      previousHistory: base.previousHistory,
      current: { population: settlement.population, garrison: settlement.garrison },
    })
    const outcome = asTransferOutcome(envelope)
    expect(result.transfer).toEqual(outcome.event)
    expect(outcome.survivors.population).toBe(
      Math.round(settlement.population * survival.populationSurvival),
    )
    expect(outcome.survivors.garrison).toBe(
      Math.round(settlement.garrison * survival.garrisonSurvival),
    )
  })

  it('derives the transfer survivors from the ACTUAL battle population, never a fabricated state', () => {
    const base = input({
      targetCurrent: {
        population: 40_000,
        garrison: 2_000,
        structures: fixtureSettlement(TARGET).structures,
      },
    })
    const result = capturePlanet(base)
    const survival = survivalFor(base.targetCurrent, base.casualties)
    expect(survival.populationSurvival).toBe(0.9)
    expect(survival.garrisonSurvival).toBe(0)
    const envelope = asTransferOutcome(
      conquestTransfer({
        record: base.targetOwnership,
        toOwnerId: ATTACKER,
        at: AT,
        survival: {
          populationSurvival: survival.populationSurvival,
          structureSurvival: SURVIVAL,
          garrisonSurvival: survival.garrisonSurvival,
        },
        structures: base.targetCurrent.structures,
        previousHistory: base.previousHistory,
        current: { population: 40_000, garrison: 2_000 },
      }),
    )
    expect(result.outcome).toBe('captured')
    expect(result.transfer).toEqual(envelope.event)
    expect(envelope.survivors.population).toBe(36_000)
    expect(envelope.survivors.garrison).toBe(0)
  })

  it('delegates the REAL ownership history to the locked transfer (a real trail, never an empty fabrication)', () => {
    const result = capturePlanet(input())
    expect(result.outcome).toBe('captured')
    expect(captureInvariants(result).ok).toBe(true)
  })

  it('records the cost and the casualty ledger and satisfies its invariants', () => {
    const result = capturePlanet(input())
    expect(result.cost).toEqual(costFor())
    expect(result.casualties).toEqual(ledgerFor())
    expect(captureInvariants(result).ok).toBe(true)
  })
})

describe('P7-T07 capturePlanet — structure consequences (via the locked transfer)', () => {
  it('the defense turret is ALWAYS destroyed (DESIGN §5 — absent in the survivors)', () => {
    expect(capturePlanet(input()).survivingStructures!.defenseTurret).toBeUndefined()
  })

  it('every other structure survives by the survival fraction (floored by the delegate)', () => {
    const structures = input().targetCurrent.structures
    expect(capturePlanet(input()).survivingStructures).toEqual(
      structureSurvivors(structures, SURVIVAL),
    )
    const full = capturePlanet(input({ structureSurvival: 1 }))
    expect(full.survivingStructures).toEqual(structureSurvivors(structures, 1))
    const none = capturePlanet(input({ structureSurvival: 0 }))
    expect(none.survivingStructures).toEqual(structureSurvivors(structures, 0))
    expect(Object.values(none.survivingStructures!).every((level) => level === 0)).toBe(true)
  })

  it('the target-state fixture guarantees a turret and housing so the contract is observable', () => {
    const settlement = fixtureSettlement(TARGET)
    expect(settlement.structures.defenseTurret).toBeGreaterThanOrEqual(1)
    expect(settlement.structures.housing).toBeGreaterThanOrEqual(1)
  })
})

describe('P7-T07 capturePlanet — repelled paths (defeat / stalemate)', () => {
  it('a defeat and a stalemate both repel the attackers with no transfer', () => {
    const defeated = outcome({ result: 'defeat', victory: false, survivingTroops: 0 })
    const stalemate = outcome({ result: 'stalemate', victory: false, survivingTroops: 2_500 })
    const repelled = capturePlanet(
      input({ outcome: defeated, casualties: ledgerFor(defeated) }),
    )
    expect(repelled.outcome).toBe('repelled')
    expect(repelled.transfer).toBeNull()
    expect(repelled.survivingStructures).toBeNull()
    const held = capturePlanet(
      input({ outcome: stalemate, casualties: ledgerFor(stalemate) }),
    )
    expect(held.outcome).toBe('repelled')
    expect(held.transfer).toBeNull()
    expect(held.survivingStructures).toBeNull()
  })

  it('a repelled capture still records the cost and the casualty ledger (the price was paid)', () => {
    const defeated = outcome({ result: 'defeat', victory: false, survivingTroops: 0 })
    const result = capturePlanet(
      input({ outcome: defeated, casualties: ledgerFor(defeated) }),
    )
    expect(result.cost).toEqual(costFor())
    expect(result.casualties).toEqual(ledgerFor(defeated))
  })

  it('a repelled result satisfies its invariants', () => {
    const defeated = outcome({ result: 'defeat', victory: false, survivingTroops: 0 })
    const result = capturePlanet(
      input({ outcome: defeated, casualties: ledgerFor(defeated) }),
    )
    expect(captureInvariants(result).ok).toBe(true)
  })

  it('a victory onto an impossible handover (self-transfer) throws Error', () => {
    const selfBattle = outcome({ attackerId: DEFENDER })
    const selfCapture = input({
      attackerId: DEFENDER,
      outcome: selfBattle,
      casualties: ledgerFor(selfBattle),
    })
    expect(() => capturePlanet(selfCapture)).toThrow(Error)
    expect(() => capturePlanet(selfCapture)).not.toThrow(RangeError)
  })

  it('a victory onto a protected home world is refused (the T08 guard reaches the locked refusal path)', () => {
    const protectedHome = ownershipFor(
      TARGET,
      DEFENDER,
      null,
      AT,
      'home-assignment',
      true,
      true,
    )
    expect(() => capturePlanet(input({ targetOwnership: protectedHome }))).toThrow(Error)
    expect(() => capturePlanet(input({ targetOwnership: protectedHome }))).not.toThrow(
      RangeError,
    )
  })
})

describe('P7-T07 captureId — determinism and identity', () => {
  it('is deterministic and equals fnv1a(attackerId|targetId|capturedAt) in hex', () => {
    expect(capturePlanet(input()).captureId).toBe(capturePlanet(input()).captureId)
    expect(capturePlanet(input()).captureId).toBe(
      fnv1a(`${ATTACKER}|${TARGET}|${AT}`).toString(16),
    )
  })

  it('changes when the capture time or the attacker changes', () => {
    const base = capturePlanet(input()).captureId
    expect(capturePlanet(input({ capturedAt: AT + 1 })).captureId).not.toBe(base)
    const otherBattle = outcome({ attackerId: 'attacker-2' })
    expect(
      capturePlanet(
        input({
          attackerId: 'attacker-2',
          outcome: otherBattle,
          casualties: ledgerFor(otherBattle),
        }),
      ).captureId,
    ).not.toBe(base)
  })
})

describe('P7-T07 capturePlanet — determinism and immutability', () => {
  it('identical inputs produce deep-equal results with a fresh transfer', () => {
    const first = capturePlanet(input())
    const second = capturePlanet(input())
    expect(first).toEqual(second)
    expect(first.transfer).toEqual(second.transfer)
    expect(first.transfer).not.toBe(second.transfer)
  })

  it('never mutates the outcome, cost, casualties, universe, target ownership, target state or history inputs', () => {
    const battle = outcome()
    const cost = costFor()
    const casualties = ledgerFor()
    const universe = buildFixture()
    const targetOwnership = ownershipFor(
      TARGET,
      DEFENDER,
      null,
      AT,
      'colonisation',
      false,
      false,
    )
    const targetCurrent = fixtureSettlement(TARGET)
    const previousHistory = historyFor()
    capturePlanet(
      input({
        outcome: battle,
        cost,
        casualties,
        universe,
        targetOwnership,
        targetCurrent,
        previousHistory,
      }),
    )
    expect(battle).toEqual(outcome())
    expect(cost).toEqual(costFor())
    expect(casualties).toEqual(ledgerFor())
    expect(universe).toEqual(buildFixture())
    expect(targetOwnership).toEqual(
      ownershipFor(TARGET, DEFENDER, null, AT, 'colonisation', false, false),
    )
    expect(targetCurrent).toEqual(fixtureSettlement(TARGET))
    expect(previousHistory).toEqual(historyFor())
  })
})

describe('P7-T07 capturePlanet — validation', () => {
  it('rejects an empty attackerId / defenderId / targetId', () => {
    expect(() => capturePlanet(input({ attackerId: '  ' }))).toThrow(RangeError)
    expect(() => capturePlanet(input({ defenderId: '' }))).toThrow(RangeError)
    expect(() => capturePlanet(input({ targetId: '' }))).toThrow(RangeError)
  })

  it('rejects a non-positive capturedAt (0, negative, NaN, Infinity)', () => {
    for (const badAt of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => capturePlanet(input({ capturedAt: badAt })), `at ${badAt}`).toThrow(
        RangeError,
      )
    }
  })

  it('ALLOWS a capture stamped exactly at the battle resolution (equality boundary)', () => {
    const atResolution = input({ capturedAt: AT })
    expect(atResolution.capturedAt).toBe(atResolution.outcome.resolvedAt)
    expect(() => capturePlanet(atResolution)).not.toThrow()
  })

  it('REJECTS a capture stamped BEFORE the battle resolution (resolvedAt - 1)', () => {
    const before = input({ capturedAt: AT - 1 })
    expect(before.capturedAt).toBeLessThan(before.outcome.resolvedAt)
    expect(() => capturePlanet(before)).toThrow(RangeError)
    expect(() => capturePlanet(before)).toThrow(/must not precede the battle resolution/)
  })

  it('ALLOWS a capture stamped AFTER the battle resolution', () => {
    const after = input({ capturedAt: AT + 1 })
    expect(after.capturedAt).toBeGreaterThan(after.outcome.resolvedAt)
    expect(() => capturePlanet(after)).not.toThrow()
  })

  it('rejects a structureSurvival outside [0,1] or non-finite', () => {
    for (const bad of [1.5, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => capturePlanet(input({ structureSurvival: bad })),
        `fraction ${bad}`,
      ).toThrow(RangeError)
    }
  })

  it('rejects a non-terminal or internally contradictory outcome', () => {
    const nonTerminal = { ...outcome(), result: 'pending' } as unknown as BattleOutcome
    expect(() => capturePlanet(input({ outcome: nonTerminal }))).toThrow(RangeError)
    expect(() =>
      capturePlanet(input({ outcome: { ...outcome(), result: 'defeat', victory: true } })),
    ).toThrow(RangeError)
    expect(() =>
      capturePlanet(input({ outcome: { ...outcome(), result: 'victory', victory: false } })),
    ).toThrow(RangeError)
  })

  it('rejects a malformed casualty ledger (delegated to the locked invariants)', () => {
    const bad = { ...ledgerFor(), attacker: { ...ledgerFor().attacker, survivors: 9_999 } }
    expect(() => capturePlanet(input({ casualties: bad }))).toThrow(RangeError)
  })

  it('rejects a malformed cost (bad tier / negative total)', () => {
    expect(() => capturePlanet(input({ cost: { ...costFor(), tier: 0 } }))).toThrow(RangeError)
    expect(() =>
      capturePlanet(
        input({ cost: { ...costFor(), total: { ...costFor().total, population: -5 } } }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects a target not present in the universe or not a valid body id', () => {
    const elsewhere = bodyId(systemId(SLUG, 'beta'), 'planet', 0)
    const elsewhereBattle = outcome({ targetId: elsewhere })
    expect(() =>
      capturePlanet(
        input({
          targetId: elsewhere,
          outcome: elsewhereBattle,
          casualties: ledgerFor(elsewhereBattle),
          cost: conquestCostFor({ targetId: elsewhere, tier: TIER, attackerConquests: 3 }),
        }),
      ),
    ).toThrow(/not present/)
    const invalidBattle = outcome({ targetId: 'not-a-body' })
    expect(() =>
      capturePlanet(
        input({
          targetId: 'not-a-body',
          outcome: invalidBattle,
          casualties: ledgerFor(invalidBattle),
          cost: { ...costFor(), targetId: 'not-a-body' },
        }),
      ),
    ).toThrow(/valid body id/)
  })

  it('rejects a targetOwnership naming a different body than the capture target', () => {
    const other = bodyId(systemId(SLUG, 'beta'), 'planet', 0)
    expect(() =>
      capturePlanet(
        input({
          targetOwnership: ownershipFor(
            other,
            DEFENDER,
            null,
            AT,
            'colonisation',
            false,
            false,
          ),
        }),
      ),
    ).toThrow(/targetOwnership\.bodyId/)
  })

  it('rejects a targetOwnership owned by anyone other than the defender', () => {
    expect(() =>
      capturePlanet(
        input({
          targetOwnership: ownershipFor(
            TARGET,
            'intruder',
            null,
            AT,
            'colonisation',
            false,
            false,
          ),
        }),
      ),
    ).toThrow(/targetOwnership\.ownerId/)
  })

  it('REJECTS an outcome and ledger that describe DIFFERENT battles (cross-source binding)', () => {
    const victory = outcome()
    expect(() =>
      capturePlanet(input({ outcome: victory, casualties: { ...ledgerFor(), battleId: 'battle-other' } })),
    ).toThrow(/describe the same battle/)
    expect(() =>
      capturePlanet(input({ outcome: { ...victory, battleId: 'battle-other' }, casualties: ledgerFor() })),
    ).toThrow(/describe the same battle/)
    expect(() =>
      capturePlanet(input({ outcome: { ...victory, targetId: bodyId(systemId(SLUG, 'beta'), 'planet', 0) }, casualties: ledgerFor() })),
    ).toThrow(/describe the same battle/)
  })

  it('REJECTS a result mismatch between the outcome and the ledger', () => {
    const defeated = outcome({ result: 'defeat', victory: false, survivingTroops: 0 })
    expect(() =>
      capturePlanet(input({ outcome: outcome(), casualties: ledgerFor(defeated) })),
    ).toThrow(/describe the same battle/)
    expect(() =>
      capturePlanet(input({ outcome: outcome(), casualties: { ...ledgerFor(), result: 'defeat' } })),
    ).toThrow(/describe the same battle/)
  })

  it('REJECTS an attacker-survivor mismatch between the outcome and the ledger', () => {
    expect(() =>
      capturePlanet(
        input({ outcome: outcome({ survivingTroops: 3_600 }), casualties: ledgerFor() }),
      ),
    ).toThrow(/describe the same battle/)
    expect(() =>
      capturePlanet(
        input({
          outcome: outcome(),
          casualties: ledgerFor(outcome({ survivingTroops: 3_600 })),
        }),
      ),
    ).toThrow(/describe the same battle/)
  })

  it('REJECTS an outcome naming a DIFFERENT attacker than the capture attackerId', () => {
    expect(() => capturePlanet(input({ attackerId: 'attacker-2' }))).toThrow(
      /outcome\.attackerId/,
    )
    expect(() => capturePlanet(input({ attackerId: 'attacker-2' }))).toThrow(RangeError)
  })

  it('REJECTS an outcome naming a DIFFERENT target than the capture targetId', () => {
    const other = bodyId(systemId(SLUG, 'beta'), 'planet', 0)
    expect(() => capturePlanet(input({ targetId: other }))).toThrow(/outcome\.targetId/)
    expect(() => capturePlanet(input({ targetId: other }))).toThrow(RangeError)
  })

  it('REJECTS a cost paid for a DIFFERENT target than the capture targetId', () => {
    const other = bodyId(systemId(SLUG, 'beta'), 'planet', 0)
    expect(() =>
      capturePlanet(input({ cost: { ...costFor(), targetId: other } })),
    ).toThrow(/cost\.targetId/)
    expect(() =>
      capturePlanet(input({ cost: { ...costFor(), targetId: other } })),
    ).toThrow(RangeError)
  })

  it('rejects a malformed targetCurrent (negative / non-finite counts, bad structure level)', () => {
    expect(() =>
      capturePlanet(input({ targetCurrent: { ...fixtureSettlement(TARGET), population: -1 } })),
    ).toThrow(/targetCurrent\.population/)
    expect(() =>
      capturePlanet(input({ targetCurrent: { ...fixtureSettlement(TARGET), garrison: Number.NaN } })),
    ).toThrow(/targetCurrent\.garrison/)
    expect(() =>
      capturePlanet(
        input({
          targetCurrent: {
            ...fixtureSettlement(TARGET),
            structures: { ...fixtureSettlement(TARGET).structures, housing: -2 },
          },
        }),
      ),
    ).toThrow(/targetCurrent\.structures/)
  })

  it('rejects a non-array previousHistory', () => {
    expect(() =>
      capturePlanet(input({ previousHistory: 'not-history' as unknown as OwnershipEvent[] })),
    ).toThrow(/previousHistory/)
  })
})

describe('P7-T07 captureInvariants — malformed results are reported', () => {
  it('flags a captured result with a null transfer and a repelled one that carries one', () => {
    const captured: CaptureResult = { ...capturePlanet(input()), transfer: null }
    expect(captureInvariants(captured).ok).toBe(false)
    expect(captureInvariants(captured).problems.some((p) => /transfer non-null/.test(p))).toBe(
      true,
    )
    const defeated = outcome({ result: 'defeat', victory: false, survivingTroops: 0 })
    const repelled: CaptureResult = {
      ...capturePlanet(input({ outcome: defeated, casualties: ledgerFor(defeated) })),
      transfer: capturePlanet(input()).transfer,
    }
    expect(captureInvariants(repelled).ok).toBe(false)
    expect(captureInvariants(repelled).problems.some((p) => /transfer null/.test(p))).toBe(
      true,
    )
  })

  it('flags a corrupted captured transfer (wrong owner or kept turret)', () => {
    const good = capturePlanet(input())
    const wrongOwner: CaptureResult = {
      ...good,
      transfer: { ...good.transfer!, toOwnerId: 'intruder' },
    }
    expect(captureInvariants(wrongOwner).ok).toBe(false)
    const keptTurret: CaptureResult = {
      ...good,
      survivingStructures: { ...good.survivingStructures!, defenseTurret: 3 },
    }
    expect(captureInvariants(keptTurret).ok).toBe(false)
    expect(captureInvariants(keptTurret).problems.some((p) => /turret absent/.test(p))).toBe(
      true,
    )
  })

  it('flags a captured result missing its surviving structures and a repelled one carrying them', () => {
    const good = capturePlanet(input())
    expect(captureInvariants({ ...good, survivingStructures: null }).ok).toBe(false)
    const defeated = outcome({ result: 'defeat', victory: false, survivingTroops: 0 })
    const repelled = capturePlanet(
      input({ outcome: defeated, casualties: ledgerFor(defeated) }),
    )
    expect(captureInvariants({ ...repelled, survivingStructures: good.survivingStructures }).ok).toBe(
      false,
    )
    expect(
      captureInvariants({ ...repelled, survivingStructures: good.survivingStructures })
        .problems.some((p) => /no surviving structures/.test(p)),
    ).toBe(true)
  })

  it('flags missing cost or casualties', () => {
    const good = capturePlanet(input())
    expect(captureInvariants({ ...good, cost: null }).ok).toBe(false)
    expect(captureInvariants({ ...good, casualties: null }).ok).toBe(false)
  })

  it('flags a forged captureId, an outcome outside the union and a non-positive capturedAt', () => {
    const good = capturePlanet(input())
    expect(captureInvariants({ ...good, captureId: 'forged' }).ok).toBe(false)
    expect(
      captureInvariants({ ...good, outcome: 'drawn' as CaptureResult['outcome'] }).ok,
    ).toBe(false)
    expect(captureInvariants({ ...good, capturedAt: -1 }).ok).toBe(false)
  })
})

describe('P7-T07 captureSummary — the deterministic one-liner', () => {
  it('captured: cost totals and surviving-structure count (hand-computed T4 ×1.3)', () => {
    const result = capturePlanet(input())
    const expectedStructures = structureSurvivors(input().targetCurrent.structures, SURVIVAL)
    const survived = Object.values(expectedStructures).filter((level) => level > 0).length
    expect(result.cost!.total).toEqual({ population: 10_400, fleet: 5_200, credits: 260_000 })
    expect(captureSummary(result)).toBe(
      `Captured in ${BATTLE_DURATION_HOURS}h battle: 10,400 population · ` +
        `5,200 fleet · 260K cr · ${survived} structures survived`,
    )
  })

  it('repelled: the attacker population lost from the T05 ledger', () => {
    const defeated = outcome({ result: 'defeat', victory: false, survivingTroops: 2_000 })
    const result = capturePlanet(
      input({ outcome: defeated, casualties: ledgerFor(defeated) }),
    )
    expect(result.casualties!.attacker.populationLoss).toBe(3_000)
    expect(captureSummary(result)).toBe('Repelled: attackers lost 3,000 troops')
  })

  it('is deterministic for the same result', () => {
    const result = capturePlanet(input())
    expect(captureSummary(result)).toBe(captureSummary(result))
  })

  it('throws RangeError on a malformed result', () => {
    const result: CaptureResult = { ...capturePlanet(input()), captureId: 'forged' }
    expect(() => captureSummary(result)).toThrow(RangeError)
  })
})

describe('P7-T07 target-state fixture and survivalFor — pure derivation', () => {
  it('the fixture settlement is deterministic, never shares state and differs across bodies', () => {
    expect(fixtureSettlement(TARGET)).toEqual(fixtureSettlement(TARGET))
    expect(fixtureSettlement(TARGET).structures).not.toBe(fixtureSettlement(TARGET).structures)
    const other = bodyId(systemId(SLUG, 'beta'), 'planet', 0)
    expect(fixtureSettlement(TARGET)).not.toEqual(fixtureSettlement(other))
  })

  it('survivalFor inherits only what the battle did not consume (clamped into [0,1])', () => {
    const settlement = fixtureSettlement(TARGET)
    const ledger = ledgerFor()
    const survival = survivalFor(settlement, ledger)
    expect(survival.populationSurvival).toBe(
      Math.min(1, Math.max(0, 1 - ledger.defender.populationLoss / settlement.population)),
    )
    expect(survival.garrisonSurvival).toBe(
      Math.min(1, Math.max(0, 1 - ledger.defender.garrisonLoss / settlement.garrison)),
    )
    expect(survival.populationSurvival).toBeGreaterThanOrEqual(0)
    expect(survival.populationSurvival).toBeLessThanOrEqual(1)
    expect(survival.garrisonSurvival).toBeGreaterThanOrEqual(0)
    expect(survival.garrisonSurvival).toBeLessThanOrEqual(1)
  })

  it('wipes survivors on a loss that exceeds the current settlement and tolerates a zero garrison', () => {
    const settlement = fixtureSettlement(TARGET)
    const hugeLoss: CasualtyLedger = {
      ...ledgerFor(),
      defender: { ...ledgerFor().defender, populationLoss: settlement.population + 1 },
    }
    expect(survivalFor(settlement, hugeLoss).populationSurvival).toBe(0)
    expect(survivalFor({ ...settlement, garrison: 0 }, ledgerFor()).garrisonSurvival).toBe(1)
  })
})
