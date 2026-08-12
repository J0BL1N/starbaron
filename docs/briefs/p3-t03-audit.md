READ-ONLY AUDIT — StarBaron P3-T03 (master roadmap): Population model.

READ LIST:
- src/sim/core/population-model.ts  (NEW — under audit)
- tests/population-model.test.ts    (NEW — test suite)
- src/sim/core/population.ts        (LOCKED existing formulas: populationCap, populationGrowthPerSec, constants)
- src/sim/player/types.ts           (OwnedPlanet.populationCapMultiplier reference)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 82c845dbf3d2614085cdc03d57268c1e8edb2a18 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t03-brief.md + master roadmap P3-T03):
1. PopulationState { population, housingLevels, hydroponicsLevels, lastTickAt }; PopulationSnapshot { population, cap, growthPerSec, at }.
2. populationCapFor = locked populationCap × multiplier (validated); growthRateFor mirrors locked growth formula; snapshotAt = clamp(pop + growth × (at-lastTickAt), 0, cap), at >= lastTickAt; applyGrowth immutable advance; applyWarLoss population × (1-fraction), fraction [0,1], floors at 0, timeline monotonic; populationInvariants {ok, problems}.
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ ../core/population + ../player/types + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Formulas WRAP the locked ones (no re-derivation): populationCapFor === populationCap × multiplier; growthRateFor === populationGrowthPerSec (verify by reading both).
C. snapshotAt: exact gap recovery (pop + growth×gap), cap clamp, floor 0, at === lastTickAt no-op, at < lastTickAt throws, huge gap finite.
D. applyGrowth immutability + lastTickAt advance; applyWarLoss math (0/1/0.25), floor, monotonic at, validation; populationInvariants catches each tamper incl. multi-problem.
E. Tests ~38 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
