/**
 * PvP-gated hover HUD integration (P6-T09): a hover tooltip for ANOTHER
 * player's objects routes through the intel gate. This module is the PURE
 * integration contract that composes the P4 hover projection with the P6
 * gate; the tooltip RENDERING is the UI's concern and lives elsewhere.
 *
 * COMPOSE CONTRACT (hoverIntelInfo): for one hover target, base =
 * hoverInfoFor at a viewer level chosen from the gate's decision and gated =
 * pvpGatedView for the SAME target (the gate is AUTHORITATIVE):
 *   - gated.blocked → the tooltip shows the base's public-safe subset — the
 *     base hover built at viewer level 'public' (ownedBy null, public stats
 *     only; the gate decides nothing beyond that is usable). intelLine null,
 *     blocked carries the gate's reason, shownFromIntel false.
 *   - gated.shownFromIntel → intelLine carries the deterministic intel status
 *     line; the base's STATS are REPLACED by the gate's visible fields mapped
 *     onto the hover shape (one HoverStat per InfoField: label from the info
 *     contract, value as the gate projected it — a field with no value
 *     renders 'Unknown'); ownedBy is forced null for a stranger;
 *     title/subtitle/summary carry over from the base (public identity plus
 *     the public primary stat).
 *   - owner / alliance / public → the plain hover, unchanged, with no intel
 *     line (the owner hover is byte-identical to the P4 hover).
 *
 * BASE VIEWER LEVEL: 'public' when the gate blocks; otherwise the gate's
 * reveal tier for an intel view (REVEAL_MATRIX maps the decayed level onto
 * the info ladder; a decayed-to-none view reads 'public'); otherwise the
 * relationship tier recovered from the visible fields' highest level.
 *
 * INTEL STATUS LINE: '<headline> · <freshness> · updated <age> ago'. The
 * headline derives from coverageFor(level): the text before the colon plus
 * ' intel' ('Scouted: fleet presence + composition' → 'Scouted intel'; a lead
 * that already carries the word, 'Full intelligence', is not suffixed; a
 * decayed-to-none view reads 'No intel'). Freshness is the staleness state;
 * the age uses fixed s/m/h/d units, floored. The line reports the STORED
 * intel level (not the decayed reveal), matching stalenessSummary's display
 * convention and the pinned example 'Scouted intel · aging · updated 3h ago'.
 *
 * INTEGRITY: hoverIntelInfo requires target.id === targetContext.targetId, so
 * the gate always evaluates the SAME object the hover names — a mismatched
 * ownership context could otherwise project a different object's picture.
 *
 * MISSES: hoverIntelInfo returns null when the target does not resolve against
 * the universe, mirroring hoverInfoFor's hide-the-tooltip-on-miss contract.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state (the single frozen
 * rank table holds primitives), no time-source reads (every timestamp is an
 * INPUT), no I/O. Identical inputs always produce identical deep-equal
 * output, and caller-provided objects are never mutated.
 */

import { pvpGatedView } from '../intel/pvp-gate'
import type { GatedView } from '../intel/pvp-gate'
import type { TargetContext, ViewerContext } from '../intel/permissions'
import { coverageFor } from '../intel/levels'
import type { IntelLevel, TargetIntel } from '../intel/levels'
import { freshnessFor } from '../intel/staleness'
import type { Freshness } from '../intel/staleness'
import { REVEAL_MATRIX } from '../intel/reports'
import { hoverInfoFor } from './hover'
import type { HoverInfo, HoverStat, HoverTarget } from './hover'
import type { InfoField, InfoLevel } from './info'
import { assertPositiveAt } from './validate'
import type { UniverseState } from '../world/reconstruct'

/** The composed PvP-gated hover tooltip payload. `blocked` is null exactly
 * when the tooltip is shown; when non-null it carries the gate's reason
 * ('no-intel' | 'expired-intel'). `intelLine` is null when the hover is not
 * intel-sourced. */
export interface IntelHoverInfo {
  base: HoverInfo
  intelLine: string | null
  blocked: string | null
  shownFromIntel: boolean
}

/** The hover-intel integration input: the P4 hover target plus the P6 gate's
 * viewer/target/intel inputs for the SAME object. `contractFields` is the
 * target's contract field set and `values` the value map the gate projects
 * over — both are SUPPLIED by the caller (this module composes the gated
 * hover; it never queries the world or the info contract itself). */
export interface HoverIntelInput {
  target: HoverTarget
  universe: UniverseState
  viewer: ViewerContext
  targetContext: TargetContext
  intel: TargetIntel | null
  contractFields: readonly InfoField[]
  values: ReadonlyMap<string, string | number | null>
  ownership?: ReadonlyMap<string, string>
  at: number
}

/** The stat value shown when the gate's projection has no value for a field
 * (state 'unknown'). A literal string, so the module keeps no mutable data. */
const UNKNOWN_VALUE = 'Unknown'

/** The info-tier rank, used only to recover the relationship tier from the
 * visible fields of a non-intel view. Primitives → freeze is total. */
const INFO_LEVEL_RANK: Readonly<Record<InfoLevel, number>> = Object.freeze({
  public: 0,
  alliance: 1,
  intel: 2,
  owner: 3,
})

/** The target must be the exact object the gate evaluates: a HoverTarget and
 * a TargetContext naming different objects could project the wrong picture. */
