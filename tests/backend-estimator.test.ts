import { describe, expect, it } from 'vitest'
import {
  PVP_CONSTANTS,
  attackPower,
  combinedAttackPower,
  defensePowerEstimate,
  estimateOutcome,
  estimateRatio,
  estimateScout,
  launchCost,
  travelSeconds,
  warWearinessMultiplier,
} from '../src/sim/player/estimator'
import { effectiveLevel } from '../src/sim/planets/levels'

describe('P3-T02-B estimator — DESIGN §5a outcome boundaries', () => {
  it('ratio 1.5 is the decisive/pyrrhic boundary (>= 1.5 decisive)', () => {
    expect(estimateOutcome(1.5)).toEqual({ outcome: 'decisive', attackerLossPct: 0.4 })
    expect(estimateOutcome(1.499999)).toEqual({
      outcome: 'pyrrhic',
      attackerLossPct: 0.7,
    })
  })

  it('ratio 1.0 is the pyrrhic/repelled boundary (>= 1.0 pyrrhic)', () => {
    expect(estimateOutcome(1.0)).toEqual({ outcome: 'pyrrhic', attackerLossPct: 0.7 })
    expect(estimateOutcome(0.999)).toEqual({
      outcome: 'repelled',
      attackerLossPct: 0.6,
    })
  })

  it('ratio 0.75 is the repelled/crushed boundary (>= 0.75 repelled)', () => {
    expect(estimateOutcome(0.75)).toEqual({ outcome: 'repelled', attackerLossPct: 0.6 })
    expect(estimateOutcome(0.749999)).toEqual({
      outcome: 'crushed',
      attackerLossPct: 0.9,
    })
  })

  it('ratio 0 and the zero-DP edge (9999) map to crushed and decisive', () => {
    expect(estimateOutcome(0)).toEqual({ outcome: 'crushed', attackerLossPct: 0.9 })
    expect(estimateOutcome(9999)).toEqual({ outcome: 'decisive', attackerLossPct: 0.4 })
  })
})

describe('P3-T02-B estimator — AP/DP math (§5a, LOCKED formulas)', () => {
  it('AP = soldiers × effectiveLevel(shipyard tier) — tier ≤ 10 is identity', () => {
    expect(attackPower(1000, 3)).toBe(3000)
    expect(attackPower(500, 2)).toBe(1000)
    expect(attackPower(1, 0)).toBe(0)
  })

  it('AP applies effectiveLevel past tier 10 (D1, mirrors resolver 0010)', () => {
    // effectiveLevel(15) = min(15,10) + max(0,15−10)×0.5 = 12.5 — the
    // exact 04_conquest_math t-effap recipe (120 × 12.5 = 1500, NOT 1800).
    expect(attackPower(120, 15)).toBe(1500)
    expect(attackPower(200, 15)).toBe(2500)
    // tier 21 → 10 + 11×0.5 = 15.5 (mirrors the turret t21 pin).
    expect(attackPower(100, 21)).toBe(1550)
  })

  it('DP = turrets × 500 effectiveLevel + population × 0.15 (garrison excluded, B5)', () => {
    expect(defensePowerEstimate(0, 1000)).toBe(150)
    expect(defensePowerEstimate(10, 1000)).toBe(500 * effectiveLevel(10) + 150)
    expect(defensePowerEstimate(10, 1000)).toBe(5150)
    expect(defensePowerEstimate(11, 1000)).toBe(500 * effectiveLevel(11) + 150)
    expect(defensePowerEstimate(11, 1000)).toBe(5400)
  })

  it('massiveWorld multiplies DP by the 0006 value (1.1)', () => {
    expect(defensePowerEstimate(10, 1000, true)).toBeCloseTo(5150 * 1.1, 12)
    expect(defensePowerEstimate(0, 1000, false)).toBe(150)
  })

  it('ratio = AP / (max(DP,0) × weariness); first conquest weariness 1.0', () => {
    expect(estimateRatio(3000, 150, 1)).toBe(20)
    expect(estimateRatio(4000, 150, 1)).toBeCloseTo(4000 / 150, 12)
    expect(estimateRatio(4000, 150, 1.2)).toBeCloseTo(4000 / 150 / 1.2, 12)
  })

  it('zero-DP edge mirrors resolve_attack: AP>0 -> 9999, AP=0 -> 0', () => {
    expect(estimateRatio(100, 0, 1)).toBe(9999)
    expect(estimateRatio(0, 0, 1)).toBe(0)
    expect(estimateRatio(0, 500, 1)).toBe(0)
  })
})

