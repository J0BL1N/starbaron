READ-ONLY AUDIT — StarBaron P3-T04 (master roadmap): Structure Framework.

READ LIST:
- src/sim/structures/framework.ts  (NEW — under audit)
- tests/framework.test.ts          (NEW — test suite)
- src/sim/structures/types.ts      (StructureId, Structure)
- src/sim/structures/data.ts       (STRUCTURES roster, alloyCost)
- src/sim/structures/effects.ts    (nextBuildCost — upgradeCost must mirror it)
- src/sim/core/economy.ts          (structureCost — LOCKED formula)
- src/sim/player/grid.ts           (StructureGrid, emptyStructureLevels)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = the CURRENT state of src/sim/structures/framework.ts + tests/framework.test.ts on staging (HEAD; the feat commit adds exactly these two). The docs commits are bridge evidence — `git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p3-t04-brief.md + master roadmap P3-T04):
1. Prerequisite/PREREQUISITES (draft set, source documented); MAX_LEVEL = 100 (documented engineering guard).
2. buildCost/upgradeCost delegate to LOCKED structureCost (verify byte-identical math with effects.nextBuildCost); canBuild ladder unknown → prerequisites → credits → alloys (alloy only for turret per data.ts); prerequisitesMet; maxLevelFor; validateGrid (all problems reported); structureSummary.
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ structures/** + core/economy + player/grid + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. buildCost/upgradeCost: EXACT parity with structureCost/nextBuildCost (compute sample values by hand: level 0 → baseCost; level 3 → baseCost × 1.15^3 — compare).
C. canBuild ladder precedence + unknown-structure handling; prereq exactly-met boundary.
D. validateGrid catches ALL tamper classes; over-max; non-integer.
E. structureSummary shape; PREREQUISITES source documented honestly.
F. Tests ~32 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
