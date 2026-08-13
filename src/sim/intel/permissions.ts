/**
 * Intel permission model (P6-T01): WHO can see WHAT for a target object.
 *
 * This is the single source for P6-T07's PvP gating: every "can this viewer
 * request this level of detail for this target?" decision resolves here. The
 * enforcement layer that wires this model into the backend is P6-T08 and is
 * OUT OF SCOPE — this module is the pure permission contract only.
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no timestamps, no
 * I/O. Identical inputs always produce identical (deep-equal) output, and
 * caller-provided objects are never mutated.
 *
 * TIER MODEL (the corrected owner-top hierarchy from P4-T03, locked here):
 *   public < alliance < intel < owner
 *
 *   - public   — nothing owned: purely public facts, no relationship needed.
 *   - alliance — the target owner's alliance members (alliance-held facts).
 *   - intel    — scouted intelligence for a stranger (fleet/defense detail).
 *   - owner    — the owning player's data; the HIGHEST tier for an owned
 *                target, above intel (the owner also sees their own
 *                intel-tier detail). admin (debug/QA override) resolves to
 *                the owner tier too.
 *
 * GRANTED SETS — each relationship grants an EXACT set of levels (the PvP
 * gate keeps relationship tiers exclusive: an alliance member never receives
 * the stranger scouting tier, and a stranger never receives the faction's
 * alliance-held data). The public floor is always included; admin and owner
 * grant the full ladder. Precedence order:
 *   1. admin (isAdmin: true)            → all levels, reason 'admin'
 *   2. viewer === target.ownerId         → all levels, reason 'owner'
 *   3. target.ownerId === null           → { public }, reason 'public'
 *                                        (an unowned target is purely public,
 *                                        regardless of alliance lists)
 *   4. ownerAlliances ∩ viewer.alliances → { public, alliance },
 *                                          reason 'alliance'
 *   5. otherwise (a stranger)            → { public, intel }, reason 'intel'
 *
 * `permissionFor` answers a specific request: allowed exactly when the
 * requested level is in the viewer's granted set. A request outside the set
 * is denied and the result carries the permitted tier (the set's max level)
 * as the context. `effectiveLevelFor` is that max level; `intelGrants`
 * projects the granted set onto the per-level canSee flags.
 */

import type { InfoLevel } from '../ui/info'

/** The viewer's identity and alliance memberships. `isAdmin` is the
 * debug/QA override flag: an admin may view every target at the owner tier
 * (documented in DESIGN as the development backdoor, never a live path). */
export interface ViewerContext {
  viewerId: string
  alliances: readonly string[]
  isAdmin?: boolean
}

/** The target object's ownership: ownerId null means unowned / purely
 * public; ownerAlliances are the owning faction's memberships; isHome marks
 * a protected home world (carried for future PvP gates, not consulted
 * here). */
export interface TargetContext {
  targetId: string
  ownerId: string | null
  ownerAlliances: readonly string[]
  isHome?: boolean
}

/** Why a result was granted (or refused): the relationship that granted it,
 * or 'denied' for a request outside the granted set. */
export type PermissionReason =
  | 'owner'
  | 'alliance'
  | 'intel'
  | 'public'
  | 'admin'
  | 'denied'

/** The outcome of a single permission request. `level` is always the
 * viewer's permitted tier (the max granted level) for this target — the
 * context a denied caller needs, and the grant ceiling for an allowed one. */
export interface PermissionResult {
  level: InfoLevel
  allowed: boolean
  reason: PermissionReason
}

/** The level domain in the locked owner-top order, mirrored from ui/info's
 * INFO_LEVELS (public < alliance < intel < owner). Defined locally so this
 * module never imports a runtime value from the UI layer — only the
 * InfoLevel type. The array holds only primitives, so Object.freeze makes it
 * deeply immutable. */
const INTEL_LEVELS: readonly InfoLevel[] = Object.freeze([
  'public',
  'alliance',
  'intel',
  'owner',
])

/** Local, strict non-empty-string check mirroring ui/validate's
 * assertNonEmptyString, kept here so this module carries no runtime import
 * from the UI layer. Trims the value; empty after trimming → RangeError. */
function assertNonEmptyString(value: string, name: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new RangeError(
      `${name} must be a non-empty string, got ${JSON.stringify(value)}`,
    )
  }
  return trimmed
}

