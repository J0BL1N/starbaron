TASK (StarBaron P3-T06, master roadmap): PRODUCTION STRUCTURES — credit production, alloy production, rate formulas, structure levels, planet efficiency modifiers, production summary API.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/structures/effects.ts: LOCKED rate constants (ORE_ALLOYS_PER_MIN=5, TRADE_HUB_INCOME_MULTIPLIER_PER_LEVEL=0.1, SHIPYARD_INCOME_PER_MIN=50) + structureEffect(id, level) — the rate formulas are LOCKED; wrap them.
- src/sim/player/accrual.ts: accruePlayer, planetTotals, empireRates, computePlanetDerived — READ planetTotals/computePlanetDerived: they encode the planet efficiency modifiers (tier multiplier, denseCore/hotStar quirks — diminishing returns above level 10). MIRROR the modifier semantics exactly (they're the locked production path).
- src/sim/structures/types.ts: StructureId, StructureEffect.
- src/sim/player/types.ts: OwnedPlanet { tier }.
- src/sim/planets/quirks.ts: QuirkId (denseCore, hotStar…).

ALLOWED FILES (create ONLY):
- src/sim/structures/production.ts
- tests/production.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring. Do NOT re-derive any locked formula — delegate to effects.ts/accrual.ts where they exist; production.ts is the SUMMARY/wrapper layer.

DESIGN SPEC:
1. `ProductionRates = { creditsPerSec: number; alloysPerSec: number }`.
2. `StructureProduction = { structure: StructureId; level: number; creditsPerSec: number; alloysPerSec: number; description: string }`.
3. `ProductionSummary = { planet: { name: string; tier: number }; total: ProductionRates; perStructure: StructureProduction[] }`.
4. Pure functions:
   - `structureRates(structure: StructureId, level: number): ProductionRates` — from structureEffect(id, level) (LOCKED): credits from trade hub (baseline income multiplier × planet tier baseline — READ how accrual combines baselinePassiveIncome(tier) with TRADE_HUB multiplier) and shipyard income; alloys from ore mine (ORE_ALLOYS_PER_MIN/60 per level — READ accrual for the exact per-level math; mirror it).
   - `planetEfficiency(tier: number, quirks: readonly QuirkId[]): number` — the combined planet efficiency modifier from the LOCKED accrual path (READ computePlanetDerived/planetTotals: tier multiplier + quirk modifiers + diminishing returns; mirror the exact composition or delegate to the accrual function if importable — PREFER delegating to the existing locked function when its signature fits; document).
   - `productionSummaryFor(input: { name: string; tier: number; quirks?: readonly QuirkId[]; grid: Record<StructureId, number> }): ProductionSummary` — per-structure rates × planetEfficiency, totals summed, perStructure sorted by structure id; description from data.ts.
5. Invariants (test): structureRates mirror effects.ts exactly (hand-computed: ore mine Lv 3 → 5×3/60 per sec; trade hub Lv 2 → 0.1×2 multiplier on the tier baseline — READ accrual for the exact baseline composition and assert the SAME number); planetEfficiency matches the locked path for tier 1/3/5 + quirk combos; summary totals = sum of per-structure × efficiency; ordering; determinism; empty grid → zero rates; validation (bad tier, unknown structure).

TESTS (vitest, tests/production.test.ts, ~24-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/production.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (which locked functions were delegated to vs mirrored).
