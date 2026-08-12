TASK (StarBaron P3-T05, master roadmap): HOUSING — canonical housing model: cap bonus, growth bonus, upgrade curve, planet modifiers, offline calculation, UI-ready state.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/core/population.ts: LOCKED HOUSING_CAP_MULTIPLIER=0.2, HOUSING_GROWTH_PER_LEVEL=2, populationCap(housingLevels) — the formulas are LOCKED; wrap them.
- src/sim/structures/effects.ts: housing effect semantics (pop cap + growth per level).
- src/sim/structures/framework.ts (P3-T04): upgradeCost, structureSummary, PREREQUISITES (housing has none).
- src/sim/core/population-model.ts (P3-T03): PopulationState, snapshotAt, applyGrowth.
- src/sim/core/offline.ts: offline accrual conventions (READ it).
- src/sim/player/types.ts: OwnedPlanet.populationCapMultiplier (tier modifier).

ALLOWED FILES (create ONLY):
- src/sim/structures/housing.ts
- tests/housing.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `HousingSnapshot = { level: number; capBonus: number; growthBonus: number; nextUpgradeCost: number; at: number }`.
2. Pure functions:
   - `housingCapBonus(level: number): number` — WRAP the locked formula: the cap bonus contributed by housing = populationCap(level) - BASE_POPULATION_CAP (verify population.ts's populationCap shape — it may take only housing levels; read it and mirror exactly; throw on non-integer/negative level).
   - `housingGrowthBonus(level: number): number` — the locked per-level growth contribution (HOUSING_GROWTH_PER_LEVEL × level — VERIFY against population.ts/effects.ts).
   - `housingCap(level: number, planetMultiplier: number): number` — populationCap(level) × planetMultiplier (locked formula × tier modifier; validate multiplier > 0 finite).
   - `housingUpgradeCost(currentLevel: number): number` — delegates to framework.upgradeCost('housing', currentLevel) — the LOCKED cost curve.
   - `housingSnapshot(level: number, planetMultiplier: number, at: number): HousingSnapshot` — all of the above + nextUpgradeCost; at finite > 0.
   - `offlineHousingOutcome(state: PopulationState, at: number): PopulationState` — the roadmap's 'offline calculation': applyGrowth(state, at) wrapped for housing-bearing planets — BUT housing levels are NOT in PopulationState (locked shape) — so make it `offlineHousingOutcome(state: PopulationState, at: number)` = applyGrowth (document: housing enters via the caller's levels; this wrapper exists to bind the offline contract — OR better: `offlineGrowth(state, housingLevels, hydroponicsLevels, at)` computing snapshot with the right growth rate then applying; pick the design that uses the locked pieces correctly — document the choice).
   - `housingUiState(level: number, planetMultiplier: number): { level, capBonus, growthBonus, nextUpgradeCost, display: string }` — UI-ready (display string e.g. '+1,000 pop cap · +2/s').
3. Invariants (test): wrappers match locked formulas EXACTLY (hand-computed samples: level 0, 3, 10); planet multiplier math; upgradeCost delegates; snapshot fields; offline outcome == applyGrowth result for the same inputs; UiState shape; validation throws (negative level, bad multiplier, bad at); determinism; immutability.

TESTS (vitest, tests/housing.test.ts, ~22-28): all invariants + edges (level 0, max level, multiplier 1/1.4).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/housing.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (locked-formula verification notes).
