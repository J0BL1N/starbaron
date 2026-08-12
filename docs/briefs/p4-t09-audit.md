READ-ONLY AUDIT — StarBaron P4-T09 (master roadmap): UI Mock/Real Data Boundary.

READ LIST:
- src/sim/ui/data-sources.ts   (NEW — under audit)
- tests/data-sources.test.ts   (NEW — test suite)
- src/sim/player/player.ts     (createPlayer)
- src/sim/player/claim.ts      (claimColony)
- src/sim/planets/hash.ts      (fnv1a)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT c2dc46964e4742238cd2c23f20fd7604e19c71f0 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p4-t09-brief.md + master roadmap P4-T09):
1. DataSourceKind mock|real; UiDataSource { kind, label, playerAt, universeAt } (structural).
2. mockDataSource(label, seed): deterministic (same label+seed → deep-equal states; different seeds → different ids/labels); static (at only validated, same state returned); self-contained fixture (createPlayer + claimColony, 1 galaxy/1 system).
3. realDataSource: pure delegation (getters called with the passed at); kind 'real'; label 'live'.
4. guardReal: throws on mock, passes real unchanged; boundaryReport { mock[], real[], mixed }.
5. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ the listed modules + stdlib, PLUS (CONTRACT CORRECTION — the mock fixture legitimately constructs a player + universe, so the full pure dependency set is authorised): ../data/planets (catalogue names), ../player/grid, ../player/types, ../world/* (identity, galaxy, system, body, reconstruct — pure constructors/types).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Mock determinism (same label+seed deep-equal; different seeds differ); static semantics; at validation.
C. Real delegation (getter called with the exact at); guardReal both paths; boundaryReport (all-mock/all-real/mixed).
D. Mock fixture self-consistency (player ids ↔ universe ids where applicable).
E. Tests ~31 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