function assertTargetMatch(target: HoverTarget, targetContext: TargetContext): void {
  if (target.id !== targetContext.targetId) {
    throw new RangeError(
      `target.id ${JSON.stringify(target.id)} does not match targetContext.targetId ${JSON.stringify(targetContext.targetId)}`,
    )
  }
}

/** The deterministic age label with fixed s/m/h/d units, floored. A negative
 * age (an `at` before the update moment) clamps to '0s'. */
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

/** The status-line headline for a level: the coverageFor lead (the text
 * before the colon) plus ' intel', except a lead that already carries the
 * word ('Full intelligence') and the decayed-to-none case ('No intel'). */
function intelHeadline(level: IntelLevel): string {
  if (level === 'none') {
    return 'No intel'
  }
  const lead = coverageFor(level).split(':')[0].trim()
  return lead.toLowerCase().includes('intel') ? lead : `${lead} intel`
}

/** Build the status line for a level + freshness + age. A record that was
 * never updated has no age and reads 'never updated'. */
function statusLineFor(
  level: IntelLevel,
  freshness: Freshness,
  lastUpdatedAt: number | null,
  at: number,
): string {
  const headline = intelHeadline(level)
  if (lastUpdatedAt === null) {
    return `${headline} · expired · never updated`
  }
  const ageSeconds = (at - lastUpdatedAt) / 1000
  return `${headline} · ${freshness} · updated ${ageLabel(ageSeconds)} ago`
}

/**
 * The standalone deterministic intel status line:
 * '<headline> · <freshness> · updated <age> ago' (see the module docstring
 * for the headline rule). The level shown is the STORED record level — the
 * same convention stalenessSummary uses — with the staleness state and the
 * floored age at `at`. Validation matches the staleness helpers: a non-finite
 * or non-positive `at` or an invalid stored level throws a RangeError.
 */
export function intelStatusLine(intel: TargetIntel, at: number): string {
  return statusLineFor(intel.level, freshnessFor(intel, at), intel.lastUpdatedAt, at)
}

/** The gate's reveal tier for an intel view: REVEAL_MATRIX maps the decayed
 * level onto the info ladder; a decayed-to-none view has no matrix entry and
 * reads 'public'. */
function revealInfoLevel(level: IntelLevel): InfoLevel {
  if (level === 'none') {
    return 'public'
  }
  return REVEAL_MATRIX[level]
}

/** The highest info tier present in a visible field list — the relationship
 * behind a non-intel view (the view itself carries no tier field). */
function highestVisibleLevel(fields: readonly InfoField[]): InfoLevel {
  let best: InfoLevel = 'public'
  for (const field of fields) {
    if (INFO_LEVEL_RANK[field.level] > INFO_LEVEL_RANK[best]) {
      best = field.level
    }
  }
  return best
}

/** The viewer level hoverInfoFor runs at: 'public' when the gate blocks,
 * the reveal tier for an intel view, else the relationship tier recovered
 * from the visible fields. */
function baseViewerLevelFor(gated: GatedView): InfoLevel {
  if (gated.blocked !== null) {
    return 'public'
  }
  if (gated.shownFromIntel) {
    return revealInfoLevel(gated.intelLevel)
  }
  return highestVisibleLevel(gated.visible)
}

/** Map the gate's visible fields onto the hover stat shape: one HoverStat per
 * InfoField, the value as the gate projected it (already formatted); a field
 * with no value (state 'unknown') renders as UNKNOWN_VALUE. */
function mapVisible(fields: readonly InfoField[]): HoverStat[] {
  return fields.map((field) => ({
    label: field.label,
    value: field.value === null ? UNKNOWN_VALUE : field.value,
  }))
}

/**
 * The PvP-gated hover compose (see the module docstring). Validation: `at`
 * must be positive finite, target.id must equal targetContext.targetId, and
 * a non-null intel record is validated by the gate (targetId match, level,
 * lastUpdatedAt) — violations throw a RangeError. Returns null when the
 * target does not resolve against the universe. The inputs are never mutated.
 */
export function hoverIntelInfo(input: HoverIntelInput): IntelHoverInfo | null {
  const { target, universe, viewer, targetContext, intel, contractFields, values, ownership, at } = input
  assertPositiveAt(at)
  assertTargetMatch(target, targetContext)
  const gated = pvpGatedView({
    viewer,
    target: targetContext,
    intel,
    contractFields: [...contractFields],
    values,
    at,
  })
  const base = hoverInfoFor({
    target,
    universe,
    ownership,
    viewerLevel: baseViewerLevelFor(gated),
    at,
  })
  if (base === null) {
    return null
  }
  if (gated.blocked !== null) {
    return {
      base,
      intelLine: null,
      blocked: gated.blocked,
      shownFromIntel: false,
    }
  }
  if (gated.shownFromIntel) {
    const record = intel
    if (record === null) {
      throw new RangeError('an intel-sourced view requires a non-null intel record')
    }
    return {
      base: { ...base, stats: mapVisible(gated.visible), ownedBy: null },
      intelLine: intelStatusLine(record, at),
      blocked: null,
      shownFromIntel: true,
    }
  }
  return {
    base,
    intelLine: null,
    blocked: null,
    shownFromIntel: false,
  }
}
