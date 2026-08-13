/**
 * Shared intel helpers (P6 phase-audit round 2 + 4): the pure primitives the
 * P6 modules duplicated independently — the info-tier rank / highest-visible-
 * tier pair (previously local to pvp-gate.ts and hover-intel.ts), the floored
 * s/m/h/d age label (previously local to staleness.ts and hover-intel.ts),
 * and the two shared validators assertIntelLevel (previously local to
 * levels.ts, reports.ts and staleness.ts) and assertFinitePositive
 * (previously local to missions.ts and sensors.ts). All those modules now
 * import this one shared implementation.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state (the single rank table
 * holds primitives, so Object.freeze is total), no time-source reads, no I/O.
 * Identical inputs always produce identical (deep-equal) output, and
 * caller-provided objects are never mutated.
 */

import { INTEL_LEVELS, isIntelLevel } from './levels'
import type { InfoLevel } from '../ui/info'
import type { IntelLevel } from './levels'

/** The info-tier rank: public 0 < alliance 1 < intel 2 < owner 3. Values are
 * primitives, so Object.freeze is total. */
const INFO_LEVEL_RANK: Readonly<Record<InfoLevel, number>> = Object.freeze({
  public: 0,
  alliance: 1,
  intel: 2,
  owner: 3,
})

/** The rank of an info tier — the numeric order tier comparisons run on. */
export function infoLevelRank(level: InfoLevel): number {
  return INFO_LEVEL_RANK[level]
}

/** The highest info tier present in a level list — the relationship behind a
 * non-intel view (the view itself carries no tier field). An empty list reads
 * as 'public' (the baseline tier). Deterministic: a pure rank maximum. */
export function highestVisibleTier(levels: readonly InfoLevel[]): InfoLevel {
  let best: InfoLevel = 'public'
  for (const level of levels) {
    if (infoLevelRank(level) > infoLevelRank(best)) {
      best = level
    }
  }
  return best
}

/** Compact deterministic age label: seconds / minutes / hours / days, floored.
 * A negative age (an `at` before the update moment) clamps to '0s'. */
export function flooredAgeLabel(ageSeconds: number): string {
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

/** The shared intel-level membership assertion: throws a RangeError listing the
 * locked ladder when `value` is not a known IntelLevel, else narrows it. */
export function assertIntelLevel(value: unknown): asserts value is IntelLevel {
  if (!isIntelLevel(value)) {
    throw new RangeError(
      `must be one of ${INTEL_LEVELS.join(', ')}, got ${JSON.stringify(value)}`,
    )
  }
}

/** The shared finite-positive-number assertion: throws a RangeError naming the
 * offending field when `value` is not a finite number > 0. */
export function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${label} must be a finite number > 0, got ${value}`,
    )
  }
}
