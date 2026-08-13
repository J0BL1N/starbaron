READ-ONLY AUDIT — StarBaron P6-T05 (master roadmap): Intel Reports.

READ LIST:
- src/sim/intel/reports.ts     (NEW — under audit)
- tests/reports.test.ts        (NEW — test suite)
- src/sim/intel/levels.ts      (P6-T02: IntelLevel ladder, coverage)
- src/sim/ui/info.ts           (P4-T03: contractFor, projectInfo — delegation target)
- src/sim/planets/hash.ts      (fnv1a)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT f19114707ea7a8309a9c7e9787ff9ef8a7f84edf (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t05-brief.md + master roadmap P6-T05):
1. IntelReport { id (fnv1a(observerId|targetId|observedAt)), observerId, targetRef {kind,id}, targetName, intelLevel, observedAt, revealedFields (InfoField[]), source }.
2. REVEAL_MATRIX deep-frozen: roadmap ladder → info contract levels MONOTONIC (observed→public; scanned→alliance; scouted→intel; deep recon→intel (same tier — one scouting tier in the info contract, documented); full intelligence→owner; none→empty). buildIntelReport delegates field projection to info.projectInfo (or replicates with documented note); values from the map; unknown → 'unknown' state.
3. reportInvariants (id formula, field-key uniqueness + within-contract, level/at validity); reportsForTarget (newest first, id tie-break, fresh array, filter).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ intel/* + ui/info + planets/hash + ui/validate + stdlib; banned comment tokens absent.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Reveal matrix: frozen, monotonic, exact per-rung key sets per kind (hand-check observed vs full intelligence vs none).
C. buildIntelReport: field projection (values/formatNumber/states/order); id determinism; validation.
D. reportInvariants tamper classes; reportsForTarget ordering/filter/tie-break.
E. Tests ~36 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
