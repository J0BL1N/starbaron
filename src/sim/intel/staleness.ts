/**
 * Intel STALENESS (P6-T06) — the decay model: how scouting intelligence ages,
 * and what age does to the stored level. The quality ladder (P6-T02) says how
 * DEEP a report is; this module says how OLD it is.
 *
 * THE AGE: age = (at − lastUpdatedAt) / 1000 (seconds). `at` is always an
 * INPUT — this module never consults a time source. lastUpdatedAt is the
 * last-report timestamp recordIntel (P6-T02) stamps; null means the target
 * was NEVER updated, which the model treats as fully expired.
 *
 * THE FRESHNESS LADDER — three thresholds, four states. The draft 168h
 * EXPIRED_AFTER_SECONDS constant from the task brief is DROPPED as redundant:
 * expiry IS the stale window, so the four states are fully defined by three
 * boundaries:
 *   age <   6h (FRESH_WINDOW_SECONDS) → 'fresh'   — current, fully trusted
 *   age <  24h (AGING_WINDOW_SECONDS) → 'aging'   — degrading, one rung down
 *   age <  72h (STALE_WINDOW_SECONDS) → 'stale'   — out of date, two rungs down
 *   age >= 72h (STALE_WINDOW_SECONDS) → 'expired' — the store DROPS the record
 * Every exact boundary lands on the OLDER state: exactly 6h is 'aging',
 * exactly 24h is 'stale', exactly 72h is 'expired' (the comparison is age <
 * window). The windows are BALANCE-HARNESS INPUT (a tuning surface, not a
 * locked design constant); the T08 backend schedules the decay job against
 * them.
 *
 * THE DECAY POLICY (decayedLevel): the PvP model never shows data better than
 * the current freshness warrants — an aging report reads one ladder rung
 * lower, a stale report two rungs lower, an expired report 'none'. Decay is
 * monotone DOWN the ladder (promotion is the only direction up) and clamps at
 * 'none'.
 *
 * THE STORE UPDATE (applyDecay): the immutable per-target decay pass. An
 * expired record returns null — the store drops it. Every other record is a
 * fresh object with the level UNCHANGED and the SAME lastUpdatedAt. Decay is
 * a READ PROJECTION ONLY: the stored level is the raw/promoted level (P6-T02),
 * and the rung subtraction is computed on READ via decayedLevel at `at` — so
 * running the decay job repeatedly never compounds the rung subtraction.
 * applyDecay never resets the timestamp, so the age keeps counting; only a
 * fresh report (recordIntel) resets it.
 *
 * RE-SCOUT HOOK (needsRescout): true once the report leaves the trusted band —
 * stale or expired, i.e. age at or beyond the aging window (24h). The prompt
 * fires before the record is dropped at the stale window (72h), so the player
 * can refresh the report in time.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state (every table holds
 * primitives, so Object.freeze is total), no time-source reads, no I/O.
 * Identical inputs always produce identical (deep-equal) output, and
 * caller-provided objects are never mutated.
 */

import { INTEL_LEVELS, INTEL_LEVEL_RANK, isIntelLevel } from './levels'
import type { IntelLevel, TargetIntel } from './levels'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'

/** The freshness ladder: how old a report is. See the module docstring. */
export type Freshness = 'fresh' | 'aging' | 'stale' | 'expired'

/** The fresh window: below this age a report is fully trusted (6h). */
export const FRESH_WINDOW_SECONDS = 6 * 60 * 60

/** The aging window: below this age a report is one rung down (24h). */
export const AGING_WINDOW_SECONDS = 24 * 60 * 60

/** The stale window: at or beyond this age a report is expired (72h). */
export const STALE_WINDOW_SECONDS = 72 * 60 * 60

/** Ladder rungs each non-expired freshness state strips from the stored level.
 * Values are primitives, so Object.freeze is total. */
const RUNGS: Readonly<Record<Exclude<Freshness, 'expired'>, number>> = Object.freeze({
  fresh: 0,
  aging: 1,
  stale: 2,
})

function assertIntelLevel(value: unknown, name: string): asserts value is IntelLevel {
  if (!isIntelLevel(value)) {
    throw new RangeError(
      `${name} must be one of ${INTEL_LEVELS.join(', ')}, got ${JSON.stringify(value)}`,
    )
  }
}

/**
 * The freshness of a target's intel at time `at`. age = (at − lastUpdatedAt)
 * / 1000; a null lastUpdatedAt (never updated) is 'expired'. Boundaries land
 * on the older state: age < fresh window → 'fresh'; age < aging window →
 * 'aging'; age < stale window → 'stale'; otherwise 'expired'. Validation:
 * the level must be a known intel level and `at` positive finite
 * (assertPositiveAt) — violations throw a RangeError.
 */
