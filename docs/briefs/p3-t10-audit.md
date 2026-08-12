READ-ONLY AUDIT — StarBaron P3-T10 (master roadmap): Economy Balancing Harness.

READ LIST:
- src/sim/balance/harness.ts      (NEW — under audit)
- tests/harness.test.ts           (NEW — test suite)
- src/sim/structures/framework.ts (P3-T04: buildCost, prerequisitesMet, maxLevelFor)
- src/sim/structures/production.ts (P3-T06: productionSummaryFor)
- src/sim/structures/queues.ts    (P3-T07: queueConstruction, completeDueJobs)
- src/sim/core/population-model.ts (P3-T03: applyGrowth, populationCapFor)
- src/sim/core/economy.ts         (LOCKED cost/income formulas)
- src/sim/structures/data.ts      (STRUCTURE_IDS)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT ac2a55f31f173c4525660233671c0212910e56c9 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t10-brief.md + master roadmap P3-T10):
1. HarnessPoint { atSeconds, credits, alloys, population, structureLevels, income, band }; HarnessRun { config, points, summary { timeToFirstUpgradeSeconds, timeToBand, finalCredits, totalUpgrades } }.
2. runEconomySimulation: deterministic tick simulation (60s ticks), income via productionSummaryFor, greedy cheapest-affordable build via queueConstruction + completeDueJobs, wallet ledger owned by the harness (documented), band thresholds BAND_EARLY=900/BAND_MID=14400 exported.
3. harnessTelemetry CSV-style lines (no locale); harnessInvariants (sorted, non-negative, cap, levels, summary, band order).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ the locked modules listed + structures/data + stdlib, PLUS (CONTRACT CORRECTION — all pure): ../planets/levels (tier cap multipliers), ../data/planets (types), ../structures/types (StructureId), ../player/types (types).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Simulation uses ONLY the locked modules (no re-derived formulas — spot-check buildCost/income paths).
C. Determinism (2× deep-equal); greedy policy documented as a harness input; timeToFirstUpgrade math (first completion time, horizon sentinel).
D. Bands in order + thresholds; credits never negative; population ≤ cap; totalUpgrades > 0 on the standard config.
E. Telemetry shape (band,creditsPerSec,alloysPerSec,population,levels,upgrades — no locale); invariants catch each tamper class.
F. Tests ~20+ covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
