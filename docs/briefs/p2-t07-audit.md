READ-ONLY AUDIT — StarBaron P2-T07 (master roadmap): Ownership Transfer.

READ LIST:
- src/sim/player/transfer.ts   (NEW — under audit)
- tests/transfer.test.ts       (NEW — test suite)
- src/sim/player/ownership.ts  (P2-T04: transferOwnership, historyAppend, OwnershipRecord/Event)
- src/sim/player/protection.ts (P2-T03: protection semantics)
- src/sim/structures/types.ts  (StructureGrid)
- src/sim/player/grid.ts       (emptyStructureLevels convention)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 2eda1c527d6e22ced6bc9c5bcc7d02437dd573b5 (`git show --stat` adds exactly those two). Docs/working tree OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p2-t07-brief.md + master roadmap P2-T07):
1. SurvivalRules {populationSurvival, structureSurvival, garrisonSurvival} ∈ [0,1] validated (throw outside); applySurvival (Math.round, clamp); structureSurvivors (floor, drop zeroed, immutable).
2. conquestTransfer: ladder protected → self-transfer → success; success = ownership-transfer semantics (previousOwnerId = old owner, method 'conquest', at), survivors, structures, notifications EXACTLY two ('ownership-lost' to old owner, 'ownership-gained' to new owner, same bodyId/at).
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ ownership/protection/structures types + stdlib; determinism; inputs never mutated.

CHECK:
A. Purity + imports; no banned tokens in comments (incl. no Date.now()/Math.random/`any` tokens).
B. Ladder precedence + no escaping throw for protected (the transferOwnership throw is converted); self-transfer rejected.
C. Survivors math: applySurvival rounding + clamp; structureSurvivors floor + zero-drop + immutability.
D. Notifications exact (kind/owner/bodyId/at; exactly 2 on success).
E. History: previousHistory not mutated; event previousOwnerId correct.
F. Determinism + immutability; tests ~31 covering all; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