describe('P3-T02-B estimator — war-weariness (B1 semantics)', () => {
  it('first conquest costs 1.0x, 4th costs 1.2^3 = 1.728x (§5a)', () => {
    expect(warWearinessMultiplier(0)).toBe(1)
    expect(warWearinessMultiplier(1)).toBe(1.2)
    expect(warWearinessMultiplier(2)).toBeCloseTo(1.44, 12)
    expect(warWearinessMultiplier(3)).toBeCloseTo(1.728, 12)
    expect(warWearinessMultiplier(4)).toBeCloseTo(2.0736, 12)
  })

  it('rejects non-integer or negative conquest counts', () => {
    expect(() => warWearinessMultiplier(-1)).toThrow(RangeError)
    expect(() => warWearinessMultiplier(1.5)).toThrow(RangeError)
  })
})

describe('P3-T02-B estimator — 0006 seed parity (balance-drift guard)', () => {
  it('travel knobs match game_config seed exactly', () => {
    expect(PVP_CONSTANTS.travel_minutes_per_pc).toBe(1)
    expect(PVP_CONSTANTS.travel_floor_seconds).toBe(600)
    expect(PVP_CONSTANTS.travel_cap_seconds).toBe(172800)
  })

  it('launch-cost + weariness + shield + repelled knobs match seed', () => {
    expect(PVP_CONSTANTS.launch_cost_base_credits).toBe(200)
    expect(PVP_CONSTANTS.launch_cost_per_fleet_credits).toBe(0.2)
    expect(PVP_CONSTANTS.launch_cost_per_pc_credits).toBe(10)
    expect(PVP_CONSTANTS.war_weariness_multiplier).toBe(1.2)
    expect(PVP_CONSTANTS.war_weariness_window_hours).toBe(24)
    expect(PVP_CONSTANTS.new_player_shield_days).toBe(3)
    expect(PVP_CONSTANTS.defender_pop_loss_repelled).toBe(0.3)
    expect(PVP_CONSTANTS.join_window_seconds).toBe(7200)
  })

  it('combat constants match the D4 seed (effects.ts parity)', () => {
    expect(PVP_CONSTANTS.turret_defense_power_per_level).toBe(500)
    expect(PVP_CONSTANTS.militia_defense_per_population).toBe(0.15)
    expect(PVP_CONSTANTS.effective_level_cap).toBe(10)
    expect(PVP_CONSTANTS.diminishing_returns_factor).toBe(0.5)
    expect(PVP_CONSTANTS.massive_world_multiplier).toBe(1.1)
  })

  it('outcome table matches the seed buckets + losses', () => {
    expect(PVP_CONSTANTS.outcome_ratios_and_losses.decisive).toEqual({
      min_ratio: 1.5,
      attacker_loss: 0.4,
    })
    expect(PVP_CONSTANTS.outcome_ratios_and_losses.pyrrhic).toEqual({
      min_ratio: 1.0,
      attacker_loss: 0.7,
    })
    expect(PVP_CONSTANTS.outcome_ratios_and_losses.repelled).toEqual({
      min_ratio: 0.75,
      attacker_loss: 0.6,
    })
    expect(PVP_CONSTANTS.outcome_ratios_and_losses.crushed).toEqual({
      min_ratio: 0.0,
      attacker_loss: 0.9,
    })
  })
})

describe('P3-T02-B estimator — launch cost + travel (0005 mirrors)', () => {
  it('launchCost = 200 + fleet×0.2 + distance×10 (§5.2 worked example)', () => {
    expect(launchCost(100, 1)).toBe(230)
    expect(launchCost(5000, 10)).toBe(1300)
    expect(launchCost(0, 0)).toBe(200)
    expect(launchCost(100, null)).toBe(220)
  })

  it('travelSeconds mirrors least(greatest(round), floor), cap)', () => {
    expect(travelSeconds(null)).toBe(600)
    expect(travelSeconds(0)).toBe(600)
    expect(travelSeconds(1)).toBe(600)
    expect(travelSeconds(100)).toBe(6000)
    expect(travelSeconds(4000)).toBe(172800)
    expect(travelSeconds(5000)).toBe(172800)
  })
})

