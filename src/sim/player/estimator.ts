import { effectiveLevel } from '../planets/levels'
import { defensePower } from '../structures/effects'

// =====================================================================
// Client-side scout/launch estimator (P3-T02-B, §2.2). The server owns
// resolve (D8); this mirrors the same math as a pure estimate so the scout
// preview and the authoritative outcome always agree. Constants mirror the
// applied 0006 game_config seed exactly — tests/backend-estimator.test.ts
// pins them (closing the P3-T01 balance-drift open finding).
// =====================================================================

export type OutcomeId = 'decisive' | 'pyrrhic' | 'repelled' | 'crushed'

export interface OutcomeSpec {
  min_ratio: number
  attacker_loss: number
}

export interface PvpConstants {
  travel_minutes_per_pc: number
  travel_floor_seconds: number
  travel_cap_seconds: number
  join_window_seconds: number
  launch_cost_base_credits: number
  launch_cost_per_fleet_credits: number
  launch_cost_per_pc_credits: number
  war_weariness_multiplier: number
  war_weariness_window_hours: number
  new_player_shield_days: number
  defender_pop_loss_repelled: number
  turret_defense_power_per_level: number
  militia_defense_per_population: number
  effective_level_cap: number
  diminishing_returns_factor: number
  massive_world_multiplier: number
  outcome_ratios_and_losses: Record<OutcomeId, OutcomeSpec>
}

