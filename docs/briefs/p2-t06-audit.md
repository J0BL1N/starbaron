READ-ONLY AUDIT — StarBaron P2-T06 (master roadmap): Colonisation.

READ LIST:
- src/sim/player/colonisation.ts  (NEW — under audit)
- tests/colonisation.test.ts      (NEW — test suite)
- src/sim/player/ownership.ts     (P2-T04: ownershipFor, OwnershipRecord/Event, AcquisitionMethod)
- src/sim/player/protection.ts    (P2-T03: HomeProtection)
- src/sim/world/identity.ts       (BodyId, parseCanonicalId, idSeed)
- DESIGN.md (colonisation cost section, if present)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 1233408648ae27b1b814b18243e4a595fb877cff (`git show --stat` adds exactly those two). Docs/working tree OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p2-t06-brief.md + master roadmap P2-T06):
1. COLONISATION_BASE_COST {credits:500, alloys:100}; colonisationCostFor scales deterministically 0.9x-1.1x via idSeed(bodyId).
2. colonise(input): ladder — invalid-target → already-owned → protected (HomeProtection.protected) → requirements-not-met (hasFleet/hasTravel) → insufficient-funds (credits OR alloys) → success (ownershipFor 'colonisation', isHome false, unconquerable false; event emitted; cost returned).
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ ownership/protection/identity + stdlib; determinism; immutability (inputs not mutated).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Ladder precedence EXACT — each reason fires only when its condition is the first failing one (test a case where multiple conditions fail → the highest-priority reason wins).
C. Success path: record fields (method 'colonisation', isHome false, unconquerable false, previousOwnerId null), event fields, cost returned.
D. Cost formula: bounds [0.9x, 1.1x], determinism, per-body variance.
E. Immutability: wallet/set/protection inputs not mutated.
F. Invalid-target detection (parseCanonicalId of bodyId).
G. Tests ~32 covering the above; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
