READ-ONLY AUDIT — StarBaron P5-T03 (master roadmap): Fleet Creation.

READ LIST:
- src/sim/fleet/fleet.ts        (NEW — under audit)
- tests/fleet.test.ts           (NEW — test suite)
- src/sim/fleet/ships.ts        (P5-T01: SHIP_CLASSES)
- src/sim/fleet/shipyard.ts     (P5-T02: canBuildShips ladder semantics)
- src/sim/planets/hash.ts       (fnv1a)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 98cfd8c1a1b2e11caf2a0878a08ad87236cd8228 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t03-brief.md + master roadmap P5-T03):
1. FleetComposition (5 counts, non-negative integers); Fleet { id (fnv1a(ownerId|name|at)), ownerId, name, composition, location {kind, bodyId} (REQUIRED in request — PlayerState has no bodyId, documented), createdAt, status }.
2. fleetCompositionCost (LOCKED SHIP_CLASSES costs × counts); fleetCompositionSize (total count).
3. createFleet: validation (at/owner/composition); eligibility ladder DIRECT (no-shipyard → fleet-cap → credits → alloys — documented approximation of canBuildShips which is single-class); id deterministic; wallet NOT debited (cost = reservation).
4. fleetInvariants tamper classes.
5. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ the listed modules + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Cost/size math against LOCKED SHIP_CLASSES (hand-compute 2 scouts + 1 frigate = 9000cr/200alloy); composition validation (negative/fractional counts).
C. createFleet: ladder order + reasons; id determinism; location required; status default; createdAt.
D. fleetInvariants tamper classes; immutability; determinism.
E. Tests ~34 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
