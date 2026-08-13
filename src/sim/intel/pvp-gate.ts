/**
 * PvP information gating (P6-T07) — the COMBINED gate: viewer × target → the
 * exact visible picture, fusing the permission model (P6-T01), the intel store
 * (P6-T02/T05) and staleness (P6-T06). This module is the pure decision; the
 * backend that enforces it on the wire is P6-T08 and is OUT OF SCOPE.
 *
 * THE COMBINED RULE (the roadmap's locked PvP rule): an owner sees everything;
 * an alliance member sees the alliance-held tier; a stranger sees ONLY what
 * scouting revealed — never fresher or richer than the intel store — and stale
 * intel degrades the reveal. The gate resolves in this documented order:
 *
 *   1. OWNER (permissions.effectiveLevelFor === 'owner'; an admin resolves to
 *      the owner tier too): visible = EVERY contract field projected at the
 *      'owner' tier; shownFromIntel false. The owner always sees everything,
 *      so the intel store never gates them — intelLevel merely echoes the
 *      store's stored level (or 'full intelligence' when the store is empty,
 *      because the owner's view IS the full picture; the store is for OTHERS);
 *      freshness 'fresh'.
 *   2. ALLIANCE member (effectiveLevelFor === 'alliance'): visible = the
 *      public + alliance tiers projected at 'alliance'; shownFromIntel false.
 *      The relationship tier is exclusive — an ally never receives the
 *      scouting tier — so the store is NOT consulted (intelLevel 'none', never
 *      shownFromIntel); freshness 'fresh'.
 *   3. STRANGER (effectiveLevelFor === 'intel'): shownFromIntel true — the
 *      only window is the intel store. The reveal DELEGATES to the intel
 *      report machinery: reports.revealKeysFor maps the DECAYED level
 *      (staleness.decayedLevel at `at`) onto the exact contract field-key set
 *      (the public + intel field sets ONLY — never an alliance-tier field),
 *      and projectInfo projects the gate's contract fields at that key set —
 *      the exact pipeline reports.buildIntelReport uses (the report's
 *      observer/target/id plumbing is backend-side and irrelevant here).
 *      'full intelligence' is an OWNER-only rung (its reveal would emit owner
 *      + alliance keys), so a stranger record at that level CLAMPS to the
 *      'deep recon' reveal — the deepest a stranger may see. Staleness
 *      filters FIRST: expired intel (staleness.freshnessFor 'expired') blocks
 *      with 'expired-intel' and visible [] — a view is NEVER shown from data
 *      the model considers unusable (no intel, no picture). Otherwise visible
 *      = the reveal at the decayed (clamped) level, intelLevel = that level,
 *      freshness = the freshness state.
 *   4. UNOWNED target (effectiveLevelFor === 'public'): visible = the public
 *      tier projected at 'public'; shownFromIntel false; blocked null. An
 *      unowned target is purely public — the alliance lists and the intel
 *      store are ignored.
 *   5. NO INTEL + stranger: visible [] + blocked 'no-intel'. THE STRICT PvP
 *      RULE: a stranger viewing an OWNED target gets NOTHING beyond the
 *      intel window — public fields are NOT shown unless a report revealed
 *      them, because scouting is the ONLY window onto another player's
 *      property. (The brief's illustrative 'unowned-public-only' reason never
 *      occurs in the final gate: an unowned target is SHOWN at the public tier
 *      by step 4, never blocked; the only blocked reasons are 'no-intel' and
 *      'expired-intel'.)
 *
 * BLOCKED VIEWS: a blocked view always carries visible [], intelLevel 'none'
 * and freshness 'expired' — nothing usable is shown. shownFromIntel is true
 * for an expired-intel block (the intel window was the path) and false for a
 * no-intel block (there is no intel to show from).
 *
 * DECAY EDGE: a stored level that decays to 'none' without expiring (a stale
 * 'observed' report) yields a SHOWN intel view with visible [] — the decay
 * model renders it as a reveal of nothing, not as a block; only 'expired'
 * freshness blocks.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state (the single rank table
 * holds primitives, so Object.freeze is total), no time-source reads (every
 * timestamp is an INPUT), no I/O. Identical inputs always produce identical
 * (deep-equal) output, and caller-provided objects are never mutated.
 */

import { effectiveLevelFor } from './permissions'
import type { TargetContext, ViewerContext } from './permissions'
import { revealKeysFor } from './reports'
import { decayedLevel, freshnessFor } from './staleness'
import type { Freshness } from './staleness'
import { INTEL_LEVELS, isIntelLevel } from './levels'
import type { IntelLevel, TargetIntel } from './levels'
import { projectInfo } from '../ui/info'
import type { InfoField, InfoLevel, ObjectInfoContract } from '../ui/info'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'

