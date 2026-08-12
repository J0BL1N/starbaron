READ-ONLY AUDIT — StarBaron P2-T05 (master roadmap): Empire Territory.

READ LIST:
- src/sim/player/territory.ts  (NEW — under audit)
- tests/territory.test.ts      (NEW — test suite)
- src/sim/player/ownership.ts  (P2-T04: OwnershipRecord)
- src/sim/world/reconstruct.ts + api.ts (P1-T07/T08: UniverseState, queryBody)
- src/sim/world/identity.ts (BodyId, SystemId)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 66b014d281477b33a44feb2829ddf4a91b2a4eaa (`git show --stat` adds exactly those two). Docs/working tree OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p2-t05-brief.md + master roadmap P2-T05):
1. ownedBodyIdsFor (input order), controlledSystemsFor (unique, sorted by id; membership derived via state — records outside state count as owned but no controlled system), territoryTotalsFor (homeWorlds+colonies === ownedBodies), empireSummaryFor.
2. renderNeutralPayload — {id,name} systems + {id,name,type} bodies, NO owner fields (deep scan); ownershipOverlayPayload — minimal {bodyId, ownerId}[].
3. Purity: no nondeterministic APIs, module mutable state, wall-clock, `any`; imports ⊆ world/** + ownership + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. ownedBodyIdsFor order/membership (duplicates documented, not silently deduped).
C. controlledSystemsFor: unique, sorted, membership correctness (⊆ and ⊇ cross-check with state), records-outside-state behavior consistent with docs.
D. Totals math + summary aggregation.
E. Render neutral payload — deep scan proves NO owner/ownerId keys anywhere; overlay minimal.
F. Determinism; empty inputs; tests ~25; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
