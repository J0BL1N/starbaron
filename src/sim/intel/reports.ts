/**
 * Intel REPORTS (P6-T05) — the report contract: the observer player, the
 * target object, the observation timestamp, and the field-by-field reveal
 * the intel level unlocks (REVEAL_MATRIX), plus report generation with
 * deterministic ids and the target-scoped report list projection.
 *
 * SCOPE: report GENERATION and the pure reveal projection only. Report
 * DELIVERY and STORAGE are the backend's concern (T08). This module never
 * consults a time source — every timestamp is an INPUT — and exposes no
 * mutating API.
 *
 * THE REPORT (IntelReport): one immutable snapshot of what an observer
 * learned about a target at one moment. The id is the deterministic fnv1a
 * formula over the observer, the target id and the timestamp, so an
 * identical observation always yields the identical id — the dedup hook a
 * store uses. `source` names the origin of the report (a scout mission id
 * when T04's recordMissionIntel wires it in; a documented default
 * otherwise).
 *
 * THE REVEAL MATRIX (the single mapping table — the roadmap's intel ladder
 * onto the info contract's levels):
 *   none              → no fields (a 'none' report reveals nothing)
 *   observed          → public   (presence + class: identity + spatial facts)
 *   scanned           → alliance (the contract's first non-public tier: the
 *                                 owner-lite identity/type/class detail plus
 *                                 the owner's alliance-held facts)
 *   scouted           → intel    (the scouting tier: defenses + fleet
 *                                 presence + composition)
 *   deep recon        → intel    (the info contract carries ONE scouting
 *                                 tier, so deep recon resolves to the same
 *                                 tier as scouted; the 'fleet activity +
 *                                 defense detail' depth lives in the report
 *                                 VALUES, not in a separate reveal level)
 *   full intelligence → owner    (the complete picture: population,
 *                                 structures, income, plus everything below,
 *                                 incl. fleet activity)
 *
 * The mapping is monotonic — a deeper intel level never hides a field an
 * earlier level revealed. `buildIntelReport` DELEGATES the field projection
 * to ui/info.projectInfo with viewerLevel = the mapped info level, so the
 * reveal keeps the info contract's field order, number formatting and
 * unknown/stale state rules.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state (the exported matrix
 * holds primitives only, so Object.freeze is total), no time-source reads,
 * no I/O. Identical inputs always produce identical (deep-equal) output,
 * and caller-provided objects are never mutated.
 */

import { contractFor, INFO_KINDS, projectInfo } from '../ui/info'
import { INTEL_LEVELS, isIntelLevel } from './levels'
import { fnv1a } from '../planets/hash'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'
import type { InfoField, InfoKind, InfoLevel } from '../ui/info'
import type { IntelLevel } from './levels'

/** The report's target object reference: the info-contract kind + id. */
export interface IntelReportTargetRef {
  kind: InfoKind
  id: string
}

/** One intel report: observer, target, timestamp, revealed fields, source. */
export interface IntelReport {
  id: string
  observerId: string
  targetRef: IntelReportTargetRef
  targetName: string
  intelLevel: IntelLevel
  observedAt: number
  revealedFields: InfoField[]
  source: string
}

export interface BuildIntelReportInput {
  observerId: string
  targetRef: IntelReportTargetRef
  targetName: string
  intelLevel: IntelLevel
  observedAt: number
  fields: ReadonlyMap<string, string | number | null>
  staleness?: ReadonlyMap<string, boolean>
  source?: string
}

/**
 * The locked reveal matrix: each intel ladder rung above 'none' opens the
 * info-contract tier named as its permitted level. Deep-frozen — the values
 * are primitives, so Object.freeze is total (deep). See the module docstring
 * for the per-rung rationale.
 */
export const REVEAL_MATRIX: Readonly<
  Record<Exclude<IntelLevel, 'none'>, InfoLevel>
> = Object.freeze({
  observed: 'public',
  scanned: 'alliance',
  scouted: 'intel',
  'deep recon': 'intel',
  'full intelligence': 'owner',
})

/** The documented default report source, used when `source` is omitted. */
export const DEFAULT_REPORT_SOURCE = 'scout-report'

function assertIntelLevel(value: unknown, name: string): asserts value is IntelLevel {
  if (!isIntelLevel(value)) {
    throw new RangeError(
      `${name} must be one of ${INTEL_LEVELS.join(', ')}, got ${JSON.stringify(value)}`,
    )
  }
}

function isInfoKind(value: unknown): value is InfoKind {
  return (INFO_KINDS as readonly string[]).includes(value as string)
}

/**
 * Report generation. Validation (each throws a RangeError): observerId,
 * targetRef.id, targetName and an explicit source must be non-empty;
 * targetRef.kind must be a known info kind (delegated to contractFor);
 * intelLevel must be a known intel level; observedAt must be positive
 * finite (assertPositiveAt). The id is the deterministic formula
 * fnv1a(`${observerId}|${targetRef.id}|${observedAt}`).toString(16).
 * revealedFields is the reveal the intel level unlocks: for a 'none' level
 * no fields are revealed; otherwise the projection DELEGATES to
 * ui/info.projectInfo with viewerLevel = REVEAL_MATRIX[intelLevel], the
 * caller's fields map and (when given) the staleness map — so a missing or
 * null value projects to state 'unknown', a stale key to 'stale', and the
 * info contract's number formatting is applied. An omitted source defaults
 * to DEFAULT_REPORT_SOURCE. The input is never mutated; the targetRef is
 * copied.
 */
