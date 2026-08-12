READ-ONLY AUDIT — StarBaron P3-T07 (master roadmap): Construction Queues.

READ LIST:
- src/sim/structures/queues.ts    (NEW — under audit)
- tests/queues.test.ts            (NEW — test suite)
- src/sim/structures/data.ts      (buildTimeSec per structure)
- src/sim/structures/framework.ts (P3-T04: buildCost, canBuild)
- src/sim/structures/types.ts     (StructureId)
- src/sim/planets/hash.ts         (fnv1a)
- DESIGN.md (construction section — the implementer says none exists; verify)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 1a5da4df69e88ac6f345acbfd0199d4d363fb8c0 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t07-brief.md + master roadmap P3-T07):
1. ConstructionJob { id (fnv1a deterministic), structure, fromLevel, toLevel (=== fromLevel+1), startedAt, finishesAt, cost, status 'building'|'complete'|'cancelled' }; ConstructionQueue { planet, jobs }.
2. queueConstruction: validates canBuild ladder (funds/prereqs via framework), level step, timestamps; duration = buildTimeSec × 1000 (no level scaling — verify DESIGN has none); wallet NOT debited (reservation contract documented).
3. completeDueJobs IDEMPOTENT (status set once; completed array = newly completed only); cancelJob full-refund (DESIGN has no cancellation section — verify), complete/already-cancelled/unknown throws; queueInvariants (dup ids, field validity).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ structures/**, planets/hash, player/wallet (types), stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. finishesAt = startedAt + buildTimeSec × 1000 for each of the 7 structures; reservation cost = buildCost(fromLevel) + alloyCost where applicable.
C. Idempotent completion: run twice → second returns zero newly-completed; inclusive due boundary.
D. Cancel: full refund of reserved cost; throws on complete/unknown/cancelled.
E. Validation ladder completeness; immutability; determinism; queueInvariants tamper classes.
F. Tests ~33 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
