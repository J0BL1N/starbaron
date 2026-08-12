TASK (StarBaron P4-T05, master roadmap): SYSTEM OVERVIEW — star summary, planets/moons/asteroids lists, body cards (type, radius, tier, ownership), colonisable flags, system selection. (Pure UI-state contract.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/api.ts (P1-T08): querySystem, queryBodiesBySystem.
- src/sim/world/body.ts, system.ts: record shapes (BodyRecord.radius, type; SystemRecord.starType).
- src/sim/player/territory.ts (P2-T05): ownership overlay payload.
- src/sim/planets/levels.ts: planetTier (locked tier mapping).
- src/sim/player/colonisation.ts: COLONISATION_BASE_COST (locked).
- src/sim/ui/info.ts (P4-T03): InfoField/contractFor pattern.
- src/sim/ui/hover.ts (P4-T02): HoverTarget.
- src/sim/core/format.ts: formatNumber.

ALLOWED FILES (create ONLY):
- src/sim/ui/system-overview.ts
- tests/system-overview.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no React wiring.

DESIGN SPEC:
1. `BodyCard = { id: string; name: string; type: 'star' | 'planet' | 'moon' | 'asteroid'; radiusKm: number; tier: number | null; ownerId: string | null; colonisable: boolean; coloniseCost: number | null }` — tier via locked planetTier (null for non-planets); colonisable = type 'planet' && ownerId null (document: gas giants excluded per DESIGN — if planetTier returns null for them, colonisable false); coloniseCost = COLONISATION_BASE_COST when colonisable else null.
2. `SystemOverview = { systemId: string; systemName: string; starSummary: string; bodies: BodyCard[]; selectedBodyId: string | null }` — bodies ordered deterministically (radius descending — document), starSummary from starType ('G-class star' + body count).
3. Pure functions:
   - `systemOverviewFor(input: { systemId: string; universe: UniverseState; ownership?: ReadonlyMap<string, string>; selectedBodyId?: string | null; at: number }): SystemOverview` — resolve via querySystem/queryBodiesBySystem; starSummary deterministic; body cards (ownership from the map); selectedBodyId passthrough (null when not in the body list).
   - `selectBody(overview: SystemOverview, bodyId: string): SystemOverview` — immutable selection update; unknown bodyId throws.
4. Invariants (test): star summary; body ordering; tier (planet vs non-planet); ownership; colonisable/coloniseCost flags (owned planet, free planet, gas giant/star/asteroid); selection passthrough + selectBody; determinism; validation (bad systemId, bad at).

TESTS (vitest, tests/system-overview.test.ts, ~26-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/system-overview.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
