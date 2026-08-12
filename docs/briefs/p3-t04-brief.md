TASK (StarBaron P3-T04, master roadmap): STRUCTURE FRAMEWORK — formal framework: structure IDs, levels, build costs, upgrade costs, PREREQUISITES, placement/grid rules, backend-authority boundary.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/structures/types.ts: StructureId union, Structure { id, name, category, baseCost, buildTimeSeconds?, description }, StructureEffect.
- src/sim/structures/data.ts: STRUCTURES roster (7 structures), costs.
- src/sim/structures/effects.ts: per-level effects, nextBuildCost wrapper (cost growth ×1.15 per level — LOCKED formula in economy.ts).
- src/sim/core/economy.ts: structureCost(baseCost, level).
- src/sim/player/grid.ts: emptyStructureLevels, StructureGrid.
- DESIGN.md: structure sections (prerequisites, placement rules if specified) — READ the structures section FIRST; use DESIGN's numbers/rules when present.

ALLOWED FILES (create ONLY):
- src/sim/structures/framework.ts
- tests/framework.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `Prerequisite = { structure: StructureId; minLevel: number }`; `PREREQUISITES: Readonly<Record<StructureId, readonly Prerequisite[]>>` — from DESIGN.md if it defines them; else a minimal sensible set (e.g. Defense Turret requires Barracks ≥ 1; Shipyard requires Ore Mine ≥ 3 — DOCUMENT the source: DESIGN or 'draft — T10 balancing input'). Empty array = no prerequisites.
2. Pure functions:
   - `buildCost(structure: StructureId, level: number): number` — delegates to the LOCKED structureCost (baseCost × 1.15^level — verify economy.ts's exact signature and use it; do NOT re-derive).
   - `upgradeCost(structure: StructureId, currentLevel: number): number` — the cost to go currentLevel → currentLevel+1 = structureCost(baseCost, currentLevel) (READ effects.ts nextBuildCost to confirm semantics and MIRROR it exactly).
   - `prerequisitesMet(structure: StructureId, grid: StructureGrid): boolean` — every Prerequisite structure level >= minLevel.
   - `canBuild(structure: StructureId, grid: StructureGrid, wallet: { credits: number; alloys: number }): { ok: boolean; reason?: 'prerequisites' | 'insufficient-credits' | 'insufficient-alloys' | 'unknown-structure' }` — ladder: unknown → prerequisites → funds (credits then alloys; read data.ts for which structures cost alloys — Defense Turret does).
   - `maxLevelFor(structure: StructureId): number` — 100 if DESIGN is silent (document); validates structure known.
   - `validateGrid(grid: StructureGrid): { ok: boolean; problems: string[] }` — every StructureId key present, levels non-negative integers, no unknown keys, each level <= maxLevelFor.
   - `structureSummary(structure: StructureId): { id, name, category, baseCost, buildTimeSeconds, prerequisites: Prerequisite[] }` — from data.ts + PREREQUISITES.
3. Invariants (test): buildCost/upgradeCost mirror locked formulas (exact values for sample levels); prerequisitesMet/canBuild ladder (each reason fires in order); unknown structure handling; maxLevel validation; validateGrid tamper-catching (missing key, negative, non-integer, unknown key, over-max); structureSummary shape; determinism; immutability.

TESTS (vitest, tests/framework.test.ts, ~26-32): all invariants + edges (zero level, max level, prereq exactly met).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/framework.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (prereq source: DESIGN vs draft flag).
