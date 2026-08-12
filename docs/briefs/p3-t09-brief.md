TASK (StarBaron P3-T09, master roadmap): PLANET QUIRKS — formal quirk model: atmosphere effects, gravity effects, star/environment effects, structure modifiers, production modifiers, DETERMINISTIC generation.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/planets/quirks.ts: LOCKED QUIRK_TABLE (7 QuirkDefinition rows), quirkById, triggeredQuirks(entry) (deterministic from density/mass thresholds), pickQuirk(entry, rand) (NONDETERMINISTIC — takes a rand fn).
- src/sim/planets/types.ts: QuirkId, PlanetQuirk.
- src/sim/player/accrual.ts: computePlanetDerived — the LOCKED production-modifier composition (binarySystem→tradeHub, highGravity→oreMine, denseCore→?? — READ it).
- src/sim/planets/hash.ts: fnv1a.
- src/sim/structures/types.ts: StructureId.

ALLOWED FILES (create ONLY):
- src/sim/planets/quirk-model.ts
- tests/quirk-model.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `QuirkEffectSummary = { id: QuirkId; name: string; category: 'atmosphere' | 'gravity' | 'environment' | 'density' | 'star' | 'mass'; structureModifier: { structure: StructureId; multiplier: number } | null; productionModifier: { target: 'trade-hub-credits' | 'ore-mine-alloys' | 'population' | 'none'; multiplier: number } | null; blurb: string }`.
   - Category mapping (documented, deterministic): highGravity/coldStar/hotStar/denseCore/gasGiant/massiveWorld/binarySystem → READ the QUIRK_TABLE blurbs and map each to ONE category (gravity: highGravity; star: coldStar/hotStar; density: denseCore/gasGiant; mass: massiveWorld; environment: binarySystem; atmosphere: NONE in the table — document that atmosphere quirks are a future extension).
   - productionModifier: mirror the LOCKED accrual composition (binarySystem → trade-hub-credits ×1.1; highGravity → ore-mine-alloys ×1.2; others → none — VERIFY the exact numbers in computePlanetDerived and mirror them).
2. `quirkSummary(quirk: PlanetQuirk): QuirkEffectSummary` — from the locked quirk + table.
3. `deterministicQuirks(entry: PlanetCatalogueEntry): PlanetQuirk[]` — DETERMINISTIC generation: triggeredQuirks(entry) (locked thresholds) + a seeded pick for the RANDOM slot (mirror pickQuirk's logic but with a fnv1a-seeded pick: seed = fnv1a(`${entry.name}|quirk`) — implement a tiny local deterministic picker over QUIRK_TABLE (exclude already-triggered ids; pick by seeded index); NEVER take a rand fn).
4. `quirkEffectOn(structure: StructureId, quirks: readonly PlanetQuirk[]): number` — the combined multiplier for a structure from all quirks (product of matching structureModifier multipliers; 1.0 when none).
5. `quirkCategories(quirks: readonly PlanetQuirk[]): { atmosphere: number; gravity: number; environment: number; star: number; density: number; mass: number }` — counts per category.
6. Invariants (test): quirkSummary fields from the locked table (each of the 7); category mapping deterministic; productionModifier mirrors accrual EXACTLY (binary 1.1, highGravity 1.2 — verify numbers); deterministicQuirks: same entry → deep-equal, includes all triggered ones, no duplicates, at most 1 seeded pick; quirkEffectOn product math; determinism everywhere; no rand function anywhere.

TESTS (vitest, tests/quirk-model.test.ts, ~24-30): all invariants + edges (entry with all triggers, entry with none, structure with no quirks → 1.0).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/quirk-model.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (atmosphere category = future extension note).
