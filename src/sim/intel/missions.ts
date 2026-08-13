/**
 * Scout MISSIONS (P6-T04) — the mission model: the launch → travel → arrival →
 * scan → report lifecycle for a fleet's scout operation, the mission outcomes
 * (success / detected / destroyed), and the intel recording hook.
 *
 * SCOPE: this module models the mission STATE and the TIMING lifecycle. The
 * 'destroyed' outcome (a detected scout fleet lost to enemy action) is resolved
 * by P7 combat — this module carries the status in the union, projects it, and
 * rejects further transitions on a lost mission, but no combat is resolved
 * here. Intel-store merging is the CALLER's contract: recordMissionIntel
 * returns a TargetIntel DELTA that the caller feeds to recordIntel (P6-T02).
 *
 * DESIGN decisions (all documented; DESIGN.md has no scout-mission section):
 * - **Lifecycle (locked):** launched = issued; traveling = en route; scanning =
 *   arrived + the scan window; reported = intel recorded; destroyed = lost
 *   (P7 resolves detection/PvP); failed = aborted (preflight rejection or
 *   abortMission).
 * - **Stored vs projected status:** launchScoutMission stores 'launched'. The
 *   'traveling' and 'scanning' states are PROJECTED from the mission's timing
 *   by missionStatusAt (half-open windows, left-inclusive, matching routes.ts):
 *   at < launchAt → 'launched'/'pre-launch'; launchAt ≤ at < arrivalAt →
 *   'traveling'/'in-flight'; arrivalAt ≤ at < scanCompletesAt →
 *   'scanning'/'scanning'; at ≥ scanCompletesAt → 'reported'/'complete'.
 *   'destroyed'/'failed' short-circuit regardless of time ('lost'). The stored
 *   status field changes only via recordMissionIntel ('reported'), abortMission
 *   ('failed'), or the P7 combat caller ('destroyed').
 * - **Id:** `fnv1a(`${ownerId}|${fleetId}|${launchAt}|${targetRef.id}`).toString(16)`
 *   — deterministic, no time-source reads, mirrors orders.ts.
 * - **Fleet speed (delegated):** the default mission speed is the fleet's
 *   slowest-ship speed, DELEGATED to movement.fleetTravelTime (invert the
 *   travel time to recover the speed — that helper IS the fleet-speed model).
 *   An explicit `speedPcPerSec` overrides it.
 * - **Timing (delegated):** arrivalAt = movement.arrivalTime(launchAt,
 *   distancePc, speed) — the same overflow-safe `departureAt + duration × 1000`
 *   the travel legs use. scanCompletesAt = arrivalAt + SCAN_DURATION_SEC × 1000
 *   (SCAN_DURATION_SEC = 30 — the locked scan window, exported for the balance
 *   harness).
 * - **Record semantics:** recordMissionIntel reports only from the projected
 *   'scanning'/'reported' states (before arrival or on a lost mission it
 *   throws). It returns the mission (status 'reported', recordedLevel =
 *   promoteIntel) plus a TargetIntel DELTA — { targetId, level: gained,
 *   lastUpdatedAt: at, sources: [mission.id] } — that the caller merges via
 *   recordIntel (which promotes and de-dupes the source id). Re-recording is
 *   allowed only as a PROMOTION: a mission that has already recorded (its
 *   recordedLevel is no longer 'none') accepts a re-record only when `gained`
 *   is strictly higher than its recordedLevel; an equal or lower re-record
 *   throws an Error.
 * - **Intel ceiling (locked):** the mission PERSISTS the launch-derived
 *   maximum — maxIntelLevel, from scouts.maxIntelLevelForScouts over the
 *   scout complement (scouts alone cap at 'deep recon'; 'full intelligence'
 *   needs a probe or attack, P7). recordMissionIntel REJECTS a `gained` level
 *   above that ceiling (Error), so a scout mission can never write intel
 *   deeper than its complement can reach.
 * - **Error taxonomy:** malformed VALUES (ids, targetRef, timing, distance,
 *   speed, gained, composition shape) throw RangeError; semantic violations
 *   (no scouts at launch, recording too early, transitioning a terminal
 *   mission) throw Error.
 *
 * Pure module — deterministic, no time-source reads (every timestamp is an
 * INPUT), no nondeterministic APIs, no module-level mutable state (lookup
 * tables frozen), strictly typed.
 */

