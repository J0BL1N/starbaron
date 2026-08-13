READ-ONLY AUDIT — StarBaron P6-T02 (master roadmap): Intel Levels.

READ LIST:
- src/sim/intel/levels.ts      (NEW — under audit)
- tests/levels.test.ts         (NEW — test suite)
- docs/MASTER-ROADMAP.md (P6-T02 subtasks — the ladder names observed/scanned/scouted/deep recon/full intelligence)
- src/sim/ui/info.ts (InfoState mapping target)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 5a964365795cbd3590e81c605180a04279a07c50 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t02-brief.md + master roadmap P6-T02):
1. IntelLevel ladder none < observed < scanned < scouted < deep recon < full intelligence (the roadmap's exact names; deep-frozen tables).
2. TargetIntel { targetId, level, lastUpdatedAt|null, sources (deduped) }; recordIntel immutable (promotion = max — never decreases; at validated; source dedup); higher; promoteIntel.
3. coverageFor per level (locked strings); levelFromInfoState (unknown→none, estimated→scanned, stale→observed, verified→full intelligence).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ stdlib (+ local validation mirrors — NO runtime ui-layer imports); banned comment tokens absent.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Ladder matches the roadmap's subtask names + rank order; tables deep-frozen.
C. promoteIntel never-decreases (max semantics, equal → same); recordIntel (immutability, at validation, source dedup); higher determinism.
D. coverageFor strings per level; levelFromInfoState mapping.
E. Tests ~32 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
