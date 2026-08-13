/**
 * Intel level model (P6-T02): the scouting QUALITY ladder — how deep the
 * intelligence about a target object is, not how fresh (freshness is P6-T06).
 *
 * SOURCE OF LEVEL NAMES: the master roadmap's P6-T02 subtask list (observed,
 * scanned, scouted, deep recon, full intelligence) plus the 'none' baseline
 * every target starts at. The early 'probed' draft name is NOT a roadmap
 * name, so the ladder below uses the roadmap's exact set. Locked order:
 *
 *   none < observed < scanned < scouted < deep recon < full intelligence
 *
 *   - none              — nothing known about the target.
 *   - observed          — a passive fly-by: presence + class.
 *   - scanned           — a sensor sweep: structures + defenses.
 *   - scouted           — an active scout visit: fleet presence + composition.
 *   - deep recon        — a deep scan: fleet activity + defense detail.
 *   - full intelligence — the complete picture: population, resources,
 *                         production, construction activity.
 *
 * COVERAGE SEMANTICS: the roadmap's "field-by-field reveal rules" subtask
 * surfaces here as coverageFor's per-level headline; the exact per-field
 * reveal wiring is P6-T05's Intel Reports (out of scope).
 *
 * PROMOTION RULE (locked): intel levels never decrease through promotion —
 * promoteIntel is a max over the rank ladder, so re-scouting a target only
 * ever raises (or keeps) its level. Age-based decay (a report growing stale,
 * a level dropping) is P6-T06's concern, deferred here; the model exposes
 * the hooks T06 needs: levelFromInfoState (stale → observed) and
 * TargetIntel.lastUpdatedAt (the last-report timestamp).
 *
 * HUD INTEROP (P6-T09): levelFromInfoState maps ui/info's InfoState onto the
 * quality ladder so the HUD's UNKNOWN / ESTIMATED / STALE / VERIFIED states
 * can derive a display level:
 *   unknown   → none
 *   estimated → scanned
 *   stale     → observed
 *   verified  → full intelligence
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no time-source
 * reads, no I/O. Identical inputs always produce identical (deep-equal)
 * output, and caller-provided objects are never mutated. The exported
 * tables hold only primitives, so Object.freeze is total (deep) here.
 */

import { assertIntelLevel } from './intel-ui'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'
import type { InfoState } from '../ui/info'

/** The scouting quality ladder: how deep the intelligence about a target is.
 * 'none' is the baseline every target starts at. */
export type IntelLevel =
  | 'none'
  | 'observed'
  | 'scanned'
  | 'scouted'
  | 'deep recon'
  | 'full intelligence'

/** The ladder in ascending order (the roadmap's T02 names plus 'none'). */
export const INTEL_LEVELS: readonly IntelLevel[] = Object.freeze([
  'none',
  'observed',
  'scanned',
  'scouted',
  'deep recon',
  'full intelligence',
])

/**
 * Rank per level: none 0 < observed 1 < scanned 2 < scouted 3 <
 * deep recon 4 < full intelligence 5. Values are primitives, so
 * Object.freeze leaves the record fully immutable.
 */
export const INTEL_LEVEL_RANK: Readonly<Record<IntelLevel, number>> = Object.freeze({
  none: 0,
  observed: 1,
  scanned: 2,
  scouted: 3,
  'deep recon': 4,
  'full intelligence': 5,
})

/** The per-target intel record: quality level, last-report timestamp, and
 * the deterministic source ids that produced the reports (scout mission
 * ids — fnv1a strings; P6-T04 wires them). */
export interface TargetIntel {
  targetId: string
  level: IntelLevel
  lastUpdatedAt: number | null
  sources: readonly string[]
}

const INFO_STATES: readonly InfoState[] = Object.freeze([
  'unknown',
  'estimated',
  'stale',
  'verified',
])

export function isIntelLevel(value: unknown): value is IntelLevel {
  return (INTEL_LEVELS as readonly unknown[]).includes(value)
}

function isInfoState(value: unknown): value is InfoState {
  return (INFO_STATES as readonly unknown[]).includes(value)
}

function assertInfoState(value: unknown, name: string): asserts value is InfoState {
  if (!isInfoState(value)) {
    throw new RangeError(
      `${name} must be one of ${INFO_STATES.join(', ')}, got ${JSON.stringify(value)}`,
    )
  }
}

/**
 * The greater of two levels by rank (max semantics). Equal levels resolve to
 * `a`. Deterministic — a pure rank comparison over the locked ladder.
 */
export function higher(a: IntelLevel, b: IntelLevel): IntelLevel {
  assertIntelLevel(a)
  assertIntelLevel(b)
  return INTEL_LEVEL_RANK[a] >= INTEL_LEVEL_RANK[b] ? a : b
}

/**
 * The promotion rule: the resulting level is max(current, gained). Levels
 * NEVER decrease through promotion — recording lower-quality intel leaves
 * the current level untouched. Age-based decay is P6-T06's concern.
 */
export function promoteIntel(current: IntelLevel, gained: IntelLevel): IntelLevel {
  assertIntelLevel(current)
  assertIntelLevel(gained)
  return higher(current, gained)
}

/**
 * Record one intel report for a target. Immutable: the input TargetIntel is
 * never mutated; the result is a fresh object whose level is
 * promoteIntel(current, gained), whose lastUpdatedAt is the input `at`
 * (validated positive finite), and whose sources are the previous sources
 * plus `source` (deduped — a repeated source string is not added twice).
 * Validation: targetId and source non-empty, both levels valid, `at`
 * positive finite; violations throw a RangeError.
 */
export function recordIntel(
  target: TargetIntel,
  input: { level: IntelLevel; at: number; source: string },
): TargetIntel {
  const targetId = assertNonEmptyString(target.targetId, 'targetId')
  assertIntelLevel(target.level)
  assertIntelLevel(input.level)
  assertPositiveAt(input.at)
  const source = assertNonEmptyString(input.source, 'source')
  const sources = target.sources.includes(source)
    ? [...target.sources]
    : [...target.sources, source]
  return {
    targetId,
    level: promoteIntel(target.level, input.level),
    lastUpdatedAt: input.at,
    sources,
  }
}

/**
 * The locked coverage description for a level (the roadmap's coverage
 * semantics). Deterministic — one string per level, documented above.
 */
export function coverageFor(level: IntelLevel): string {
  assertIntelLevel(level)
  switch (level) {
    case 'none':
      return 'Nothing known'
    case 'observed':
      return 'Observed: presence + class'
    case 'scanned':
      return 'Scanned: structures + defenses'
    case 'scouted':
      return 'Scouted: fleet presence + composition'
    case 'deep recon':
      return 'Deep recon: fleet activity + defense detail'
    case 'full intelligence':
      return 'Full intelligence: population, resources, production, construction'
  }
}

/**
 * The HUD-INTEROP hook (P6-T09): map an InfoState onto the quality ladder.
 * unknown → none, estimated → scanned, stale → observed, verified → full
 * intelligence. T06 refines staleness handling on top of this mapping.
 */
export function levelFromInfoState(state: InfoState): IntelLevel {
  assertInfoState(state, 'state')
  switch (state) {
    case 'unknown':
      return 'none'
    case 'estimated':
      return 'scanned'
    case 'stale':
      return 'observed'
    case 'verified':
      return 'full intelligence'
  }
}