import { SHIP_CLASS_IDS } from '../fleet/ships'
import { arrivalTime, fleetTravelTime } from '../fleet/movement'
import { canScout, maxIntelLevelForScouts } from './scouts'
import { INTEL_LEVELS, INTEL_LEVEL_RANK, isIntelLevel, promoteIntel } from './levels'
import { fnv1a } from '../planets/hash'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'
import { assertFinitePositive } from './intel-ui'
import type { FleetComposition } from '../fleet/fleet'
import type { IntelLevel, TargetIntel } from './levels'

/** The scout mission lifecycle (locked union — see the module docstring). */
export type ScoutMissionStatus =
  | 'launched'
  | 'traveling'
  | 'scanning'
  | 'reported'
  | 'destroyed'
  | 'failed'

/** A mission target kind: a world body (planet/system/body) by id. */
export type ScoutMissionTargetKind = 'planet' | 'system' | 'body'

/** A scout mission target reference. */
export interface ScoutMissionTargetRef {
  kind: ScoutMissionTargetKind
  id: string
}

/** A scout mission: issue + timing fields + stored lifecycle status. */
export interface ScoutMission {
  id: string
  ownerId: string
  fleetId: string
  targetRef: ScoutMissionTargetRef
  launchAt: number
  arrivalAt: number
  scanCompletesAt: number
  status: ScoutMissionStatus
  recordedLevel: IntelLevel
  /** The launch-derived intel ceiling: the deepest level this mission's scout
   * complement can record (scouts.maxIntelLevelForScouts). */
  maxIntelLevel: IntelLevel
}

export interface LaunchScoutMissionInput {
  ownerId: string
  fleetId: string
  targetRef: ScoutMissionTargetRef
  launchAt: number
  composition: FleetComposition
  distancePc: number
  speedPcPerSec?: number
}

/** The point-in-time projection of a mission at a timestamp. */
export interface MissionStatusAt {
  status: ScoutMissionStatus
  progress: MissionProgress
}

/** The time-based progress label projected alongside the status. */
export type MissionProgress =
  | 'pre-launch'
  | 'in-flight'
  | 'scanning'
  | 'complete'
  | 'lost'

/** The scout mission status union as a deep-frozen lookup table (immutable). */
export const SCOUT_MISSION_STATUSES: readonly ScoutMissionStatus[] = Object.freeze([
  'launched',
  'traveling',
  'scanning',
  'reported',
  'destroyed',
  'failed',
])

/** The target kind union as a deep-frozen lookup table (immutable). */
export const SCOUT_MISSION_TARGET_KINDS: readonly ScoutMissionTargetKind[] =
  Object.freeze(['planet', 'system', 'body'])

/** The progress union as a deep-frozen lookup table (immutable). */
export const MISSION_PROGRESSES: readonly MissionProgress[] = Object.freeze([
  'pre-launch',
  'in-flight',
  'scanning',
  'complete',
  'lost',
])

/** The locked scan window: a scout mission reports within 30s of arrival. */
export const SCAN_DURATION_SEC = 30

function assertTargetRef(ref: ScoutMissionTargetRef): void {
  if (!(SCOUT_MISSION_TARGET_KINDS as readonly string[]).includes(ref.kind)) {
    throw new RangeError(
      `targetRef.kind must be 'planet'|'system'|'body', got ${String(ref.kind)}`,
    )
  }
  assertNonEmptyString(ref.id, 'targetRef.id')
}

function assertCompositionClasses(composition: FleetComposition): void {
  for (const key of Object.keys(composition)) {
    if (!(SHIP_CLASS_IDS as readonly string[]).includes(key)) {
      throw new RangeError(
        `composition contains an unknown ship class key ${JSON.stringify(key)}`,
      )
    }
  }
}