/** The two reasons a stranger receives NOTHING: no record in the store, or a
 * record the decay model considers expired. */
export type GatedBlockReason = 'no-intel' | 'expired-intel'

/** The exact visible picture for one viewer × target pair at one moment. */
export interface GatedView {
  targetId: string
  viewerId: string
  visible: InfoField[]
  intelLevel: IntelLevel
  freshness: Freshness
  shownFromIntel: boolean
  blocked: GatedBlockReason | null
}

export interface PvpGatedViewInput {
  viewer: ViewerContext
  target: TargetContext
  intel: TargetIntel | null
  contractFields: InfoField[]
  values: ReadonlyMap<string, string | number | null>
  at: number
}

/** The info-tier rank, used only to label a non-intel view in pvpSummary.
 * Values are primitives, so Object.freeze is total. */
const INFO_LEVEL_RANK: Readonly<Record<InfoLevel, number>> = Object.freeze({
  public: 0,
  alliance: 1,
  intel: 2,
  owner: 3,
})

/** A minimal projection contract wrapping the gate's own contract fields.
 * projectInfo reads only the field list, so the kind and display schema here
 * are inert placeholders; the reveal is over the gate's fields, never the
 * standard contract of a hardcoded kind. */
function wrapper(fields: readonly InfoField[]): ObjectInfoContract {
  return {
    kind: 'body',
    fields: [...fields],
    displaySchema: {
      titleKey: 'name',
      subtitleKey: 'type',
      primaryStatKey: 'population',
    },
  }
}

/** Project the gate's contract fields at an info tier (the projectInfo
 * pipeline — the hidden-truth rule: fields above the tier are excluded). */
function projectAt(
  fields: readonly InfoField[],
  level: InfoLevel,
  values: ReadonlyMap<string, string | number | null>,
): InfoField[] {
  return projectInfo({
    contract: wrapper(fields),
    values,
    viewerLevel: level,
    staleness: new Map<string, boolean>(),
  })
}

/** The intel-store reveal for a stranger: the exact field-key set the decayed
 * level unlocks (reports.revealKeysFor over the gate's contract fields — the
 * public + intel field sets only), projected with projectInfo. A 'none' level
 * reveals nothing. The caller clamps 'full intelligence' to 'deep recon'
 * before this runs (the owner-only rung, see strangerView). */
function revealAt(
  fields: readonly InfoField[],
  level: IntelLevel,
  values: ReadonlyMap<string, string | number | null>,
): InfoField[] {
  if (level === 'none') {
    return []
  }
  const revealLevel: Exclude<IntelLevel, 'none'> = level
  const keys = new Set(revealKeysFor(fields, revealLevel))
  const revealFields = fields.filter((field) => keys.has(field.key))
  return projectAt(revealFields, 'owner', values)
}

/** A blocked view: visible [], intelLevel 'none', freshness 'expired'. */
function blockedView(
  viewerId: string,
  targetId: string,
  reason: GatedBlockReason,
  fromIntel: boolean,
): GatedView {
  return {
    targetId,
    viewerId,
    visible: [],
    intelLevel: 'none',
    freshness: 'expired',
    shownFromIntel: fromIntel,
    blocked: reason,
  }
}

/**
 * Validate a non-null intel record UP FRONT, before the tier switch and
 * irrespective of viewer tier: the level must be a known IntelLevel, the
 * targetId must be non-empty and EQUAL the gate target's targetId (a record
 * for a different target must never leak this target's fields), and
 * lastUpdatedAt must be null or a positive finite number. Violations throw a
 * RangeError. The store is consulted on every tier (the owner echoes the
 * stored level), so a malformed or mis-targeted record is a caller bug, never
 * a per-tier decision.
 */
function assertIntelRecord(intel: TargetIntel, targetId: string): void {
  const recordTargetId = assertNonEmptyString(intel.targetId, 'intel.targetId')
  if (recordTargetId !== targetId) {
    throw new RangeError(
      `intel.targetId ${JSON.stringify(recordTargetId)} does not match target.targetId ${JSON.stringify(targetId)}`,
    )
  }
  if (!isIntelLevel(intel.level)) {
    throw new RangeError(
      `intel.level must be one of ${INTEL_LEVELS.join(', ')}, got ${JSON.stringify(intel.level)}`,
    )
  }
  if (
    intel.lastUpdatedAt !== null &&
    (!Number.isFinite(intel.lastUpdatedAt) || intel.lastUpdatedAt <= 0)
  ) {
    throw new RangeError(
      `intel.lastUpdatedAt must be null or a positive finite number (milliseconds), got ${intel.lastUpdatedAt}`,
    )
  }
}