describe('P3-T02-B estimator — guards mirroring the RPC CHECKs', () => {
  it('attackPower rejects 0 / NaN / ±Infinity soldiers and bad tiers', () => {
    expect(() => attackPower(0, 3)).toThrow(RangeError)
    expect(() => attackPower(Number.NaN, 3)).toThrow(RangeError)
    expect(() => attackPower(Number.POSITIVE_INFINITY, 3)).toThrow(RangeError)
    expect(() => attackPower(100, -1)).toThrow(RangeError)
    expect(() => attackPower(100, 101)).toThrow(RangeError)
    expect(() => attackPower(100, 2.5)).toThrow(RangeError)
  })

  it('defensePowerEstimate rejects non-finite population', () => {
    expect(() => defensePowerEstimate(1, Number.NaN)).toThrow(RangeError)
    expect(() => defensePowerEstimate(1, Number.NEGATIVE_INFINITY)).toThrow(
      RangeError,
    )
    expect(() => defensePowerEstimate(1, -1)).toThrow(RangeError)
  })

  it('estimateRatio rejects non-finite ap/dp/weariness and negative weariness', () => {
    expect(() => estimateRatio(Number.NaN, 100)).toThrow(RangeError)
    expect(() => estimateRatio(100, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => estimateRatio(100, 100, -1)).toThrow(RangeError)
  })

  it('launchCost and travelSeconds reject non-finite / negative distance', () => {
    expect(() => launchCost(100, Number.NaN)).toThrow(RangeError)
    expect(() => launchCost(100, -1)).toThrow(RangeError)
    expect(() => travelSeconds(-5)).toThrow(RangeError)
    expect(() => travelSeconds(Number.NaN)).toThrow(RangeError)
  })
})

describe('P3-T02-B estimator — estimateScout end-to-end preview', () => {
  it('a strong raid vs a soft target previews decisive with 40% losses', () => {
    const estimate = estimateScout({
      soldiers: 1500,
      shipyardTier: 3,
      turretLevel: 0,
      population: 1000,
      massiveWorld: false,
      recentLaunches: 0,
    })
    // AP 1500×3 = 4500 vs DP 0.15×1000 = 150 -> ratio 30 -> decisive
    expect(estimate.ap).toBe(4500)
    expect(estimate.dp).toBe(150)
    expect(estimate.weariness).toBe(1)
    expect(estimate.ratio).toBe(30)
    expect(estimate.outcome).toBe('decisive')
    expect(estimate.attackerLossPct).toBe(0.4)
    expect(estimate.attackerLosses).toBe(600)
  })

  it('a weak raid with prior conquests drops through the buckets', () => {
    const strong = estimateScout({
      soldiers: 3000,
      shipyardTier: 1,
      turretLevel: 0,
      population: 1000,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(strong.ratio).toBeCloseTo(20, 12)
    expect(strong.outcome).toBe('decisive')

    const weary = estimateScout({
      soldiers: 3000,
      shipyardTier: 1,
      turretLevel: 0,
      population: 1000,
      massiveWorld: false,
      recentLaunches: 3,
    })
    // weariness 1.2^3 = 1.728 -> ratio 20/1.728 ≈ 11.57 (still decisive)
    expect(weary.weariness).toBeCloseTo(1.728, 12)
    expect(weary.ratio).toBeCloseTo(20 / 1.728, 12)
  })

  it('the zero-DP edge previews decisive with AP>0', () => {
    const estimate = estimateScout({
      soldiers: 100,
      shipyardTier: 1,
      turretLevel: 0,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.dp).toBe(0)
    expect(estimate.ratio).toBe(9999)
    expect(estimate.outcome).toBe('decisive')
  })
})

describe('P3-T03-B resolver-expected parity — 04_conquest_math recipe pins', () => {
  // Hard-coded expected values the SQL suite pins server-side
  // (supabase/tests/04_conquest_math.sql). A drift on either side fails the
  // same case in both suites. AP = soldiers × effectiveLevel(tier), DP =
  // 500×effectiveLevel(turrets) + 0.15×pop (×1.1 massiveWorld), ratio =
  // AP/(max(DP,0)×weariness), first conquest weariness 1.0.

  it('decisive boundary (ratio exactly 1.5): 750 × tier 3 vs t3 turrets', () => {
    const estimate = estimateScout({
      soldiers: 750,
      shipyardTier: 3,
      turretLevel: 3,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.ap).toBe(2250)
    expect(estimate.dp).toBe(1500)
    expect(estimate.ratio).toBe(1.5)
    expect(estimate.outcome).toBe('decisive')
    expect(estimate.attackerLosses).toBe(300) // round(750×0.4)
  })

  it('pyrrhic boundary (ratio exactly 1.0): 500 × tier 3 vs t3 turrets', () => {
    const estimate = estimateScout({
      soldiers: 500,
      shipyardTier: 3,
      turretLevel: 3,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.ap).toBe(1500)
    expect(estimate.dp).toBe(1500)
    expect(estimate.ratio).toBe(1.0)
    expect(estimate.outcome).toBe('pyrrhic')
    expect(estimate.attackerLosses).toBe(350) // round(500×0.7)
  })

  it('repelled boundary (ratio exactly 0.75): 375 × tier 3 vs t3 turrets', () => {
    const estimate = estimateScout({
      soldiers: 375,
      shipyardTier: 3,
      turretLevel: 3,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.ap).toBe(1125)
    expect(estimate.dp).toBe(1500)
    expect(estimate.ratio).toBe(0.75)
    expect(estimate.outcome).toBe('repelled')
    expect(estimate.attackerLosses).toBe(225) // round(375×0.6)
  })

  it('crushed just-below (ratio 0.748): 374 × tier 3 vs t3 turrets', () => {
    const estimate = estimateScout({
      soldiers: 374,
      shipyardTier: 3,
      turretLevel: 3,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.ap).toBe(1122)
    expect(estimate.ratio).toBeCloseTo(1122 / 1500, 12) // 0.748
    expect(estimate.outcome).toBe('crushed')
    expect(estimate.attackerLosses).toBe(337) // round(374×0.9)
  })

  it('zero-AP (tier-0 shipyard): ratio 0 → crushed', () => {
    const estimate = estimateScout({
      soldiers: 100,
      shipyardTier: 0,
      turretLevel: 1,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.ap).toBe(0)
    expect(estimate.dp).toBe(500)
    expect(estimate.ratio).toBe(0)
    expect(estimate.outcome).toBe('crushed')
    expect(estimate.attackerLosses).toBe(90) // round(100×0.9)
  })

  it('massiveWorld DP pin: (500×2 + 0.15×1000) × 1.1 = 1265', () => {
    expect(defensePowerEstimate(2, 1000, true)).toBe(1265)
  })

  it('effectiveLevel turret DP pin: t11 → 500 × 10.5 = 5250, t21 → 7750', () => {
    expect(defensePowerEstimate(11, 0)).toBe(5250)
    expect(defensePowerEstimate(21, 0)).toBe(7750)
  })

  it('effectiveLevel AP pin (D1): tier-15 shipyard → ×12.5, ratio 1.5 decisive', () => {
    const estimate = estimateScout({
      soldiers: 120,
      shipyardTier: 15,
      turretLevel: 2,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.ap).toBe(1500) // 120 × effectiveLevel(15)=12.5, NOT ×15
    expect(estimate.dp).toBe(1000)
    expect(estimate.ratio).toBe(1.5)
    expect(estimate.outcome).toBe('decisive')
    expect(estimate.attackerLosses).toBe(48) // round(120×0.4)
  })

  it('repelled 30% pop end-to-end: 300 × tier 3 vs t2 + pop 1000', () => {
    const estimate = estimateScout({
      soldiers: 300,
      shipyardTier: 3,
      turretLevel: 2,
      population: 1000,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.ap).toBe(900)
    expect(estimate.dp).toBe(1150)
    expect(estimate.ratio).toBeCloseTo(900 / 1150, 12) // 0.7826
    expect(estimate.outcome).toBe('repelled')
    expect(estimate.attackerLosses).toBe(180) // round(300×0.6)
  })

  it('weariness stack 1.2^2 = 1.44: 750 × tier 3 vs t3 turrets', () => {
    expect(warWearinessMultiplier(2)).toBeCloseTo(1.44, 12)
    const estimate = estimateScout({
      soldiers: 750,
      shipyardTier: 3,
      turretLevel: 3,
      population: 0,
      massiveWorld: false,
      recentLaunches: 2,
    })
    expect(estimate.weariness).toBeCloseTo(1.44, 12)
    expect(estimate.ratio).toBeCloseTo(2250 / (1500 * 1.44), 12) // 1.0417
    expect(estimate.outcome).toBe('pyrrhic')
    expect(estimate.attackerLosses).toBe(525) // round(750×0.7)
  })
})

describe('P3-T03-C estimator — boundary, zero-edge, MW-flip, rounding, parity', () => {
  it('just-below boundaries 1.4999 / 0.9999 / 0.7499 drop to the NEXT bucket', () => {
    // >= inclusivity is pinned at the exact boundaries elsewhere; these pin
    // the OPEN side — one epsilon below each boundary must fall through.
    expect(estimateOutcome(1.4999)).toEqual({
      outcome: 'pyrrhic',
      attackerLossPct: 0.7,
    })
    expect(estimateOutcome(0.9999)).toEqual({
      outcome: 'repelled',
      attackerLossPct: 0.6,
    })
    expect(estimateOutcome(0.7499)).toEqual({
      outcome: 'crushed',
      attackerLossPct: 0.9,
    })
  })

  it('BOTH-zero edge (DP 0 AND AP 0) → defined crushed, no crash', () => {
    // Mirrors resolve_attack: required = max(DP,0)×weariness = 0; AP not
    // > 0 → v_ratio := 0 → crushed (04_conquest_math t-zero0 pin).
    expect(estimateRatio(0, 0, 1)).toBe(0)
    const estimate = estimateScout({
      soldiers: 100,
      shipyardTier: 0,
      turretLevel: 0,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.ap).toBe(0)
    expect(estimate.dp).toBe(0)
    expect(estimate.ratio).toBe(0)
    expect(estimate.outcome).toBe('crushed')
    expect(estimate.attackerLosses).toBe(90) // round(100×0.9)
  })

  it('massiveWorld flips a boundary: same stats, MW repelled / control pyrrhic', () => {
    const base = {
      soldiers: 350,
      shipyardTier: 3,
      turretLevel: 2,
      population: 0,
      recentLaunches: 0,
    }
    const control = estimateScout({ ...base, massiveWorld: false })
    expect(control.dp).toBe(1000) // 500×2, no militia
    expect(control.ratio).toBe(1.05) // 1050/1000 → pyrrhic
    expect(control.outcome).toBe('pyrrhic')
    expect(control.attackerLosses).toBe(245) // round(350×0.7)

    const massive = estimateScout({ ...base, massiveWorld: true })
    expect(massive.dp).toBe(1100) // ×1.1
    expect(massive.ratio).toBeCloseTo(1050 / 1100, 12) // 0.9545 → repelled
    expect(massive.outcome).toBe('repelled')
    expect(massive.attackerLosses).toBe(210) // round(350×0.6)
  })

  it('AP effectiveLevel parity at tiers 11 / 15 / 21 (half-after-10, D1)', () => {
    // effectiveLevel(t) = min(t,10) + max(0,t−10)×0.5 — identical to the
    // resolver's least/greatest expression (04_conquest_math t-ap11/t-ap21).
    expect(attackPower(100, 11)).toBe(1050) // 100 × 10.5
    expect(attackPower(100, 15)).toBe(1250) // 100 × 12.5
    expect(attackPower(100, 21)).toBe(1550) // 100 × 15.5
    for (const tier of [0, 1, 5, 10, 11, 15, 21, 100]) {
      expect(attackPower(100, tier)).toBe(100 * effectiveLevel(tier))
    }
  })

  it('DP effectiveLevel parity at turret levels 11 / 21 / 100', () => {
    for (const t of [0, 10, 11, 21, 100]) {
      expect(defensePowerEstimate(t, 0)).toBe(500 * effectiveLevel(t))
    }
    expect(defensePowerEstimate(21, 0)).toBe(7750) // 500 × 15.5
  })

  it('casualty rounding is round(), not floor — 12×0.4→5 and 501×0.4→200', () => {
    // round(12×0.4)=round(4.8)=5 discriminates round from floor (4). The
    // resolver pins the same values server-side (t-roundfl / t-rounddec).
    const twelve = estimateScout({
      soldiers: 12,
      shipyardTier: 3,
      turretLevel: 0,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(twelve.ap).toBe(36)
    expect(twelve.dp).toBe(0)
    expect(twelve.ratio).toBe(9999) // zero-DP guard
    expect(twelve.outcome).toBe('decisive')
    expect(twelve.attackerLosses).toBe(5)

    const five01 = estimateScout({
      soldiers: 501,
      shipyardTier: 3,
      turretLevel: 2,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(five01.ap).toBe(1503)
    expect(five01.dp).toBe(1000)
    expect(five01.ratio).toBeCloseTo(1503 / 1000, 12) // 1.503
    expect(five01.outcome).toBe('decisive')
    expect(five01.attackerLosses).toBe(200) // round(200.4)
  })

  it('empty-pop colony: DP is turrets-only, militia contributes 0', () => {
    expect(defensePowerEstimate(2, 0)).toBe(1000)
    const estimate = estimateScout({
      soldiers: 200,
      shipyardTier: 3,
      turretLevel: 2,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(estimate.ap).toBe(600)
    expect(estimate.dp).toBe(1000)
    expect(estimate.ratio).toBeCloseTo(600 / 1000, 12)
    expect(estimate.outcome).toBe('crushed')
    expect(estimate.attackerLosses).toBe(180) // round(200×0.9)
  })

  it('weariness via estimateScout: 0 prior → 1.0x, 3 prior → 1.728x', () => {
    const fresh = estimateScout({
      soldiers: 750,
      shipyardTier: 3,
      turretLevel: 3,
      population: 0,
      massiveWorld: false,
      recentLaunches: 0,
    })
    expect(fresh.weariness).toBe(1)
    expect(fresh.ratio).toBe(1.5)
    expect(fresh.outcome).toBe('decisive')

    const weary = estimateScout({
      soldiers: 750,
      shipyardTier: 3,
      turretLevel: 3,
      population: 0,
      massiveWorld: false,
      recentLaunches: 3,
    })
    expect(weary.weariness).toBeCloseTo(1.728, 12)
    expect(weary.ratio).toBeCloseTo(2250 / (1500 * 1.728), 12) // 0.8681
    expect(weary.outcome).toBe('repelled')
  })
})

describe('P3-T04-B estimator — combinedAttackPower (per-player weariness parity)', () => {
  // Mirrors the 0011 resolver exactly: combined_ap = Σ (soldiers ×
  // effectiveLevel(shipyardTier)) / 1.2^own_recentLaunches. A fresh member
  // (recentLaunches 0, or omitted) counts at full strength; a weary member
  // counts at reduced strength. Sums Σ members[].ap == combined_ap.

  it('empty gang → 0', () => {
    expect(combinedAttackPower([])).toBe(0)
  })

  it('two fresh members combine their effectiveLevel AP (04 t-band / 05 1v5 parity)', () => {
    expect(
      combinedAttackPower([
        { soldiers: 500, shipyardTier: 3 },
        { soldiers: 250, shipyardTier: 3 },
      ]),
    ).toBe(2250) // 1500 + 750
  })

  it('recentLaunches defaults to 0 when omitted (fresh attacker, full strength)', () => {
    expect(combinedAttackPower([{ soldiers: 750, shipyardTier: 3 }])).toBe(2250)
  })

  it('per-player weariness: only the weary member is deflated (05 case-5 pin)', () => {
    // A: 2 prior → 432/1.44 = 300 (NOT 432); B: 0 prior → 2100 (undiminished).
    const gang = [
      { soldiers: 144, shipyardTier: 3, recentLaunches: 2 },
      { soldiers: 700, shipyardTier: 3, recentLaunches: 0 },
    ]
    expect(combinedAttackPower(gang)).toBeCloseTo(2400, 6) // 300 + 2100
    expect(combinedAttackPower([gang[0]])).toBeCloseTo(432 / 1.44, 6)
    expect(combinedAttackPower([gang[1]])).toBeCloseTo(2100, 6)
  })

  it('effectiveLevel applies past tier 10 inside a gang (D1 parity)', () => {
    // tier 15 → ×12.5 = 1250; tier 21 → ×15.5 = 1550.
    expect(
      combinedAttackPower([
        { soldiers: 100, shipyardTier: 15 },
        { soldiers: 100, shipyardTier: 21 },
      ]),
    ).toBe(2800)
  })

  it('mixed weariness + high tier: tier-21 member with 2 prior is /1.44', () => {
    expect(
      combinedAttackPower([{ soldiers: 100, shipyardTier: 21, recentLaunches: 2 }]),
    ).toBeCloseTo(1550 / 1.44, 6)
  })

  it('delegates member validation to attackPower / warWearinessMultiplier', () => {
    expect(() => combinedAttackPower([{ soldiers: 0, shipyardTier: 3 }])).toThrow(RangeError)
    expect(() => combinedAttackPower([{ soldiers: 100, shipyardTier: 101 }])).toThrow(
      RangeError,
    )
    expect(() =>
      combinedAttackPower([{ soldiers: 100, shipyardTier: 3, recentLaunches: -1 }]),
    ).toThrow(RangeError)
    expect(() => combinedAttackPower([{ soldiers: 100, shipyardTier: 3, recentLaunches: 1.5 }])).toThrow(
      RangeError,
    )
    // @ts-expect-error — the function guards non-array input at runtime.
    expect(() => combinedAttackPower({ soldiers: 100, shipyardTier: 3 })).toThrow(RangeError)
  })
})