export function freshnessFor(intel: TargetIntel, at: number): Freshness {
  assertIntelLevel(intel.level, 'intel.level')
  assertPositiveAt(at)
  if (intel.lastUpdatedAt === null) {
    return 'expired'
  }
  const ageSeconds = (at - intel.lastUpdatedAt) / 1000
  if (ageSeconds < FRESH_WINDOW_SECONDS) {
    return 'fresh'
  }
  if (ageSeconds < AGING_WINDOW_SECONDS) {
    return 'aging'
  }
  if (ageSeconds < STALE_WINDOW_SECONDS) {
    return 'stale'
  }
  return 'expired'
}

/**
 * The decayed level for a target's intel at time `at`: fresh → the stored
 * level unchanged; aging → one ladder rung down (clamped at 'none'); stale →
 * two rungs down; expired → 'none'. The PvP model never shows data better
 * than the current freshness warrants. Deterministic and monotone down the
 * ladder; validation matches freshnessFor (RangeError).
 */
export function decayedLevel(intel: TargetIntel, at: number): IntelLevel {
  const freshness = freshnessFor(intel, at)
  if (freshness === 'expired') {
    return 'none'
  }
  const rank = Math.max(0, INTEL_LEVEL_RANK[intel.level] - RUNGS[freshness])
  return INTEL_LEVELS[rank]
}

/**
 * The re-scout prompt hook: true when the intel is stale or expired — age at
 * or beyond the aging window (24h), a never-updated target included; the
 * prompt fires before the record is dropped at the stale window (72h). False
 * for fresh and aging reports. Validation matches freshnessFor (RangeError).
 */
export function needsRescout(intel: TargetIntel, at: number): boolean {
  const freshness = freshnessFor(intel, at)
  return freshness === 'stale' || freshness === 'expired'
}

/**
 * The immutable per-target decay pass. An expired record (age at or beyond
 * the stale window, or never updated) returns null — the store drops it. Every
 * other record is a fresh TargetIntel with the level UNCHANGED (decay is a
 * read projection — the rung subtraction is computed on READ by decayedLevel
 * at `at`, never written back), the SAME lastUpdatedAt (decay never resets
 * the timestamp; only recordIntel does) and a fresh copy of the sources list.
 * Validation: targetId non-empty, level a known intel level, `at` positive
 * finite (RangeError on violation). The input record is never mutated.
 */
export function applyDecay(intel: TargetIntel, at: number): TargetIntel | null {
  const targetId = assertNonEmptyString(intel.targetId, 'targetId')
  assertIntelLevel(intel.level, 'intel.level')
  assertPositiveAt(at)
  if (freshnessFor(intel, at) === 'expired') {
    return null
  }
  return {
    targetId,
    level: intel.level,
    lastUpdatedAt: intel.lastUpdatedAt,
    sources: [...intel.sources],
  }
}

/** Display rule: first letter uppercased, the rest untouched ('fresh' → 'Fresh'). */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** Compact deterministic age label: seconds / minutes / hours / days, floored.
 * A negative age (an `at` before lastUpdatedAt) clamps to '0s'. */
function ageLabel(ageSeconds: number): string {
  const clamped = Math.max(0, ageSeconds)
  if (clamped < 60) {
    return `${Math.floor(clamped)}s`
  }
  if (clamped < 60 * 60) {
    return `${Math.floor(clamped / 60)}m`
  }
  if (clamped < 24 * 60 * 60) {
    return `${Math.floor(clamped / 3600)}h`
  }
  return `${Math.floor(clamped / (24 * 60 * 60))}d`
}

/**
 * Deterministic one-line display summary. An expired report (or a never
 * updated one) is 'Expired — rescout needed'; otherwise
 * '<Freshness> · <level> · updated <age label> ago' — the freshness word is
 * capitalised for display and the age label uses fixed s/m/h/d units.
 * Validation matches freshnessFor (RangeError).
 */
export function stalenessSummary(intel: TargetIntel, at: number): string {
  const freshness = freshnessFor(intel, at)
  if (intel.lastUpdatedAt === null || freshness === 'expired') {
    return 'Expired — rescout needed'
  }
  const ageSeconds = (at - intel.lastUpdatedAt) / 1000
  return `${capitalize(freshness)} · ${intel.level} · updated ${ageLabel(ageSeconds)} ago`
}