/** The stranger branch of the gate (see the module docstring, steps 3 and 5).
 * Validation: `at` and the intel record's level are checked by the staleness
 * helpers when the store is consulted (RangeError on violation). */
function strangerView(
  viewerId: string,
  targetId: string,
  intel: TargetIntel | null,
  contractFields: readonly InfoField[],
  values: ReadonlyMap<string, string | number | null>,
  at: number,
): GatedView {
  if (intel === null) {
    return blockedView(viewerId, targetId, 'no-intel', false)
  }
  const freshness = freshnessFor(intel, at)
  if (freshness === 'expired') {
    return blockedView(viewerId, targetId, 'expired-intel', true)
  }
  const decayed = decayedLevel(intel, at)
  // 'full intelligence' is an OWNER-only rung (its reveal would emit owner +
  // alliance keys); the stranger path never applies it — the reveal clamps to
  // the 'deep recon' rung, the deepest a stranger may see.
  const level: IntelLevel =
    decayed === 'full intelligence' ? 'deep recon' : decayed
  return {
    targetId,
    viewerId,
    visible: revealAt(contractFields, level, values),
    intelLevel: level,
    freshness,
    shownFromIntel: true,
    blocked: null,
  }
}

/**
 * The COMBINED gate: viewer × target → the exact visible picture. Resolves in
 * the documented order (owner → alliance → stranger-intel → unowned-public),
 * with the strict no-leak rule — a stranger on an owned target sees ONLY the
 * intel window, never a public fallback. Validation: `at` must be positive
 * finite (assertPositiveAt), the viewer/target contexts must pass
 * permissions.effectiveLevelFor, and a non-null intel record is validated UP
 * FRONT (assertIntelRecord — level, targetId match, lastUpdatedAt) on every
 * tier (RangeError on violation). The input objects are never mutated.
 */
export function pvpGatedView(input: PvpGatedViewInput): GatedView {
  const { viewer, target, intel, contractFields, values, at } = input
  assertPositiveAt(at)
  const tier = effectiveLevelFor(viewer, target)
  const targetId = target.targetId
  const viewerId = viewer.viewerId
  if (intel !== null) {
    assertIntelRecord(intel, targetId)
  }
  switch (tier) {
    case 'owner':
      return {
        targetId,
        viewerId,
        visible: projectAt(contractFields, 'owner', values),
        intelLevel: intel === null ? 'full intelligence' : intel.level,
        freshness: 'fresh',
        shownFromIntel: false,
        blocked: null,
      }
    case 'alliance':
      return {
        targetId,
        viewerId,
        visible: projectAt(contractFields, 'alliance', values),
        intelLevel: 'none',
        freshness: 'fresh',
        shownFromIntel: false,
        blocked: null,
      }
    case 'public':
      return {
        targetId,
        viewerId,
        visible: projectAt(contractFields, 'public', values),
        intelLevel: 'none',
        freshness: 'fresh',
        shownFromIntel: false,
        blocked: null,
      }
    case 'intel':
      return strangerView(viewerId, targetId, intel, contractFields, values, at)
  }
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

/**
 * Deterministic one-line summary of a gated view. Blocked views render
 * 'Blocked: <reason>'; intel views render 'Intel view · <level> (<freshness>)
 * — <n> fields'; the relationship views render 'Owner view · <intelLevel>' /
 * 'Alliance view · <n> fields' / 'Public view · <n> fields' (the relationship
 * is recovered from the visible fields' tiers, since a view does not carry the
 * tier). Examples: 'Owner view · full intelligence', 'Intel view · scanned
 * (aging) — 6 fields', 'Blocked: no-intel'.
 */
export function pvpSummary(view: GatedView): string {
  if (view.blocked !== null) {
    return `Blocked: ${view.blocked}`
  }
  if (view.shownFromIntel) {
    return `Intel view · ${view.intelLevel} (${view.freshness}) — ${view.visible.length} fields`
  }
  const tier = highestVisibleLevel(view.visible)
  if (tier === 'owner') {
    return `Owner view · ${view.intelLevel}`
  }
  if (tier === 'alliance') {
    return `Alliance view · ${view.visible.length} fields`
  }
  return `Public view · ${view.visible.length} fields`
}
