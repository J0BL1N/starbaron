import { describe, expect, it } from 'vitest'
import {
  BATTLE_DURATION_HOURS,
  captureInvariants,
  capturePlanet,
  captureSummary,
  settlementFor,
  survivalFor,
} from '../src/sim/combat/capture'
import type { CaptureInput, CaptureResult } from '../src/sim/combat/capture'
import { applyCasualties } from '../src/sim/combat/casualties'
import type { CasualtyLedger } from '../src/sim/combat/casualties'
import { conquestCostFor } from '../src/sim/combat/conquest-cost'
import type { ConquestCost } from '../src/sim/combat/conquest-cost'
import type { BattleOutcome } from '../src/sim/combat/resolution'
import { conquestTransfer, structureSurvivors } from '../src/sim/player/transfer'
import { ownershipFor } from '../src/sim/player/ownership'
import { buildBodyRecord } from '../src/sim/world/body'
import type { BodyRecord } from '../src/sim/world/body'
import { buildGalaxyRecord, registerSystem } from '../src/sim/world/galaxy'
import { bodyId, systemId } from '../src/sim/world/identity'
import type { BodyId } from '../src/sim/world/identity'
import type { UniverseState } from '../src/sim/world/reconstruct'
import { buildSystemRecord, registerBody } from '../src/sim/world/system'
import { fnv1a } from '../src/sim/planets/hash'

const SLUG = 'capture-fixture'
const AT = 1_700_000_000_000
const ATTACKER = 'attacker-1'
const DEFENDER = 'defender-1'
const TIER = 4
const SURVIVAL = 0.5

const ALPHA = systemId(SLUG, 'alpha')
const TARGET: BodyId = bodyId(ALPHA, 'planet', 0)

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
    ...overrides,
  }
}

