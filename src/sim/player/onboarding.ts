/**
 * P2-T08 — new-player entry flow (Phase 2 final task).
 *
 * Pure module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock
 * timestamps (every time is a caller-supplied finite epoch-ms input). The
 * same inputs always produce the same deep-equal results.
 *
 * Flow: account creation (createPlayerProfile, P2-T01) → deterministic home
 * assignment (selectHomeWorld, P2-T02) → starter resources (wallet + grid
 * constants) → initial camera destination → onboarding/tutorial state.
 *
 * STARTER GRID INVARIANT (phase-2 audit): the entry flow ALWAYS grants a
 * { housing: 1 } starter grid — there is no level input, so an empty starter
 * grid is impossible. Legacy save/claim paths (v1/v2 migrations, the claim
 * RPCs) adopt the same starter grid during Phase 4 UI integration (tracked
 * residual).
 *
 * ENTRY SHAPE DECISION: the flow never emits a home-less bundle. When
 * assignment fails the whole entry is rejected (EntryResult.ok === false) and
 * the caller gates admission. Both assignment failure reasons are carried on
 * the result type; 'invalid-eligible-set' occurs when the caller supplies an
 * empty eligible set.
 *
 * ELIGIBLE SET INJECTION: onboarding no longer imports catalogue data. The
 * eligible home set is a caller-supplied REQUIRED input (`eligible`): every
 * entryFlow call passes the candidate home set explicitly (via
 * eligibleHomeBodies or a fixture). 'invalid-eligible-set' therefore occurs
 * only when the caller passes an empty eligible array.
 *
 * PROFILE: the returned profile carries the assigned home world via
 * assignHomeWorld, so the persistent account record and bundle.home agree and
 * repeat login can resolve it (resolveExistingHome).
 *
 * CAMERA: bodies carry no galaxy positions (only orbit elements), so the
 * initial camera resolves the home body's SYSTEM position instead
 * (querySystem(parentOf(home))). The system id derives from the home id's
 * canonical parent — a valid-but-absent body still has one — so systemId is
 * present for each parseable home body; only the position is null when that
 * system is absent from the universe (renderer falls back to galaxy view).
 *
 * ONBOARDING: markStepComplete appends to completedSteps (duplicate-free) and
 * advances currentStep to the first unfinished step in TUTORIAL_ORDER. Once
 * every step is complete currentStep stays at 'explore' (the terminal step —
 * the flow is done).
 */

import type { StructureId } from '../structures/types'
import { querySystem } from '../world/api'
import { parseCanonicalId, parentOf } from '../world/identity'
import type { BodyId, SystemId } from '../world/identity'
import type { UniverseState } from '../world/reconstruct'
import { assignHomeWorld, selectHomeWorld } from './assignment'
import { createPlayerProfile } from './profile'
import type { PlayerProfile } from './profile'
import {
  STARTER_ALLOYS,
  STARTER_CREDITS,
  STARTER_POPULATION,
} from './wallet'

/** Onboarding/tutorial step ids. Extend this union to grow the flow. */
export type TutorialStepId =
  | 'welcome'
  | 'camera'
  | 'build'
  | 'economy'
  | 'explore'

/**
 * Canonical tutorial order — the completion sequence markStepComplete follows
 * when advancing currentStep. Keep in sync with TutorialStepId.
 */
export const TUTORIAL_ORDER: readonly TutorialStepId[] = [
  'welcome',
  'camera',
  'build',
  'economy',
  'explore',
]

export interface OnboardingState {
  playerId: string
  completedSteps: TutorialStepId[]
  currentStep: TutorialStepId
  startedAt: number
}

/**
 * Initial camera destination: the home body's system position when the home
 * resolves in the state, else null (renderer falls back to galaxy view).
 */
export interface InitialCamera {
  bodyId: BodyId
  systemId: SystemId | null
  position: { x: number; y: number; z: number } | null
}

export interface EntryBundle {
  profile: PlayerProfile
  home: BodyId
  initialWallet: { credits: number; alloys: number }
  initialPopulation: number
  initialStructures: Record<StructureId, number>
  camera: InitialCamera
  onboarding: OnboardingState
}

export interface EntryFlowInput {
  playerId: string
  displayName: string
  empireName: string
  joinedAt: number
  universe: UniverseState
  takenHomeWorlds: ReadonlySet<BodyId>
  /**
   * Caller-supplied candidate home set (e.g. eligibleHomeBodies(catalogue)).
   * Required by the eligibility contract — passing an empty array is the only
   * way to trigger 'invalid-eligible-set'.
   */
  eligible: readonly BodyId[]
}

export type EntryResult =
  | { ok: true; bundle: EntryBundle }
  | { ok: false; reason: 'exhausted' | 'invalid-eligible-set' }

