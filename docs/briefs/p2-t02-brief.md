TASK (StarBaron P2-T02, master roadmap): HOME-WORLD ASSIGNMENT — deterministic eligible-unclaimed selection with collision prevention, exhaustion handling, and repeat-login idempotency.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/claim.ts: claimIndexForPlayer (fnv1a-based single-index pick — NO eligibility, NO collision handling), claimHomePlanet, claimColony, CLAIM_SALT.
- src/sim/player/profile.ts (P2-T01, just committed): PlayerProfile, withHomeWorld, validateProfile.
- src/sim/world/catalogue.ts (P1-T05): buildCatalogueMapping — the canonical real-body set (6,321 bodies).
- src/sim/world/identity.ts: BodyId, bodyId(), idSeed(), parseCanonicalId.
- src/sim/world/reconstruct.ts: buildUniverseState, UniverseState.

ALLOWED FILES (create ONLY):
- src/sim/player/assignment.ts
- tests/assignment.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock timestamps; no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `HomeAssignmentResult = { ok: true; bodyId: BodyId; attempt: number } | { ok: false; reason: 'exhausted' | 'invalid-eligible-set'; attempt: number }`.
2. `eligibleHomeBodies(planets: readonly PlanetCatalogueEntry[]): BodyId[]` — deterministic eligible set: every catalogue planet body id (type 'planet', ordinals 0.. per host) — derived the SAME way buildCatalogueMapping builds bodies (use idSeed-style deterministic derivation; DO NOT depend on a mapping instance — derive from the entries directly: for each entry in catalogue order, bodyId(systemId('catalogue', entry.hostname), 'planet', ordinalWithinHost)). Export the ordinal computation (host group index).
3. `selectHomeWorld(input: { playerId: string; eligible: readonly BodyId[]; taken: ReadonlySet<BodyId>; salt?: string }): HomeAssignmentResult`:
   - Deterministic probing: first index = fnv1a(`${salt ?? 'starbaron-home-v1'}|${playerId}`) % eligible.length; if taken, probe i = (base + fnv1a(`${salt}|${playerId}|attempt`) % eligible.length) % eligible.length — bounded attempts (max 3 × eligible.length to guarantee termination or detect exhaustion).
   - Collision prevention: never returns a taken id.
   - Exhaustion: if every eligible id is taken → { ok: false, reason: 'exhausted', attempt }.
   - Invalid: empty eligible → { ok: false, reason: 'invalid-eligible-set' }.
   - Deterministic: same inputs → same result (deep-equal across calls).
4. `assignHomeWorld(profile: PlayerProfile, result: HomeAssignmentResult): PlayerProfile` — when ok, immutable withHomeWorld(profile, bodyId); when not ok, returns the profile unchanged.
5. `resolveExistingHome(profile: PlayerProfile, taken: ReadonlySet<BodyId>): { ok: boolean; reason?: 'not-assigned' | 'taken' }` — repeat-login validation: profile.homeWorld present → ok (and the id must still be in `taken`? NO — the home world is ALWAYS claimed by its owner; treat 'taken' as a consistency flag: homeWorld not in taken → problem flag 'home-not-in-taken'; homeWorld absent → 'not-assigned').
6. Invariants (test):
   - determinism (2× deep-equal, incl. probing path with a partially-taken set)
   - collision: with a taken set covering the first base index, selectHomeWorld returns a DIFFERENT, non-taken id
   - exhaustion: taken = all eligible → ok:false 'exhausted'
   - empty eligible → 'invalid-eligible-set'
   - two different players with same base index → distinct results when collisions force probing
   - assignHomeWorld immutable; resolveExistingHome covers the three states
   - eligibleHomeBodies count === 6321 (real catalogue) and all ids parse as kind 'body' type 'planet'

TESTS (vitest, tests/assignment.test.ts, ~22-28): real catalogue eligible set (count + id shapes + determinism), probing/collision with fixtures, exhaustion, invalid set, idempotent repeat-login paths, assignHomeWorld immutability.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/assignment.test.ts` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