export function buildIntelReport(input: BuildIntelReportInput): IntelReport {
  const observerId = assertNonEmptyString(input.observerId, 'observerId')
  const targetId = assertNonEmptyString(input.targetRef.id, 'targetRef.id')
  const targetName = assertNonEmptyString(input.targetName, 'targetName')
  assertIntelLevel(input.intelLevel, 'intelLevel')
  assertPositiveAt(input.observedAt)
  const source =
    input.source === undefined
      ? DEFAULT_REPORT_SOURCE
      : assertNonEmptyString(input.source, 'source')
  const contract = contractFor(input.targetRef.kind)
  const id = fnv1a(`${observerId}|${targetId}|${input.observedAt}`).toString(16)
  const revealedFields =
    input.intelLevel === 'none'
      ? []
      : projectInfo({
          contract,
          values: input.fields,
          viewerLevel: REVEAL_MATRIX[input.intelLevel],
          staleness: input.staleness ?? new Map<string, boolean>(),
        })
  return {
    id,
    observerId,
    targetRef: { kind: input.targetRef.kind, id: targetId },
    targetName,
    intelLevel: input.intelLevel,
    observedAt: input.observedAt,
    revealedFields,
    source,
  }
}

/**
 * Structural invariants of an IntelReport, returned as a problem list (never
 * throws). Each check adds a human-readable problem string: id matches the
 * deterministic formula; observerId, targetRef.id, targetName and source are
 * non-empty; targetRef.kind is a known info kind; intelLevel is a known
 * level; observedAt is positive finite; revealedFields carries unique keys
 * and every key belongs to the target kind's contract field set (the
 * contract check runs only when the kind is known).
 */
export function reportInvariants(r: IntelReport): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []
  const expectedId = fnv1a(
    `${r.observerId}|${r.targetRef.id}|${r.observedAt}`,
  ).toString(16)
  if (r.id !== expectedId) {
    problems.push(
      `id ${JSON.stringify(r.id)} does not match the deterministic formula ${expectedId}`,
    )
  }
  if (r.observerId.trim() === '') {
    problems.push('observerId must be a non-empty string')
  }
  if (r.targetRef.id.trim() === '') {
    problems.push('targetRef.id must be a non-empty string')
  }
  if (!isInfoKind(r.targetRef.kind)) {
    problems.push(
      `targetRef.kind must be one of ${INFO_KINDS.join(', ')}, got ${JSON.stringify(r.targetRef.kind)}`,
    )
  }
  if (r.targetName.trim() === '') {
    problems.push('targetName must be a non-empty string')
  }
  if (!isIntelLevel(r.intelLevel)) {
    problems.push(
      `intelLevel must be one of ${INTEL_LEVELS.join(', ')}, got ${JSON.stringify(r.intelLevel)}`,
    )
  }
  if (!Number.isFinite(r.observedAt) || r.observedAt <= 0) {
    problems.push('observedAt must be a positive finite number')
  }
  if (r.source.trim() === '') {
    problems.push('source must be a non-empty string')
  }
  const seen = new Set<string>()
  for (const field of r.revealedFields) {
    if (seen.has(field.key)) {
      problems.push(`duplicate revealed field key ${JSON.stringify(field.key)}`)
    }
    seen.add(field.key)
  }
  if (isInfoKind(r.targetRef.kind)) {
    const contractKeys = new Set(
      contractFor(r.targetRef.kind).fields.map((field) => field.key),
    )
    for (const field of r.revealedFields) {
      if (!contractKeys.has(field.key)) {
        problems.push(
          `revealed field key ${JSON.stringify(field.key)} is not in the ${r.targetRef.kind} contract`,
        )
      }
    }
  }
  return { ok: problems.length === 0, problems }
}

/**
 * The observer's report list for one target, NEWEST first: observedAt
 * descending, ties broken by ascending id (deterministic code-unit order,
 * no environment-dependent string comparison). `at` must be positive finite
 * (assertPositiveAt) and targetId non-empty. Returns a fresh array; the
 * input list is never mutated and reports for other targets are excluded.
 */
export function reportsForTarget(
  reports: readonly IntelReport[],
  targetId: string,
  at: number,
): IntelReport[] {
  assertPositiveAt(at)
  const target = assertNonEmptyString(targetId, 'targetId')
  return reports
    .filter((report) => report.targetRef.id === target)
    .sort((a, b) => {
      if (a.observedAt !== b.observedAt) {
        return b.observedAt - a.observedAt
      }
      if (a.id < b.id) {
        return -1
      }
      if (a.id > b.id) {
        return 1
      }
      return 0
    })
}