function isTutorialStepId(value: unknown): value is TutorialStepId {
  return (
    typeof value === 'string' &&
    (TUTORIAL_ORDER as readonly string[]).includes(value)
  )
}

function assertPositiveTime(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${field} must be a finite number greater than 0, got: ${String(value)}`,
    )
  }
}

function assertPlayerId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RangeError(
      `playerId must be a non-empty string, got: ${String(value)}`,
    )
  }
  return value.trim()
}

/**
 * Starter structure grid for a new player: ALWAYS one Housing at level 1.
 * The phase-2 audit removed the level input, so an empty starter grid is
 * impossible (the invariant is { housing: 1 }, nothing to validate). Legacy
 * save/claim paths adopt the same starter grid during Phase 4 UI integration
 * (tracked residual).
 */
export function initialStructuresFor(): Record<StructureId, number> {
  return { housing: 1 } as Record<StructureId, number>
}

/**
 * Begin onboarding for a player. completedSteps starts empty, currentStep is
 * 'welcome', and startedAt equals the validated positive timestamp input.
 */
export function beginOnboarding(playerId: string, at: number): OnboardingState {
  const validatedId = assertPlayerId(playerId)
  assertPositiveTime(at, 'at')
  return {
    playerId: validatedId,
    completedSteps: [],
    currentStep: 'welcome',
    startedAt: at,
  }
}

/** The first step of TUTORIAL_ORDER not yet completed, or null when all are. */
function nextUnfinishedStep(
  completedSteps: readonly TutorialStepId[],
): TutorialStepId | null {
  for (const candidate of TUTORIAL_ORDER) {
    if (!completedSteps.includes(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * Immutable completion of a tutorial step. Appends the step to completedSteps
 * (never duplicates), and advances currentStep to the first unfinished step in
 * TUTORIAL_ORDER. When every step is complete currentStep stays at the
 * terminal step 'explore' (flow done). Throws a descriptive Error on an
 * unknown step and rejects a non-positive timestamp input.
 */
export function markStepComplete(
  state: OnboardingState,
  step: TutorialStepId,
  at: number,
): OnboardingState {
  assertPositiveTime(at, 'at')
  if (!isTutorialStepId(step)) {
    throw new Error(`unknown tutorial step: ${String(step)}`)
  }
  if (state.completedSteps.includes(step)) {
    return { ...state, completedSteps: [...state.completedSteps] }
  }
  const completedSteps: TutorialStepId[] = [...state.completedSteps, step]
  const next = nextUnfinishedStep(completedSteps)
  return {
    ...state,
    completedSteps,
    currentStep: next === null ? TUTORIAL_ORDER[TUTORIAL_ORDER.length - 1] : next,
  }
}

/**
 * Initial camera destination for a home world. Bodies carry no positions, so
 * the SYSTEM position is resolved via querySystem(parentOf(home)). The system
 * id derives from the home id's canonical parent, so a valid-but-absent body
 * still yields its system id; only when that system is absent from the given
 * universe are the position (and the position alone) null (renderer falls
 * back to galaxy view).
 */
export function initialCameraFor(
  universe: UniverseState,
  home: BodyId,
): InitialCamera {
  const parsed = parseCanonicalId(home)
  if (!parsed.ok || parsed.kind !== 'body') {
    return { bodyId: home, systemId: null, position: null }
  }
  const systemId = parentOf(home) as SystemId
  const system = querySystem(universe, systemId)
  if (system === null) {
    return { bodyId: home, systemId, position: null }
  }
  return { bodyId: home, systemId, position: { ...system.position } }
}

/**
 * The full new-player entry flow: profile → home assignment → starter
 * resources → camera → onboarding. Deterministic: identical inputs always
 * produce a deep-equal bundle. When assignment fails (exhausted or an invalid
 * eligible set) the flow returns { ok: false, reason } and no bundle is
 * produced — the caller gates admission.
 */
export function entryFlow(input: EntryFlowInput): EntryResult {
  const profile = createPlayerProfile({
    playerId: input.playerId,
    displayName: input.displayName,
    empireName: input.empireName,
    joinedAt: input.joinedAt,
  })
  const assignment = selectHomeWorld({
    playerId: input.playerId,
    eligible: input.eligible,
    taken: input.takenHomeWorlds,
  })
  if (!assignment.ok) {
    return { ok: false, reason: assignment.reason }
  }
  const home = assignment.bodyId
  const bundle: EntryBundle = {
    profile: assignHomeWorld(profile, assignment),
    home,
    initialWallet: { credits: STARTER_CREDITS, alloys: STARTER_ALLOYS },
    initialPopulation: STARTER_POPULATION,
    initialStructures: initialStructuresFor(),
    camera: initialCameraFor(input.universe, home),
    onboarding: beginOnboarding(input.playerId, input.joinedAt),
  }
  return { ok: true, bundle }
}
