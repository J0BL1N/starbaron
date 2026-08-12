TASK (StarBaron P4-T06, master roadmap): EMPIRE OVERVIEW — planet list, totals (income/population/fleet/defense), system counts, top planets, all-planets sort/filter. (Pure UI-state contract.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/types.ts: PlayerState { homePlanet, colonies, wallet, structureLevels, lastTickAt }.
- src/sim/player/accrual.ts: planetTotals, empireRates (LOCKED aggregates).
- src/sim/structures/production.ts (P3-T06): productionSummaryFor.
- src/sim/structures/effects.ts: defensePower (locked).
- src/sim/core/population-model.ts (P3-T03): populationCapFor/computePlanetDerived.
- src/sim/ui/planet-panel.ts (P4-T04): PanelSection pattern.
- src/sim/core/format.ts: formatNumber.

ALLOWED FILES (create ONLY):
- src/sim/ui/empire-overview.ts
- tests/empire-overview.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no React wiring. Everything delegates to locked modules.

DESIGN SPEC:
1. `EmpireRow = { name: string; tier: number; isHome: boolean; population: number; income: { creditsPerSec: number; alloysPerSec: number }; defense: number; systemId: string }`.
2. `EmpireOverview = { playerId: string; empireName: string; totals: { planets: number; systems: number; population: number; creditsPerSec: number; alloysPerSec: number; defense: number }; rows: EmpireRow[]; topPlanet: EmpireRow | null; sortedBy: 'population' | 'income' | 'name'; filter: 'all' | 'home' | 'colonies' }`.
   - totals via LOCKED empireRates + planetTotals (credits/alloys/population); systems = distinct system ids of home + colonies (from OwnedPlanet.systemId — READ OwnedPlanet for the field); defense = sum of defensePower per planet; topPlanet = row with max population (tie-break: name).
   - rows: one per planet (home + colonies); tier from OwnedPlanet; defense via locked defensePower(turretLevels, population).
3. Pure functions:
   - `empireOverviewFor(input: { player: PlayerState; at: number }): EmpireOverview` — defaults sortedBy 'population', filter 'all'.
   - `sortEmpire(overview: EmpireOverview, by: 'population' | 'income' | 'name'): EmpireOverview` — immutable; deterministic (secondary tie-break name, then id).
   - `filterEmpire(overview: EmpireOverview, filter: 'all' | 'home' | 'colonies'): EmpireOverview` — immutable; totals RECOMPUTED over the filtered rows (document: totals reflect the visible set).
4. Invariants (test): rows per planet; totals match locked empireRates/planetTotals; systems count distinct; defense sum = locked per-planet sums; topPlanet; sort order (population desc, income desc, name asc — document) + tie-breaks; filter semantics + totals recompute; determinism; validation (bad at).

TESTS (vitest, tests/empire-overview.test.ts, ~26-30): all invariants + edges (0 colonies, single planet, equal populations).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/empire-overview.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