/**
 * Structural invariants of a ScoutMission (defensive — missions built by
 * launchScoutMission always satisfy these): ids non-empty; targetRef valid
 * (kind in the union, id non-empty); launchAt positive finite; arrivalAt finite
 * and strictly after launchAt; scanCompletesAt finite and strictly after
 * arrivalAt; status in the union; recordedLevel a known intel level;
 * maxIntelLevel a known intel level.
 */
function assertMissionShape(mission: ScoutMission): void {
  assertNonEmptyString(mission.id, 'mission.id')
  assertNonEmptyString(mission.ownerId, 'mission.ownerId')
  assertNonEmptyString(mission.fleetId, 'mission.fleetId')
  assertTargetRef(mission.targetRef)
  assertPositiveAt(mission.launchAt)
  if (!Number.isFinite(mission.arrivalAt) || mission.arrivalAt <= mission.launchAt) {
    throw new RangeError(
      `mission.arrivalAt (${mission.arrivalAt}) must be finite and strictly ` +
        `after launchAt (${mission.launchAt})`,
    )
  }
  if (
    !Number.isFinite(mission.scanCompletesAt) ||
    mission.scanCompletesAt <= mission.arrivalAt
  ) {
    throw new RangeError(
      `mission.scanCompletesAt (${mission.scanCompletesAt}) must be finite and ` +
        `strictly after arrivalAt (${mission.arrivalAt})`,
    )
  }
  if (!(SCOUT_MISSION_STATUSES as readonly string[]).includes(mission.status)) {
    throw new RangeError(
      `mission.status must be 'launched'|'traveling'|'scanning'|'reported'|` +
        `'destroyed'|'failed', got ${String(mission.status)}`,
    )
  }
  if (!isIntelLevel(mission.recordedLevel)) {
    throw new RangeError(
      `mission.recordedLevel must be one of ${INTEL_LEVELS.join(', ')}, got ` +
        `${JSON.stringify(mission.recordedLevel)}`,
    )
  }
  if (!isIntelLevel(mission.maxIntelLevel)) {
    throw new RangeError(
      `mission.maxIntelLevel must be one of ${INTEL_LEVELS.join(', ')}, got ` +
        `${JSON.stringify(mission.maxIntelLevel)}`,
    )
  }
}

/**
 * The fleet's effective scout-mission speed: DELEGATES to
 * movement.fleetTravelTime (the fleet-speed helper — slowest ship over classes
 * with a positive count) and inverts the travel time to recover the speed.
 * Only called after the canScout preflight, so the composition has at least one
 * scout and the travel time is a finite positive value.
 */
function fleetSpeedFor(composition: FleetComposition, distancePc: number): number {
  const travelTimeSec = fleetTravelTime(composition, distancePc)
  if (!Number.isFinite(travelTimeSec) || travelTimeSec <= 0) {
    throw new Error(
      `cannot derive fleet speed: fleetTravelTime returned ${travelTimeSec}s ` +
        `for ${distancePc}pc`,
    )
  }
  return distancePc / travelTimeSec
}

/**
 * Launches a scout mission. Preflight (each throws): ownerId/fleetId non-empty,
 * targetRef valid, launchAt positive finite (assertPositiveAt), distancePc
 * finite > 0, speedPcPerSec (when supplied) finite > 0, composition carries no
 * unknown class keys, and canScout(composition) — a fleet with no scouts is
 * rejected with an Error whose message carries the 'failed' reason. The mission
 * speed is the fleet's slowest-ship speed (delegated to
 * movement.fleetTravelTime) or the supplied speedPcPerSec override. arrivalAt =
 * movement.arrivalTime(launchAt, distancePc, speed) (overflow-safe — the
 * arrival must be finite and strictly after launch, so a zero-distance mission
 * is rejected); scanCompletesAt = arrivalAt + SCAN_DURATION_SEC × 1000. Id:
 * `fnv1a(`${ownerId}|${fleetId}|${launchAt}|${targetRef.id}`).toString(16)`.
 * Status 'launched', recordedLevel 'none', maxIntelLevel =
 * scouts.maxIntelLevelForScouts(composition.scout) — the launch-derived
 * ceiling recordMissionIntel enforces. Returns a fresh mission; the input is
 * never mutated and the targetRef is copied.
 */
