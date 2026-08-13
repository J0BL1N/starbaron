/**
 * Sensor / stealth / counter-intelligence contract (P6-T10) — the
 * forward-looking detection model: a fleet's SENSOR RANGE vs an emitter's
 * SIGNATURE (the inverse of stealth) at a given distance. This module is the
 * draft stat model plus the deterministic hook points the P7/P9 systems build
 * on; the full mechanics (stealth ship classes, counter-intel missions,
 * emission rolls) land in those phases. Nothing here is balanced: every
 * number is a balance-harness input (P10 owns the final values) and each
 * formula is documented as a draft approximation.
 *
 * DESIGN decisions (all documented; DESIGN.md has no sensor section):
 * - sensorRange: a fleet's sensors come from its ships' sensor capability.
 *   No P5 class carries an explicit sensor stat, so the draft derives range
 *   from the fleet's aggregate scouting power, DELEGATED to
 *   scouts.scoutProfileFor when the fleet has scouts (the roster's only
 *   scouting-capable class is the scout, so the max-over-classes notion
 *   collapses to the scout-derived scouting power); a fleet with no scouts
 *   resolves to the draft base. Draft: base 3 pc + (scoutingPower / 100) × 0.5.
 * - signatureOf: the fleet's emission signature — the stealth inverse. Draft:
 *   (1 + shipCount × 0.1) × stealthFactor(composition). Stealth modifiers
 *   (future) multiply this down below 1; today the factor is exactly 1, so
 *   the result is 1 + shipCount × 0.1.
 * - stealthFactor: the STEALTH HOOK. 1.0 for every composition today — no
 *   stealth classes exist in the P5 roster. P7/P9 fill this extension point:
 *   a composition carrying stealth classes returns a factor below 1, and
 *   signatureOf consumes it automatically with no signatureOf change.
 * - detectionOutcome: the draft detection gate. Detected when the target is
 *   not cloaked AND its distance is within the sensor range
 *   (distance <= range). A cloaked target is never detected regardless of
 *   range — the counter-intel override. margin = range − distance (negative
 *   when out of range, 0 exactly at range). signature is echoed in the
 *   outcome as the context for a future emission roll; the draft gates on
 *   range only.
 * - counterIntel: how a scout's own detection profile holds up once
 *   counter-intel applies. effectiveRangePc is unchanged (a placeholder —
 *   the real counter-intel range model is P7/P9). effectiveDetection: a
 *   scout already spotted exercises no additional detection roll — its
 *   effective detection is its profile chance; a scout that remains
 *   unspotted keeps a reduced fraction (0.05 × profile chance, the
 *   COUNTER_INTEL_UNDETECTED_FACTOR). The spec's parenthetical defines the
 *   unspotted branch; the refinement over a bare 0 is documented here so the
 *   draft intent is explicit.
 *
 * Pure module — deterministic, no time-source reads, no nondeterministic
 * APIs, no module-level mutable state, strictly typed.
 */

import { SHIP_CLASS_IDS } from '../fleet/ships'
import { scoutProfileFor } from './scouts'
import { fleetCompositionSize } from '../fleet/fleet'
import type { FleetComposition } from '../fleet/fleet'
import type { ScoutProfile } from './scouts'

/** The detection pairing contract: an emitter's SIGNATURE vs a sensor's RANGE. */
export interface SensorState {
  emitter: { fleetId: string; signature: number }
  sensors: { fleetId: string; rangePc: number }
}

export type DetectionReason = 'in-range' | 'out-of-range' | 'cloaked'

export interface DetectionOutcome {
  detected: boolean
  rangePc: number
  signature: number
  marginPc: number
  reason: DetectionReason
}

export interface DetectionInput {
  sensorRangePc: number
  signature: number
  distancePc: number
  cloaked?: boolean
}

/** DRAFT balance-harness inputs (P10 owns the final values; all deterministic). */
export const SENSOR_RANGE_DRAFT_BASE_PC = 3
export const SENSOR_RANGE_SCOUTING_DIVISOR = 100
export const SENSOR_RANGE_POWER_SCALE_PC = 0.5
export const SIGNATURE_BASE = 1
export const SIGNATURE_PER_SHIP = 0.1
export const STEALTH_FACTOR_DEFAULT = 1
export const COUNTER_INTEL_UNDETECTED_FACTOR = 0.05

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number > 0, got ${value}`)
  }
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${name} must be a finite non-negative number, got ${value}`,
    )
  }
}

function assertValidComposition(composition: FleetComposition): void {
  for (const id of SHIP_CLASS_IDS) {
    const count = composition[id]
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(
        `composition.${id} must be a non-negative integer, got ${String(count)}`,
      )
    }
  }
}

