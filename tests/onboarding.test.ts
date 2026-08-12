import { describe, expect, it } from 'vitest'
import { PLANETS } from '../src/sim/data/planets'
import { eligibleHomeBodies, selectHomeWorld } from '../src/sim/player/assignment'
import {
  TUTORIAL_ORDER,
  beginOnboarding,
  entryFlow,
  initialCameraFor,
  initialStructuresFor,
  markStepComplete,
} from '../src/sim/player/onboarding'
import type {
  EntryFlowInput,
  TutorialStepId,
} from '../src/sim/player/onboarding'
import {
  STARTER_ALLOYS,
  STARTER_CREDITS,
  STARTER_POPULATION,
} from '../src/sim/player/wallet'
import { querySystem } from '../src/sim/world/api'
import { parentOf } from '../src/sim/world/identity'
import type { BodyId } from '../src/sim/world/identity'
import { buildUniverseState } from '../src/sim/world/reconstruct'
import type { UniverseState } from '../src/sim/world/reconstruct'

const JOINED_AT = 1_700_000_000_000

function catalogueUniverse(): UniverseState {
  return buildUniverseState({ seed: 'catalogue' })
}

function emptyUniverse(): UniverseState {
  return buildUniverseState({ seed: 'elsewhere', includeCatalogue: false })
}

function baseEntryInput(overrides: Partial<EntryFlowInput> = {}): EntryFlowInput {
  return {
    playerId: 'player-1',
    displayName: 'Jay',
    empireName: 'Starbaron',
    joinedAt: JOINED_AT,
    universe: catalogueUniverse(),
    takenHomeWorlds: new Set<BodyId>(),
    eligible: eligibleHomeBodies(PLANETS),
    ...overrides,
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value
}

describe('initialStructuresFor (P2-T08)', () => {
  it('returns { housing: 1 } at the default level', () => {
    expect(initialStructuresFor()).toEqual({ housing: 1 })
  })

  it('returns { housing: 1 } for any level >= 1', () => {
    for (const level of [1, 3, 8]) {
      expect(initialStructuresFor(level)).toEqual({ housing: 1 })
    }
  })

  it('returns an empty grid at level 0 and negative levels', () => {
    for (const level of [0, -1, -100]) {
      expect(initialStructuresFor(level)).toEqual({})
    }
  })

  it('is deterministic: deep-equal across calls', () => {
    expect(initialStructuresFor(2)).toEqual(initialStructuresFor(2))
  })
})

describe('beginOnboarding (P2-T08)', () => {
  it('starts at welcome with no completed steps and the given start time', () => {
    const state = beginOnboarding('player-1', JOINED_AT)
    expect(state.playerId).toBe('player-1')
    expect(state.completedSteps).toEqual([])
    expect(state.currentStep).toBe('welcome')
    expect(state.startedAt).toBe(JOINED_AT)
  })

  it('rejects non-finite or non-positive start times', () => {
    for (const at of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => beginOnboarding('player-1', at)).toThrow(RangeError)
    }
  })

  it('rejects an empty or blank player id', () => {
    for (const id of ['', '   ']) {
      expect(() => beginOnboarding(id, JOINED_AT)).toThrow(RangeError)
    }
  })

  it('is deterministic: deep-equal across calls', () => {
    expect(beginOnboarding('player-1', JOINED_AT)).toEqual(
      beginOnboarding('player-1', JOINED_AT),
    )
  })
})