export function launchScoutMission(input: LaunchScoutMissionInput): ScoutMission {
  const { ownerId, fleetId, targetRef, launchAt, composition, distancePc } = input

  assertNonEmptyString(ownerId, 'ownerId')
  assertNonEmptyString(fleetId, 'fleetId')
  assertTargetRef(targetRef)
  assertPositiveAt(launchAt)
  assertFinitePositive(distancePc, 'distancePc')
  if (input.speedPcPerSec !== undefined) {
    assertFinitePositive(input.speedPcPerSec, 'speedPcPerSec')
  }
  assertCompositionClasses(composition)
  if (!canScout(composition)) {
    throw new Error(
      `cannot launch scout mission: preflight failed — fleet ${fleetId} has ` +
        'no scouts',
    )
  }

  const speedPcPerSec =
    input.speedPcPerSec === undefined
      ? fleetSpeedFor(composition, distancePc)
      : input.speedPcPerSec
  const arrivalAt = arrivalTime(launchAt, distancePc, speedPcPerSec)
  const scanCompletesAt = arrivalAt + SCAN_DURATION_SEC * 1000
  if (!Number.isFinite(scanCompletesAt) || scanCompletesAt <= arrivalAt) {
    throw new RangeError(
      `scanCompletesAt (${scanCompletesAt}) must be finite and strictly after ` +
        `arrivalAt (${arrivalAt})`,
    )
  }

  const id = fnv1a(`${ownerId}|${fleetId}|${launchAt}|${targetRef.id}`).toString(16)

  return {
    id,
    ownerId,
    fleetId,
    targetRef: { ...targetRef },
    launchAt,
    arrivalAt,
    scanCompletesAt,
    status: 'launched',
    recordedLevel: 'none',
    maxIntelLevel: maxIntelLevelForScouts(composition.scout),
  }
}

/**
 * The point-in-time projection of a mission at `at` (`at` must be positive
 * finite — assertPositiveAt; the mission shape must be valid). Stored
 * 'destroyed'/'failed' short-circuit to their status with progress 'lost'
 * regardless of time. Otherwise the projection is pure time-based over the
 * half-open windows (left-inclusive, matching routes.ts): at < launchAt →
 * 'launched'/'pre-launch' (querying before launch is allowed); launchAt ≤ at <
 * arrivalAt → 'traveling'/'in-flight'; arrivalAt ≤ at < scanCompletesAt →
 * 'scanning'/'scanning'; at ≥ scanCompletesAt → 'reported'/'complete'. So
 * exactly at launchAt the mission has departed, exactly at arrivalAt it is
 * scanning, and exactly at scanCompletesAt it has reported.
 */
export function missionStatusAt(
  mission: ScoutMission,
  at: number,
): MissionStatusAt {
  assertPositiveAt(at)
  assertMissionShape(mission)
  if (mission.status === 'destroyed' || mission.status === 'failed') {
    return { status: mission.status, progress: 'lost' }
  }
  if (at < mission.launchAt) {
    return { status: 'launched', progress: 'pre-launch' }
  }
  if (at < mission.arrivalAt) {
    return { status: 'traveling', progress: 'in-flight' }
  }
  if (at < mission.scanCompletesAt) {
    return { status: 'scanning', progress: 'scanning' }
  }
  return { status: 'reported', progress: 'complete' }
}