const ALL_LEVELS: readonly InfoLevel[] = INTEL_LEVELS

const PUBLIC_LEVELS: readonly InfoLevel[] = Object.freeze(['public'])

const ALLIANCE_LEVELS: readonly InfoLevel[] = Object.freeze([
  'public',
  'alliance',
])

const STRANGER_LEVELS: readonly InfoLevel[] = Object.freeze(['public', 'intel'])

function isInfoLevel(value: unknown): value is InfoLevel {
  return (INTEL_LEVELS as readonly string[]).includes(value as string)
}

function assertViewer(viewer: ViewerContext): void {
  assertNonEmptyString(viewer.viewerId, 'viewerId')
}

function assertTarget(target: TargetContext): void {
  assertNonEmptyString(target.targetId, 'targetId')
  if (target.ownerId !== null) {
    assertNonEmptyString(target.ownerId, 'ownerId')
  }
}

function grantedTier(
  viewer: ViewerContext,
  target: TargetContext,
): { level: InfoLevel; reason: PermissionReason; levels: readonly InfoLevel[] } {
  if (viewer.isAdmin === true) {
    return { level: 'owner', reason: 'admin', levels: ALL_LEVELS }
  }
  if (target.ownerId === viewer.viewerId) {
    return { level: 'owner', reason: 'owner', levels: ALL_LEVELS }
  }
  if (target.ownerId === null) {
    return { level: 'public', reason: 'public', levels: PUBLIC_LEVELS }
  }
  if (target.ownerAlliances.some((alliance) => viewer.alliances.includes(alliance))) {
    return { level: 'alliance', reason: 'alliance', levels: ALLIANCE_LEVELS }
  }
  return { level: 'intel', reason: 'intel', levels: STRANGER_LEVELS }
}

/**
 * The permission model for one request: is this viewer allowed this level of
 * detail for this target? Allowed exactly when the requested level is in the
 * viewer's granted set for the target (locked by the PvP gate: an alliance
 * member gets { public, alliance }, a stranger gets { public, intel }, the
 * owner and admin get every level). A request outside the set is denied and
 * the result's `level` carries the permitted tier as context. Validation:
 * viewerId/targetId/ownerId must be non-empty and `requested` must be one of
 * the four InfoLevels, else a RangeError is thrown.
 */
export function permissionFor(
  viewer: ViewerContext,
  target: TargetContext,
  requested: InfoLevel,
): PermissionResult {
  assertViewer(viewer)
  assertTarget(target)
  if (!isInfoLevel(requested)) {
    throw new RangeError(
      `permissionFor: invalid requested level ${JSON.stringify(requested)}, expected one of ${INTEL_LEVELS.join(', ')}`,
    )
  }
  const granted = grantedTier(viewer, target)
  if (granted.levels.includes(requested)) {
    return { level: granted.level, allowed: true, reason: granted.reason }
  }
  return { level: granted.level, allowed: false, reason: 'denied' }
}

/**
 * The MAX level this viewer may see for this target: admin/owner → owner,
 * alliance member → alliance, stranger → intel, unowned → public. The
 * ordering is the corrected hierarchy (owner > intel > alliance > public).
 */
export function effectiveLevelFor(
  viewer: ViewerContext,
  target: TargetContext,
): InfoLevel {
  assertViewer(viewer)
  assertTarget(target)
  return grantedTier(viewer, target).level
}

/**
 * Project the granted set onto per-level flags: canSee[l] is true exactly for
 * the levels this viewer's relationship grants — cumulative from the public
 * floor up to the permitted tier, minus the exclusive relationship tiers the
 * PvP gate keeps hidden (an alliance member's intel row, a stranger's
 * alliance row). `level` echoes the effective (max) level.
 */
export function intelGrants(
  viewer: ViewerContext,
  target: TargetContext,
): { level: InfoLevel; canSee: Record<InfoLevel, boolean> } {
  assertViewer(viewer)
  assertTarget(target)
  const granted = grantedTier(viewer, target)
  const canSee: Record<InfoLevel, boolean> = {
    public: granted.levels.includes('public'),
    alliance: granted.levels.includes('alliance'),
    intel: granted.levels.includes('intel'),
    owner: granted.levels.includes('owner'),
  }
  return { level: granted.level, canSee }
}
