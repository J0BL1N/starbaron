READ-ONLY AUDIT — StarBaron P2-T08 (master roadmap): New-Player Entry Flow.

READ LIST:
- src/sim/player/onboarding.ts  (NEW — under audit)
- tests/onboarding.test.ts      (NEW — test suite)
- src/sim/player/profile.ts     (P2-T01: createPlayerProfile, withHomeWorld)
- src/sim/player/assignment.ts  (P2-T02: selectHomeWorld, eligibleHomeBodies)
- src/sim/player/ownership.ts   (P2-T04)
- src/sim/player/wallet.ts      (STARTER_CREDITS/ALLOYS/POPULATION)
- src/sim/player/grid.ts        (emptyStructureLevels)
- src/sim/world/api.ts + identity.ts (querySystem, parentOf, parseCanonicalId)
- src/sim/structures/types.ts   (StructureId)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 8987c91ee5e748a1fa4657d8d731e5fa785ccdfb (`git show --stat` adds exactly those two). Docs/working tree OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p2-t08-brief.md + master roadmap P2-T08):
1. EntryResult { ok:true bundle } | { ok:false reason 'exhausted'|'invalid-eligible-set' } — no home-less bundle.
2. EntryBundle { profile, home, initialWallet (1000/0), initialPopulation (1000), initialStructures ({housing:1} at level>=1), camera (bodyId, systemId, position|null), onboarding }.
3. OnboardingState + beginOnboarding + markStepComplete (dupe-free append, advance to first unfinished in TUTORIAL_ORDER, terminal at end, unknown throws).
4. entryFlow deterministic; profile.homeWorld === bundle.home; camera = home's system position via querySystem(parentOf(home)) with body-kind guard.
5. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ player/** + world/** + structures/types + stdlib; determinism; inputs not mutated.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. EntryResult shapes; exhausted/invalid handling; no home-less bundle.
C. Starter values EXACT (1000/0/1000; {housing:1}).
D. Camera resolution: present position when home in universe; null when absent; body-kind guard correct.
E. Onboarding flow: order, dupe-free, terminal state, unknown step throws, at validation.
F. profile.homeWorld === bundle.home; determinism; immutability.
G. Tests ~35 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