/**
 * The sensor range of a fleet composition. Delegates to
 * scouts.scoutProfileFor for validation and the fleet's aggregate scouting
 * power when the fleet has scouts (scouting power = scout count × the LOCKED
 * roster scout power); a scout-less fleet resolves to the draft base. Draft
 * formula: base 3 pc + (scoutingPower / 100) × 0.5 — balance-harness input
 * (P10 balances). Counts must be non-negative integers (RangeError otherwise).
 */
export function sensorRange(composition: FleetComposition): number {
  const profile = scoutProfileFor(composition)
  const scoutingPower = profile.scoutCount > 0 ? profile.scoutingPower : 0
  return (
    SENSOR_RANGE_DRAFT_BASE_PC +
    (scoutingPower / SENSOR_RANGE_SCOUTING_DIVISOR) * SENSOR_RANGE_POWER_SCALE_PC
  )
}

/**
 * The STEALTH HOOK: the fleet's stealth multiplier, 1.0 for every composition
 * today (no stealth classes exist in the P5 roster). P7/P9 fill this
 * extension point — a composition carrying stealth classes returns a factor
 * below 1, which signatureOf multiplies down automatically. Counts must be
 * non-negative integers (RangeError otherwise).
 */
export function stealthFactor(composition: FleetComposition): number {
  assertValidComposition(composition)
  return STEALTH_FACTOR_DEFAULT
}

/**
 * The fleet's EMISSION signature — the stealth inverse: the larger the fleet,
 * the louder it is. Draft: (1 + shipCount × 0.1) × stealthFactor(composition).
 * shipCount delegates to the locked fleetCompositionSize helper; future
 * stealth modifiers scale the result down via the stealthFactor hook (today
 * 1.0). Counts must be non-negative integers (RangeError otherwise).
 */
export function signatureOf(composition: FleetComposition): number {
  const size = fleetCompositionSize(composition)
  return (SIGNATURE_BASE + size * SIGNATURE_PER_SHIP) * stealthFactor(composition)
}

/**
 * The draft detection gate: is the emitter detected by the sensor? Detected
 * exactly when the target is not cloaked AND its distance is within the
 * sensor range. A cloaked target is never detected regardless of range
 * (reason 'cloaked'); otherwise the reason is 'in-range' when detected and
 * 'out-of-range' when not. margin = range − distance (negative when out of
 * range, 0 exactly at range). signature is echoed as the context for a future
 * emission roll — the draft gates on range only. Validation: sensorRangePc
 * and signature must be finite > 0, distancePc finite >= 0 (RangeError
 * otherwise).
 */
export function detectionOutcome(input: DetectionInput): DetectionOutcome {
  const { sensorRangePc, signature, distancePc, cloaked } = input
  assertFinitePositive(sensorRangePc, 'sensorRangePc')
  assertFinitePositive(signature, 'signature')
  assertFiniteNonNegative(distancePc, 'distancePc')

  const isCloaked = cloaked === true
  const detected = !isCloaked && distancePc <= sensorRangePc

  let reason: DetectionReason
  if (isCloaked) {
    reason = 'cloaked'
  } else if (detected) {
    reason = 'in-range'
  } else {
    reason = 'out-of-range'
  }

  return {
    detected,
    rangePc: sensorRangePc,
    signature,
    marginPc: sensorRangePc - distancePc,
    reason,
  }
}

/**
 * The COUNTER-INTELLIGENCE hook: a scout's effective detection profile once
 * counter-intel applies. effectiveRangePc is unchanged (placeholder — the
 * real counter-intel range model is P7/P9). effectiveDetection: a scout
 * already spotted exercises no additional detection roll — its effective
 * detection is its profile detectionChance; a scout that remains unspotted
 * keeps the reduced COUNTER_INTEL_UNDETECTED_FACTOR × detectionChance (draft).
 * Validation: sensorRangePc finite > 0 and detectionChance finite >= 0
 * (RangeError otherwise).
 */
export function counterIntel(
  profile: ScoutProfile,
  detected: boolean,
): { effectiveRangePc: number; effectiveDetection: number } {
  assertFinitePositive(profile.sensorRangePc, 'profile.sensorRangePc')
  assertFiniteNonNegative(profile.detectionChance, 'profile.detectionChance')
  const effectiveDetection = detected
    ? profile.detectionChance
    : COUNTER_INTEL_UNDETECTED_FACTOR * profile.detectionChance
  return {
    effectiveRangePc: profile.sensorRangePc,
    effectiveDetection,
  }
}
