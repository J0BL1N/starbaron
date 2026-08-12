TASK (StarBaron P2-T08, master roadmap): NEW-PLAYER ENTRY FLOW — account creation, home assignment, initial resources, initial structures, initial camera destination, tutorial/onboarding state. (Phase 2 final task.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/profile.ts (P2-T01): createPlayerProfile, PlayerProfile.
- src/sim/player/assignment.ts (P2-T02): selectHomeWorld, HomeAssignmentResult, eligibleHomeBodies.
- src/sim/player/ownership.ts (P2-T04): ownershipFor.
- src/sim/player/wallet.ts: STARTER_CREDITS 1000, STARTER_ALLOYS 0, STARTER_POPULATION 1000.
- src/sim/player/grid.ts: emptyStructureLevels().
- src/sim/player/types.ts: OwnedPlanet, PlayerState.
- src/sim/world/reconstruct.ts + api.ts (P1-T07/T08): buildUniverseState, queryBody, UniverseState.
- src/sim/world/identity.ts: BodyId, SystemId, parseCanonicalId.
- src/sim/data/planets.ts: PLANETS.

ALLOWED FILES (create ONLY):
- src/sim/player/onboarding.ts
- tests/onboarding.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `TutorialStepId = 'welcome' | 'camera' | 'build' | 'economy' | 'explore'` (extensible union).
2. `OnboardingState = { playerId: string; completedSteps: TutorialStepId[]; currentStep: TutorialStepId; startedAt: number; }`.
3. `InitialCamera = { bodyId: BodyId; systemId: SystemId | null; position: { x: number; y: number; z: number } | null }` — the initial camera destination: the home body's position if resolvable in the state, else null (documented: renderer falls back to galaxy view).
4. `EntryBundle = { profile: PlayerProfile; home: BodyId; initialWallet: { credits: number; alloys: number }; initialPopulation: number; initialStructures: Record<StructureId, number>; camera: InitialCamera; onboarding: OnboardingState; }`.
5. Pure flow:
   - `initialStructuresFor(level: number): Record<StructureId, number>` — starter grid: Housing 1 at level >= 1 (keep simple: { Housing: 1 } when level >= 1 else empty; level param default 1). Read src/sim/structures/types.ts for StructureId names.
   - `beginOnboarding(playerId: string, at: number): OnboardingState` — completedSteps [], currentStep 'welcome', startedAt = at (validated finite > 0).
   - `markStepComplete(state: OnboardingState, step: TutorialStepId, at: number): OnboardingState` — immutable append (no dupes), advances currentStep to the next unfinished step in the canonical order (export TUTORIAL_ORDER const array); throws descriptive Error on unknown step; 'explore' complete → currentStep stays 'explore' (flow done — document).
   - `entryFlow(input: { playerId: string; displayName: string; empireName: string; joinedAt: number; universe: UniverseState; takenHomeWorlds: ReadonlySet<BodyId>; initialStructureLevel?: number }): { bundle: EntryBundle; assignment: HomeAssignmentResult }`
     - profile = createPlayerProfile(...) (validates names);
     - assignment = selectHomeWorld({ playerId, eligible: eligibleHomeBodies(PLANETS), taken: takenHomeWorlds });
     - home = assignment.ok ? assignment.bodyId : a deterministic fallback (first eligible id — document: when exhausted, the flow still needs a home; the caller gates entry — or make the bundle carry `home: BodyId | null` when not ok and document; PREFER: home: BodyId | null, entry proceeds with null home ONLY for 'invalid-eligible-set' (degenerate); for 'exhausted' the flow returns { ok: false, reason: 'exhausted' } — decide the shape: `EntryResult = { ok: true; bundle: EntryBundle } | { ok: false; reason: 'exhausted' | 'invalid-eligible-set' }` — cleanest);
     - camera: queryBody(universe, home) → position {x,y,z} from the body record? BODIES DON'T CARRY POSITIONS (only orbits) — resolve the SYSTEM position instead: querySystem(universe, parentOf(home)) → position; camera = { bodyId: home, systemId: parentOf(home), position: systemPosition }.
     - initialWallet { credits: STARTER_CREDITS, alloys: STARTER_ALLOYS }, initialPopulation STARTER_POPULATION, initialStructures via initialStructuresFor(input.initialStructureLevel ?? 1).
   - entryFlow is deterministic: same inputs → deep-equal bundle.
6. Invariants (test): profile fields; home from assignment; camera resolution (home in a known system → position present; unresolvable → null position); starter resources exact; initialStructuresFor levels; onboarding flow (begin → mark each step → currentStep advances, no dupes, unknown throws, terminal state); determinism; exhausted/invalid-eligible results; immutability of inputs.

TESTS (vitest, tests/onboarding.test.ts, ~28-34): all invariants + edge cases (empty universe, taken set covering everything, bad names propagate from profile).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/onboarding.test.ts` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
