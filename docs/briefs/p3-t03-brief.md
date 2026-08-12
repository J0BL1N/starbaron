TASK (StarBaron P3-T03, master roadmap): POPULATION — canonical population model formalization (current population, cap, growth rate, growth modifiers, timestamp recovery, war-loss hooks).

CONTEXT — existing code you may READ but NOT modify:
- src/sim/core/population.ts: BASE_GROWTH_PER_SEC=2, BASE_POPULATION_CAP=5000, HOUSING_CAP_MULTIPLIER=0.2, HOUSING_GROWTH_PER_LEVEL=2, HYDROPONICS_GROWTH_BONUS=0.5, populationCap(housingLevels), populationGrowthPerSec(...) — the EXISTING formulas are LOCKED (read them; new code must use them, not re-derive).
- src/sim/core/offline.ts: offline accrual conventions (timestamp-based).
- src/sim/player/types.ts: OwnedPlanet { population, populationCapMultiplier }.

ALLOWED FILES (create ONLY):
- src/sim/core/population-model.ts
- tests/population-model.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring. The module may IMPORT from ../core/population (existing formulas) and ../player/types (types).

DESIGN SPEC:
1. `PopulationState = { population: number; housingLevels: number; hydroponicsLevels: number; lastTickAt: number }` (per planet; modifiers from structures).
2. `PopulationSnapshot = { population: number; cap: number; growthPerSec: number; at: number }`.
3. Pure functions:
   - `populationCapFor(housingLevels: number, planetMultiplier: number): number` — wraps the EXISTING populationCap formula × planetMultiplier (tier multiplier, e.g. OwnedPlanet.populationCapMultiplier); validate housingLevels >= 0 integer, multiplier > 0 finite; throw descriptive Error otherwise.
   - `growthRateFor(housingLevels: number, hydroponicsLevels: number): number` — the existing populationGrowthPerSec formula (READ it; mirror its inputs exactly).
   - `snapshotAt(state: PopulationState, at: number): PopulationSnapshot` — timestamp recovery: population = clamp(state.population + growthPerSec × (at - lastTickAt), 0, cap); at >= lastTickAt (throw otherwise); at finite.
   - `applyGrowth(state: PopulationState, at: number): PopulationState` — immutably advances the state to `at` (population + cap via snapshotAt, lastTickAt = at).
   - `applyWarLoss(state: PopulationState, fraction: number, at: number): PopulationState` — population × (1 - fraction) with fraction validated [0, 1]; floors at 0; immutably sets lastTickAt = at; this is the P7 war-loss HOOK (pure; combat math is P7).
   - `populationInvariants(state: PopulationState): { ok: boolean; problems: string[] }` — population >= 0 finite, <= cap, lastTickAt finite > 0, levels non-negative integers.
4. Invariants (test): snapshotAt clamps to cap and floors at 0; timestamp recovery across a gap (pop grows by exactly growth × gap); applyGrowth immutability + lastTickAt advance; war loss math (fraction 0 → unchanged, 1 → 0, 0.25 → 75%); populationInvariants catches each tamper; cap formula × multiplier; determinism.

TESTS (vitest, tests/population-model.test.ts, ~24-30): all invariants + edges (at === lastTickAt → no change; huge gap; zero housing).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/population-model.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
