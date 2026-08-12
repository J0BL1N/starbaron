READ-ONLY AUDIT — StarBaron P3-T05 (master roadmap): Housing model.

READ LIST:
- src/sim/structures/housing.ts       (NEW — under audit)
- tests/housing.test.ts               (NEW — test suite)
- src/sim/core/population.ts          (LOCKED: populationCap, populationGrowthPerSec, BASE_POPULATION_CAP, HOUSING_* constants)
- src/sim/core/population-model.ts    (P3-T03: PopulationState, applyGrowth)
- src/sim/structures/framework.ts     (P3-T04: upgradeCost)
- src/sim/structures/effects.ts       (housing effect semantics)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 8bd14e9ae316d7c516fdf27cd25fec06b63edded (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t05-brief.md + master roadmap P3-T05):
1. housingCapBonus = populationCap(level) - BASE_POPULATION_CAP; housingGrowthBonus = locked per-level growth; housingCap = populationCap(level) × planetMultiplier; housingUpgradeCost delegates to framework.upgradeCost; housingSnapshot {level, capBonus, growthBonus, nextUpgradeCost, at}; offlineHousingOutcome = validated applyGrowth (PopulationState DOES carry housing levels — verify the shape claim); housingUiState + display string (deterministic formatting, no toLocaleString).
2. Purity: no nondeterministic APIs/module mutable state/wall-clock/locale; no `any`; imports ⊆ core/population + core/population-model + structures/framework + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments (incl. no locale-dependent calls).
B. Wrappers EXACTLY mirror the locked raw helpers (hand-compute samples: level 0, 3, 10 against population.ts formulas).
C. planetMultiplier math + validation; upgradeCost delegation; snapshot fields; offline outcome ≡ applyGrowth for same inputs.
D. housingUiState display string determinism (no toLocaleString/locale APIs).
E. Tests ~28 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