// Mirrors the applied 0006_game_config_seed.sql values exactly (DESIGN §5a
// draft tunables + D4 combat constants).
export const PVP_CONSTANTS: Readonly<PvpConstants> = {
  travel_minutes_per_pc: 1,
  travel_floor_seconds: 600,
  travel_cap_seconds: 172800,
  join_window_seconds: 7200,
  launch_cost_base_credits: 200,
  launch_cost_per_fleet_credits: 0.2,
  launch_cost_per_pc_credits: 10,
  war_weariness_multiplier: 1.2,
  war_weariness_window_hours: 24,
  new_player_shield_days: 3,
  defender_pop_loss_repelled: 0.3,
  turret_defense_power_per_level: 500,
  militia_defense_per_population: 0.15,
  effective_level_cap: 10,
  diminishing_returns_factor: 0.5,
  massive_world_multiplier: 1.1,
  outcome_ratios_and_losses: {
    decisive: { min_ratio: 1.5, attacker_loss: 0.4 },
    pyrrhic: { min_ratio: 1.0, attacker_loss: 0.7 },
    repelled: { min_ratio: 0.75, attacker_loss: 0.6 },
    crushed: { min_ratio: 0.0, attacker_loss: 0.9 },
  },
}

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} must be a finite number, got ${value}`)
  }
}

// AP = soldiers × effectiveLevel(shipyard tier) (§5a, P3-T03-B D1). Mirrors
// the launch/join guards in 0005 (finite positive soldiers; tier integer
// 0..100 per the table CHECK) AND the 0010 resolver change: the shipyard
// contributes its EFFECTIVE level (half-after-10) — exactly as the turret
// side does — so a tier-15 shipyard multiplies AP by 12.5, not 15.
export function attackPower(soldiers: number, shipyardTier: number): number {
  assertFinite(soldiers, 'soldiers')
  assertFinite(shipyardTier, 'shipyardTier')
  if (soldiers <= 0) {
    throw new RangeError(`soldiers must be a positive number, got ${soldiers}`)
  }
  if (!Number.isInteger(shipyardTier) || shipyardTier < 0 || shipyardTier > 100) {
    throw new RangeError(
      `shipyardTier must be an integer between 0 and 100, got ${shipyardTier}`,
    )
  }
  return soldiers * effectiveLevel(shipyardTier)
}

// DP = turrets × 500 (effectiveLevel) + population × 0.15 (§5a), ×1.1 when
// the target has the massiveWorld quirk. Delegates to the sim's defensePower
// (src/sim/structures/effects.ts) so client and server share one formula;
// garrison does NOT add to DP (B5, LOCKED §5a formula).
export function defensePowerEstimate(
  turretLevel: number,
  population: number,
  massiveWorld = false,
  constants: Pick<PvpConstants, 'massive_world_multiplier'> = PVP_CONSTANTS,
): number {
  assertFinite(population, 'population')
  const base = defensePower(turretLevel, population)
  return massiveWorld ? base * constants.massive_world_multiplier : base
}

// War-weariness = multiplier^recentLaunches (B1 semantics: the FIRST
// launch of a 24h period faces 1.0x; the 4th faces 1.2^3 = 1.728x, §5a).
// recentLaunches counts the launcher's LAUNCHES within the weariness
// period (any outcome — a repelled/crushed launch still counts), mirroring
// war_weariness_multiplier_for(launcher_id, NULL): get_galaxy's
// my_weariness == 1.2^recentLaunches, so the two always agree.
export function warWearinessMultiplier(
  recentLaunches: number,
  constants: Pick<PvpConstants, 'war_weariness_multiplier'> = PVP_CONSTANTS,
): number {
  if (!Number.isInteger(recentLaunches) || recentLaunches < 0) {
    throw new RangeError(
      `recentLaunches must be a non-negative integer, got ${recentLaunches}`,
    )
  }
  return Math.pow(constants.war_weariness_multiplier, recentLaunches)
}

// Ratio = AP / (max(DP,0) × weariness). Zero-DP edge mirrors resolve_attack:
// AP>0 → 9999 (decisive); AP=0 → 0 (crushed).
export function estimateRatio(ap: number, dp: number, weariness = 1): number {
  assertFinite(ap, 'ap')
  assertFinite(dp, 'dp')
  assertFinite(weariness, 'weariness')
  if (weariness < 0) {
    throw new RangeError(`weariness must be non-negative, got ${weariness}`)
  }
  const required = Math.max(dp, 0) * weariness
  if (required > 0) {
    return ap / required
  }
  if (ap > 0) {
    return 9999
  }
  return 0
}

export interface EstimatedOutcome {
  outcome: OutcomeId
  attackerLossPct: number
}

// DESIGN §5a outcome table (buckets in descending min_ratio).
export function estimateOutcome(
  ratio: number,
  constants: Pick<PvpConstants, 'outcome_ratios_and_losses'> = PVP_CONSTANTS,
): EstimatedOutcome {
  assertFinite(ratio, 'ratio')
  const table = constants.outcome_ratios_and_losses
  if (ratio >= table.decisive.min_ratio) {
    return { outcome: 'decisive', attackerLossPct: table.decisive.attacker_loss }
  }
  if (ratio >= table.pyrrhic.min_ratio) {
    return { outcome: 'pyrrhic', attackerLossPct: table.pyrrhic.attacker_loss }
  }
  if (ratio >= table.repelled.min_ratio) {
    return { outcome: 'repelled', attackerLossPct: table.repelled.attacker_loss }
  }
  return { outcome: 'crushed', attackerLossPct: table.crushed.attacker_loss }
}

// Launch cost = base + soldiers × per-fleet + distancePc × per-pc (§5.2),
// all from the 0006 seed (credits deducted at launch by the server).
export function launchCost(
  soldiers: number,
  distancePc: number | null,
  constants: Pick<
    PvpConstants,
    'launch_cost_base_credits' | 'launch_cost_per_fleet_credits' | 'launch_cost_per_pc_credits'
  > = PVP_CONSTANTS,
): number {
  assertFinite(soldiers, 'soldiers')
  const dist = distancePc ?? 0
  assertFinite(dist, 'distancePc')
  if (dist < 0) {
    throw new RangeError(`distancePc must be non-negative, got ${dist}`)
  }
  return (
    constants.launch_cost_base_credits +
    soldiers * constants.launch_cost_per_fleet_credits +
    dist * constants.launch_cost_per_pc_credits
  )
}

// Travel = distancePc × minutes-per-pc × 60s, floor / cap from game_config
// (0005:208 mirrors least(greatest(round(...), floor), cap)).
export function travelSeconds(
  distancePc: number | null,
  constants: Pick<
    PvpConstants,
    'travel_minutes_per_pc' | 'travel_floor_seconds' | 'travel_cap_seconds'
  > = PVP_CONSTANTS,
): number {
  const dist = distancePc ?? 0
  assertFinite(dist, 'distancePc')
  if (dist < 0) {
    throw new RangeError(`distancePc must be non-negative, got ${dist}`)
  }
  const raw = Math.round(dist * constants.travel_minutes_per_pc * 60)
  return Math.min(
    Math.max(raw, constants.travel_floor_seconds),
    constants.travel_cap_seconds,
  )
}

export interface ScoutEstimateInput {
  soldiers: number
  shipyardTier: number
  turretLevel: number
  population: number
  massiveWorld: boolean
  recentLaunches: number
}

export interface ScoutEstimate {
  ap: number
  dp: number
  weariness: number
  ratio: number
  outcome: OutcomeId
  attackerLossPct: number
  attackerLosses: number
}

// One-shot scout preview: AP vs DP vs odds before committing (§5 defaults).
export function estimateScout(input: ScoutEstimateInput): ScoutEstimate {
  const ap = attackPower(input.soldiers, input.shipyardTier)
  const dp = defensePowerEstimate(
    input.turretLevel,
    input.population,
    input.massiveWorld,
  )
  const weariness = warWearinessMultiplier(input.recentLaunches)
  const ratio = estimateRatio(ap, dp, weariness)
  const { outcome, attackerLossPct } = estimateOutcome(ratio)
  return {
    ap,
    dp,
    weariness,
    ratio,
    outcome,
    attackerLossPct,
    attackerLosses: Math.round(input.soldiers * attackerLossPct),
  }
}
