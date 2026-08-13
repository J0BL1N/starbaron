/**
 * Scout-capable ship model (P6-T03) — the scouting capability a fleet derives
 * from its scout-class ships: scouting power, sensor range, scout speed,
 * detection profile, and the deepest intel level the scout complement can
 * reach. Mission mechanics (launch, travel, report) are the P6-T04 concern.
 *
 * The P5-T01 scout class is the single source of per-ship numbers: scouting
 * power and speed are DELEGATED to the LOCKED `SHIP_CLASSES.scout` roster
 * entry — never re-derived as bare constants here (P10 owns balancing). The
 * remaining profile fields come from the DRAFT formulas documented below,
 * exposed as named constants so the balance harness can adjust them without
 * touching downstream math.
 *
 * DESIGN decisions (all documented — DESIGN.md has no scout-ship section):
 * - scoutCount is `composition.scout`; a fleet with no scouts cannot scout
 *   and derives a baseline profile (base range, minimum detection, no intel).
 * - scoutingPower = scoutCount × SHIP_CLASSES.scout.scoutingPower (LOCKED).
 * - sensorRangePc = SENSOR_RANGE_BASE_PC + log10(1 + scoutingPower) — a DRAFT
 *   sub-linear scaling: more scouts widen the sweep with diminishing returns.
 * - scoutSpeedPcPerSec = SHIP_CLASSES.scout.speedPcPerSec (LOCKED).
 * - detectionChance = clamp(DETECTION_CHANCE_BASE + scoutingPower /
 *   DETECTION_POWER_DIVISOR, DETECTION_CHANCE_MIN, DETECTION_CHANCE_MAX) — a
 *   DRAFT profile: a larger scout complement is harder to slip past. How a
 *   detected sighting resolves is the P6-T04 mission / P7 combat concern.
 * - maxIntelLevel (exported thresholds): 0 scouts → 'none'; 1-2 → 'scanned';
 *   3-9 → 'scouted'; 10+ → 'deep recon'. 'full intelligence' is NOT reachable
 *   by scouts alone — it needs a probe or attack (P7), an explicit ceiling.
 *
 * Pure module — deterministic, no time-source reads, no nondeterministic
 * APIs, no module-level mutable state (lookup tables frozen), strictly typed.
 */

import { SHIP_CLASSES } from '../fleet/ships'
import { fleetCompositionSize } from '../fleet/fleet'
import { isIntelLevel } from './levels'
import type { FleetComposition } from '../fleet/fleet'
import type { IntelLevel } from './levels'

export interface ScoutProfile {
  scoutCount: number
  scoutingPower: number
  sensorRangePc: number
  scoutSpeedPcPerSec: number
  detectionChance: number
  maxIntelLevel: IntelLevel
}

/** DRAFT balance-harness inputs (P10 owns the final values; all deterministic). */
export const SENSOR_RANGE_BASE_PC = 5
export const DETECTION_CHANCE_BASE = 0.05
export const DETECTION_POWER_DIVISOR = 10_000
export const DETECTION_CHANCE_MIN = 0.05
export const DETECTION_CHANCE_MAX = 0.95

/** Scout-count cutoffs for the deepest intel level a scout complement reaches. */
export const INTEL_SCANNED_MIN_SCOUTS = 1
export const INTEL_SCOUTED_MIN_SCOUTS = 3
export const INTEL_DEEP_RECON_MIN_SCOUTS = 10

const INTEL_LABELS: Readonly<Record<IntelLevel, string>> = Object.freeze({
  none: 'no intel',
  observed: 'observed intel',
  scanned: 'scanned intel',
  scouted: 'scouted intel',
  'deep recon': 'deep recon intel',
  'full intelligence': 'full intelligence intel',
})

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative integer, got ${String(value)}`,
    )
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function formatRangePc(range: number): number {
  return Math.round(range * 10) / 10
}

function formatPercent(chance: number): number {
  return Math.round(chance * 100)
}

/**
 * The deepest intel level a scout count can reach (deterministic threshold
 * ladder): 0 → 'none', 1-2 → 'scanned', 3-9 → 'scouted', 10+ → 'deep recon'.
 * 'full intelligence' is intentionally unreachable here — that ceiling
 * requires a probe or attack (P7). Invalid counts throw a RangeError.
 */
export function maxIntelLevelForScouts(scoutCount: number): IntelLevel {
  assertNonNegativeInteger(scoutCount, 'scoutCount')
  if (scoutCount >= INTEL_DEEP_RECON_MIN_SCOUTS) {
    return 'deep recon'
  }
  if (scoutCount >= INTEL_SCOUTED_MIN_SCOUTS) {
    return 'scouted'
  }
  if (scoutCount >= INTEL_SCANNED_MIN_SCOUTS) {
    return 'scanned'
  }
  return 'none'
}

/**
 * The scouting capability of a fleet composition. Scout count is
 * `composition.scout` (counts must be non-negative integers — RangeError
 * otherwise). Power and speed DELEGATE to the LOCKED `SHIP_CLASSES.scout`
 * roster entry; range and detection use the documented DRAFT formulas. A
 * zero-scout fleet yields the baseline profile (base range, minimum
 * detection, 'none' intel).
 */
export function scoutProfileFor(composition: FleetComposition): ScoutProfile {
  fleetCompositionSize(composition)
  const scoutCount = composition.scout
  const scoutingPower = scoutCount * SHIP_CLASSES.scout.scoutingPower
  const sensorRangePc =
    SENSOR_RANGE_BASE_PC + Math.log10(1 + scoutingPower)
  const detectionChance = clamp(
    DETECTION_CHANCE_BASE + scoutingPower / DETECTION_POWER_DIVISOR,
    DETECTION_CHANCE_MIN,
    DETECTION_CHANCE_MAX,
  )
  return {
    scoutCount,
    scoutingPower,
    sensorRangePc,
    scoutSpeedPcPerSec: SHIP_CLASSES.scout.speedPcPerSec,
    detectionChance,
    maxIntelLevel: maxIntelLevelForScouts(scoutCount),
  }
}

/**
 * Whether a composition contains at least one scout ship. Counts must be
 * non-negative integers (RangeError otherwise).
 */
export function canScout(composition: FleetComposition): boolean {
  fleetCompositionSize(composition)
  return composition.scout > 0
}

/**
 * A deterministic one-line summary of a scout profile. The profile must carry
 * a known intel level (RangeError otherwise). Example for 3 scouts:
 * '3 scouts · power 300 · range 7.5 pc · detects 8% · scouted intel'.
 */
export function scoutSummary(profile: ScoutProfile): string {
  if (!isIntelLevel(profile.maxIntelLevel)) {
    throw new RangeError(
      `profile.maxIntelLevel must be a known intel level, got ${JSON.stringify(profile.maxIntelLevel)}`,
    )
  }
  const unit = profile.scoutCount === 1 ? 'scout' : 'scouts'
  return [
    `${profile.scoutCount} ${unit}`,
    `power ${profile.scoutingPower}`,
    `range ${formatRangePc(profile.sensorRangePc)} pc`,
    `detects ${formatPercent(profile.detectionChance)}%`,
    INTEL_LABELS[profile.maxIntelLevel],
  ].join(' · ')
}
