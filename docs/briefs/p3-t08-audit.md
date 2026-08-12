READ-ONLY AUDIT — StarBaron P3-T08 (master roadmap): Offline Progression.

READ LIST:
- src/sim/core/offline-model.ts   (NEW — under audit)
- tests/offline-model.test.ts     (NEW — test suite)
- src/sim/core/offline.ts         (LOCKED: MAX_OFFLINE_BANK_SECONDS, calculateOfflineEarnings)
- src/sim/core/population-model.ts (P3-T03: applyGrowth)
- src/sim/structures/queues.ts    (P3-T07: completeDueJobs)
- src/sim/player/accrual.ts       (empireRates — the live-path agreement check)
- src/sim/player/types.ts         (PlayerState)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = the CURRENT state of src/sim/core/offline-model.ts + tests/offline-model.test.ts on staging (HEAD). The implementation commits (feat 1549d7a + its audit-fix amends) modify ONLY these two files. Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t08-brief.md + master roadmap P3-T08):
1. OfflineResult { walletDelta, populationByPlanet, completedJobs, bankedSeconds, elapsedSeconds, capped }.
2. offlineProgress: elapsed/banked/capped mirrors offline.ts EXACTLY (8h cap); credit/alloy deltas DELEGATE to locked calculateOfflineEarnings(empireRates(player)); population via applyGrowth fed ONLY the banked window; completedJobs from completeDueJobs; anti-duplication = delta semantics + caller advances lastTickAt (documented contract).
3. offlineSummary deterministic (comma grouping, NO locale APIs); validateOfflineResult catches deltas/banked/capped/population tamper.
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ core/offline, core/population-model, structures/queues, player/accrual (empireRates), player/types, stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments (incl. no locale APIs in summary).
B. Banked/capped math mirrors offline.ts (10h → 8h capped true; 2h → uncapped); credit delta === calculateOfflineEarnings for the same player+window.
C. Population: only the banked window applied; at === lastTickAt → zero everything, capped false.
D. completedJobs from the queue; delta semantics documented (re-apply double-counts by design — the caller advances lastTickAt).
E. offlineSummary determinism + zero-segment omission; validateOfflineResult tamper classes.
F. Tests ~33 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