describe('P7-T07 capturePlanet — victory hands the world over', () => {
  it('a victory produces outcome captured and hands the world to the attacker', () => {
    const result = capturePlanet(input())
    expect(result.outcome).toBe('captured')
    expect(result.transfer).not.toBeNull()
    expect(result.transfer!.record.ownerId).toBe(ATTACKER)
    expect(result.transfer!.record.previousOwnerId).toBe(DEFENDER)
    expect(result.transfer!.event.toOwnerId).toBe(ATTACKER)
    expect(result.transfer!.event.fromOwnerId).toBe(DEFENDER)
    expect(result.transfer!.event.method).toBe('conquest')
    expect(result.transfer!.event.bodyId).toBe(TARGET)
    expect(result.transfer!.event.at).toBe(AT)
  })

  it('DELEGATES the handover to the locked conquestTransfer (deep-equal to a direct call)', () => {
    const result = capturePlanet(input())
    const settlement = settlementFor(TARGET)
    const ledger = ledgerFor()
    const expected = conquestTransfer({
      record: ownershipFor(TARGET, DEFENDER, null, AT, 'colonisation', false, false),
      toOwnerId: ATTACKER,
      at: AT,
      survival: {
        populationSurvival: survivalFor(settlement, ledger).populationSurvival,
        structureSurvival: SURVIVAL,
        garrisonSurvival: survivalFor(settlement, ledger).garrisonSurvival,
      },
      structures: settlement.structures,
      previousHistory: [],
      current: { population: settlement.population, garrison: settlement.garrison },
    })
    expect(result.transfer).toEqual(expected)
  })

  it('applies the T05-derived population/garrison survival onto the transfer', () => {
    const result = capturePlanet(input())
    const settlement = settlementFor(TARGET)
    const ledger = ledgerFor()
    const survival = survivalFor(settlement, ledger)
    expect(result.transfer!.survivors.population).toBe(
      Math.round(settlement.population * survival.populationSurvival),
    )
    expect(result.transfer!.survivors.garrison).toBe(
      Math.round(settlement.garrison * survival.garrisonSurvival),
    )
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
    expect(capturePlanet(input()).transfer!.structures.defenseTurret).toBeUndefined()
  })

  it('every other structure survives by the survival fraction (floored by the delegate)', () => {
    const settlement = settlementFor(TARGET)
    expect(capturePlanet(input()).transfer!.structures).toEqual(
      structureSurvivors(settlement.structures, SURVIVAL),
    )
    const full = capturePlanet(input({ structureSurvival: 1 }))
    expect(full.transfer!.structures).toEqual(structureSurvivors(settlement.structures, 1))
    const none = capturePlanet(input({ structureSurvival: 0 }))
    expect(none.transfer!.structures).toEqual(structureSurvivors(settlement.structures, 0))
    expect(Object.values(none.transfer!.structures).every((level) => level === 0)).toBe(true)
  })

  it('the settlement draft guarantees a turret and housing so the contract is observable', () => {
    const settlement = settlementFor(TARGET)
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
    const held = capturePlanet(
      input({ outcome: stalemate, casualties: ledgerFor(stalemate) }),
    )
    expect(held.outcome).toBe('repelled')
    expect(held.transfer).toBeNull()
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
    expect(() => capturePlanet(input({ attackerId: DEFENDER }))).toThrow(Error)
    expect(() => capturePlanet(input({ attackerId: DEFENDER }))).not.toThrow(RangeError)
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
    expect(capturePlanet(input({ attackerId: 'attacker-2' })).captureId).not.toBe(base)
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

  it('never mutates the outcome, cost, casualties or universe inputs', () => {
    const battle = outcome()
    const cost = costFor()
    const casualties = ledgerFor()
    const universe = buildFixture()
    capturePlanet(input({ outcome: battle, cost, casualties, universe }))
    expect(battle).toEqual(outcome())
    expect(cost).toEqual(costFor())
    expect(casualties).toEqual(ledgerFor())
    expect(universe).toEqual(buildFixture())
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
    expect(() =>
      capturePlanet(
        input({
          targetId: elsewhere,
          cost: conquestCostFor({ targetId: elsewhere, tier: TIER, attackerConquests: 3 }),
        }),
      ),
    ).toThrow(/not present/)
    expect(() => capturePlanet(input({ targetId: 'not-a-body' }))).toThrow(/valid body id/)
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
      transfer: {
        ...good.transfer!,
        record: { ...good.transfer!.record, ownerId: 'intruder' },
      },
    }
    expect(captureInvariants(wrongOwner).ok).toBe(false)
    const keptTurret: CaptureResult = {
      ...good,
      transfer: {
        ...good.transfer!,
        structures: { ...good.transfer!.structures, defenseTurret: 3 },
      },
    }
    expect(captureInvariants(keptTurret).ok).toBe(false)
    expect(captureInvariants(keptTurret).problems.some((p) => /turret absent/.test(p))).toBe(
      true,
    )
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
    const expectedStructures = structureSurvivors(settlementFor(TARGET).structures, SURVIVAL)
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

describe('P7-T07 settlementFor and survivalFor — pure derivation', () => {
  it('settlementFor is deterministic, never shares state and differs across bodies', () => {
    expect(settlementFor(TARGET)).toEqual(settlementFor(TARGET))
    expect(settlementFor(TARGET).structures).not.toBe(settlementFor(TARGET).structures)
    const other = bodyId(systemId(SLUG, 'beta'), 'planet', 0)
    expect(settlementFor(TARGET)).not.toEqual(settlementFor(other))
  })

  it('survivalFor inherits only what the battle did not consume (clamped into [0,1])', () => {
    const settlement = settlementFor(TARGET)
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

  it('wipes survivors on a loss that exceeds the draft settlement and tolerates a zero garrison', () => {
    const settlement = settlementFor(TARGET)
    const hugeLoss: CasualtyLedger = {
      ...ledgerFor(),
      defender: { ...ledgerFor().defender, populationLoss: settlement.population + 1 },
    }
    expect(survivalFor(settlement, hugeLoss).populationSurvival).toBe(0)
    expect(survivalFor({ ...settlement, garrison: 0 }, ledgerFor()).garrisonSurvival).toBe(1)
  })
})