describe('markStepComplete (P2-T08)', () => {
  it('appends the step and advances currentStep to the next step', () => {
    const state = beginOnboarding('player-1', JOINED_AT)
    const next = markStepComplete(state, 'welcome', JOINED_AT)
    expect(next.completedSteps).toEqual(['welcome'])
    expect(next.currentStep).toBe('camera')
  })

  it('walks the whole tutorial in canonical order ending terminal at explore', () => {
    let state = beginOnboarding('player-1', JOINED_AT)
    for (const step of TUTORIAL_ORDER) {
      state = markStepComplete(state, step, JOINED_AT)
    }
    expect(state.completedSteps).toEqual([...TUTORIAL_ORDER])
    expect(state.currentStep).toBe('explore')
  })

  it('does not duplicate an already-completed step', () => {
    let state = beginOnboarding('player-1', JOINED_AT)
    state = markStepComplete(state, 'welcome', JOINED_AT)
    const again = markStepComplete(state, 'welcome', JOINED_AT)
    expect(again.completedSteps).toEqual(['welcome'])
    expect(again.currentStep).toBe('camera')
  })

  it('advances to the first unfinished step after an out-of-order completion', () => {
    let state = beginOnboarding('player-1', JOINED_AT)
    state = markStepComplete(state, 'welcome', JOINED_AT)
    const outOfOrder = markStepComplete(state, 'build', JOINED_AT)
    expect(outOfOrder.completedSteps).toEqual(['welcome', 'build'])
    expect(outOfOrder.currentStep).toBe('camera')
  })

  it('throws a descriptive error for an unknown step', () => {
    const state = beginOnboarding('player-1', JOINED_AT)
    expect(() =>
      markStepComplete(state, 'bogus' as TutorialStepId, JOINED_AT),
    ).toThrow(/unknown tutorial step/)
  })

  it('rejects a non-positive completion time', () => {
    const state = beginOnboarding('player-1', JOINED_AT)
    expect(() => markStepComplete(state, 'welcome', 0)).toThrow(RangeError)
  })

  it('is immutable: the input state is never mutated', () => {
    const state = beginOnboarding('player-1', JOINED_AT)
    const next = markStepComplete(state, 'welcome', JOINED_AT)
    expect(next).not.toBe(state)
    expect(state.completedSteps).toEqual([])
    expect(state.currentStep).toBe('welcome')
    expect(next.completedSteps).toEqual(['welcome'])
  })

  it('is deterministic: deep-equal across calls', () => {
    const state = beginOnboarding('player-1', JOINED_AT)
    expect(markStepComplete(state, 'welcome', JOINED_AT)).toEqual(
      markStepComplete(state, 'welcome', JOINED_AT),
    )
  })
})

describe('initialCameraFor (P2-T08)', () => {
  it('resolves the home system position when the home is in the state', () => {
    const universe = catalogueUniverse()
    const home = eligibleHomeBodies(PLANETS)[0]
    const camera = initialCameraFor(universe, home)
    expect(camera.systemId).not.toBeNull()
    expect(camera.position).not.toBeNull()
    if (camera.systemId !== null && camera.position !== null) {
      const system = querySystem(universe, camera.systemId)
      expect(system).not.toBeNull()
      if (system !== null) {
        expect(camera.position).toEqual(system.position)
      }
    }
  })

  it('sets systemId to the canonical parent of the home', () => {
    const universe = catalogueUniverse()
    const home = eligibleHomeBodies(PLANETS)[0]
    const camera = initialCameraFor(universe, home)
    expect(camera.systemId).toBe(parentOf(home))
  })

  it('keeps the canonical parent systemId with null position when absent', () => {
    const home = eligibleHomeBodies(PLANETS)[0]
    const camera = initialCameraFor(emptyUniverse(), home)
    expect(camera.position).toBeNull()
    expect(camera.systemId).toBe(parentOf(home))
  })

  it('returns null systemId and null position for a non-body id', () => {
    const camera = initialCameraFor(catalogueUniverse(), 'not-a-body' as BodyId)
    expect(camera.systemId).toBeNull()
    expect(camera.position).toBeNull()
    expect(camera.bodyId).toBe('not-a-body' as BodyId)
  })

  it('keeps the bodyId even when unresolvable', () => {
    const home = eligibleHomeBodies(PLANETS)[0]
    const camera = initialCameraFor(emptyUniverse(), home)
    expect(camera.bodyId).toBe(home)
  })

  it('is deterministic: deep-equal across calls', () => {
    const universe = catalogueUniverse()
    const home = eligibleHomeBodies(PLANETS)[0]
    expect(initialCameraFor(universe, home)).toEqual(
      initialCameraFor(universe, home),
    )
  })
})