/**
 * The REPORT step: records intel for a mission. Allowed only from the projected
 * 'scanning'/'reported' states — before arrival ('launched'/'traveling') or on
 * a lost mission ('destroyed'/'failed') it throws an Error. `gained` must be a
 * known intel level and `at` positive finite (RangeError otherwise). `gained`
 * above the mission's launch-derived ceiling (maxIntelLevel) is REJECTED with
 * a descriptive Error — a scout mission can never record intel deeper than
 * its scout complement can reach. Returns a fresh mission (status 'reported',
 * recordedLevel = promoteIntel(current, gained)) plus a TargetIntel DELTA —
 * { targetId: targetRef.id, level: gained, lastUpdatedAt: at,
 * sources: [mission.id] } — that the CALLER merges into its intel store via
 * recordIntel (which promotes against the stored level and de-dupes the
 * mission id source). Re-recording is allowed only as a PROMOTION: a mission
 * that has already recorded accepts a re-record only when `gained` is
 * strictly higher than its recordedLevel — an equal or lower re-record throws
 * an Error. The input mission is never mutated.
 */
export function recordMissionIntel(
  mission: ScoutMission,
  input: { gained: IntelLevel; at: number },
): { mission: ScoutMission; intel: TargetIntel } {
  assertMissionShape(mission)
  assertPositiveAt(input.at)
  if (!isIntelLevel(input.gained)) {
    throw new RangeError(
      `gained must be one of ${INTEL_LEVELS.join(', ')}, got ` +
        `${JSON.stringify(input.gained)}`,
    )
  }
  if (INTEL_LEVEL_RANK[input.gained] > INTEL_LEVEL_RANK[mission.maxIntelLevel]) {
    throw new Error(
      `cannot record intel for mission ${mission.id}: gained ${input.gained} ` +
        `exceeds the mission's max intel level ${mission.maxIntelLevel}`,
    )
  }
  const projected = missionStatusAt(mission, input.at)
  if (projected.status !== 'scanning' && projected.status !== 'reported') {
    throw new Error(
      `cannot record intel for mission ${mission.id}: only the scanning or ` +
        `reported states record, projected '${projected.status}' at ${input.at}`,
    )
  }
  if (
    mission.recordedLevel !== 'none' &&
    INTEL_LEVEL_RANK[input.gained] <= INTEL_LEVEL_RANK[mission.recordedLevel]
  ) {
    throw new Error(
      `cannot re-record intel for mission ${mission.id}: gained ${input.gained} ` +
        `must exceed the recorded level ${mission.recordedLevel}`,
    )
  }
  return {
    mission: {
      ...mission,
      status: 'reported',
      recordedLevel: promoteIntel(mission.recordedLevel, input.gained),
    },
    intel: {
      targetId: mission.targetRef.id,
      level: input.gained,
      lastUpdatedAt: input.at,
      sources: [mission.id],
    },
  }
}

/**
 * Aborts a mission: a stored 'launched', 'traveling' or 'scanning' mission
 * becomes 'failed', provided `at` still projects to an abortable state. A
 * stored terminal mission ('reported', 'destroyed', 'failed') cannot abort
 * (Error). After the stored-status guard, the projected lifecycle is checked:
 * missionStatusAt(mission, at) must be 'launched', 'traveling' or 'scanning' —
 * aborting at or after scanCompletesAt (projected 'reported', terminal) throws
 * an Error even when the stored status is 'launched'. `at` must be positive
 * finite (assertPositiveAt). Returns a fresh mission; the input is never
 * mutated.
 */
export function abortMission(mission: ScoutMission, at: number): ScoutMission {
  assertMissionShape(mission)
  assertPositiveAt(at)
  if (
    mission.status === 'reported' ||
    mission.status === 'destroyed' ||
    mission.status === 'failed'
  ) {
    throw new Error(
      `cannot abort mission ${mission.id}: only launched, traveling or ` +
        `scanning missions can abort, got '${mission.status}'`,
    )
  }
  const projected = missionStatusAt(mission, at)
  if (
    projected.status !== 'launched' &&
    projected.status !== 'traveling' &&
    projected.status !== 'scanning'
  ) {
    throw new Error(
      `cannot abort mission ${mission.id}: projected status ` +
        `'${projected.status}' at ${at} is terminal`,
    )
  }
  return { ...mission, status: 'failed' }
}