describe('entryFlow (P2-T08)', () => {
  it('succeeds and assigns the deterministic home', () => {
    const expected = selectHomeWorld({
      playerId: 'player-1',
      eligible: eligibleHomeBodies(PLANETS),
      taken: new Set<BodyId>(),
    })
    const result = entryFlow(baseEntryInput())
    expect(result.ok).toBe(true)
    expect(expected.ok).toBe(true)
    if (result.ok && expected.ok) {
      expect(result.bundle.home).toBe(expected.bodyId)
    }
  })

  it('creates a profile with the entry inputs', () => {
    const result = entryFlow(baseEntryInput())
    expect(result.ok).toBe(true)
    if (result.ok) {
      const profile = result.bundle.profile
      expect(profile.playerId).toBe('player-1')
      expect(profile.displayName).toBe('Jay')
      expect(profile.empireName).toBe('Starbaron')
      expect(profile.joinedAt).toBe(JOINED_AT)
      expect(profile.settings.theme).toBe('dark')
      expect(profile.progression).toEqual({
        xp: 0,
        level: 1,
        achievementsUnlocked: [],
      })
      expect(profile.generationVersion).toBe(1)
    }
  })

  it('records the assigned home on the profile', () => {
    const result = entryFlow(baseEntryInput())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bundle.profile.homeWorld).toBe(result.bundle.home)
    }
  })

  it('assigns the exact starter resources', () => {
    const result = entryFlow(baseEntryInput())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bundle.initialWallet).toEqual({
        credits: STARTER_CREDITS,
        alloys: STARTER_ALLOYS,
      })
      expect(STARTER_CREDITS).toBe(1000)
      expect(STARTER_ALLOYS).toBe(0)
      expect(result.bundle.initialPopulation).toBe(STARTER_POPULATION)
      expect(STARTER_POPULATION).toBe(1000)
    }
  })

  it('gives the starter housing grid at the default level', () => {
    const result = entryFlow(baseEntryInput())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bundle.initialStructures).toEqual({ housing: 1 })
    }
  })

  it('respects a custom initialStructureLevel', () => {
    const low = entryFlow(baseEntryInput({ initialStructureLevel: 0 }))
    expect(low.ok).toBe(true)
    if (low.ok) {
      expect(low.bundle.initialStructures).toEqual({})
    }
    const high = entryFlow(baseEntryInput({ initialStructureLevel: 4 }))
    expect(high.ok).toBe(true)
    if (high.ok) {
      expect(high.bundle.initialStructures).toEqual({ housing: 1 })
    }
  })

  it('resolves the initial camera to the home system position', () => {
    const universe = catalogueUniverse()
    const result = entryFlow(baseEntryInput({ universe }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const { camera, home } = result.bundle
      expect(camera.bodyId).toBe(home)
      expect(camera.systemId).not.toBeNull()
      expect(camera.position).not.toBeNull()
      if (camera.systemId !== null && camera.position !== null) {
        const system = querySystem(universe, camera.systemId)
        expect(system).not.toBeNull()
        if (system !== null) {
          expect(camera.position).toEqual(system.position)
        }
      }
    }
  })

  it('starts onboarding at welcome with joinedAt as the start time', () => {
    const result = entryFlow(baseEntryInput())
    expect(result.ok).toBe(true)
    if (result.ok) {
      const onboarding = result.bundle.onboarding
      expect(onboarding.playerId).toBe('player-1')
      expect(onboarding.completedSteps).toEqual([])
      expect(onboarding.currentStep).toBe('welcome')
      expect(onboarding.startedAt).toBe(JOINED_AT)
    }
  })

  it('is deterministic: identical inputs produce a deep-equal bundle', () => {
    const a = entryFlow(baseEntryInput())
    const b = entryFlow(baseEntryInput())
    expect(a).toEqual(b)
  })

  it('never mutates its inputs (deep-frozen universe and taken set)', () => {
    const universe = deepFreeze(catalogueUniverse())
    const taken = deepFreeze(new Set<BodyId>(eligibleHomeBodies(PLANETS).slice(0, 1)))
    const result = entryFlow(baseEntryInput({ universe, takenHomeWorlds: taken }))
    expect(result.ok).toBe(true)
  })

  it("returns ok:false reason 'exhausted' when every eligible home is taken", () => {
    const taken = new Set(eligibleHomeBodies(PLANETS))
    const result = entryFlow(baseEntryInput({ takenHomeWorlds: taken }))
    expect(result).toEqual({ ok: false, reason: 'exhausted' })
  })

  it("reports 'invalid-eligible-set' for an empty eligible set (gate preserved)", () => {
    const result = selectHomeWorld({
      playerId: 'player-1',
      eligible: [],
      taken: new Set<BodyId>(),
    })
    expect(result).toEqual({
      ok: false,
      reason: 'invalid-eligible-set',
      attempt: 0,
    })
  })

  it('propagates invalid names and join time from the profile validation', () => {
    expect(() =>
      entryFlow(baseEntryInput({ displayName: '   ' })),
    ).toThrow(/displayName/)
    expect(() => entryFlow(baseEntryInput({ empireName: 'x' }))).toThrow(
      /empireName/,
    )
    expect(() => entryFlow(baseEntryInput({ joinedAt: 0 }))).toThrow(/joinedAt/)
  })

  it('still returns an ok bundle in an empty universe with a null camera position', () => {
    const result = entryFlow(baseEntryInput({ universe: emptyUniverse() }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bundle.home).toBe(result.bundle.profile.homeWorld)
      expect(result.bundle.camera.position).toBeNull()
      expect(result.bundle.camera.systemId).toBe(parentOf(result.bundle.home))
      expect(result.bundle.initialStructures).toEqual({ housing: 1 })
    }
  })

  it("returns ok:false reason 'invalid-eligible-set' with no bundle when eligible is empty", () => {
    const result = entryFlow(baseEntryInput({ eligible: [] }))
    expect(result).toEqual({ ok: false, reason: 'invalid-eligible-set' })
    expect('bundle' in result).toBe(false)
  })
})
