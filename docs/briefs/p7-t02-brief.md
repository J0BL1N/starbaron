TASK (StarBaron P7-T02, master roadmap): INVASION FLEET — the invasion force model: credit cost, population recruitment (DESIGN's locked model: attack cost = population + fleet; troops recruited from population, committed whether win or lose). (Pure model — resolution is T03.)

CONTEXT — existing code you may READ but NOT modify:
- DESIGN.md §5 (lines ~108-160): LOCKED invasion model — attack cost = population + fleet (committed troops lost whether win or lose); garrison cap = 5,000 × Barracks levels; barracks converts civilians → soldiers at 10/sec; fleet cap = 1,000 × Shipyard levels; "launch invasion of 5,000 troops — those 5,000 are gone whether you win or lose".
- src/sim/player/types.ts: PlayerState, OwnedPlanet (population).
- src/sim/fleet/fleet.ts (P5-T03): FleetComposition, fleetCompositionSize.
- src/sim/player/accrual.ts: garrison/fleet caps (locked).
- src/sim/structures/effects.ts: BARRACKS_GARRISON_CAP_PER_LEVEL, BARRACKS_CONVERSION_PER_SEC (locked).
- src/sim/combat/attack-orders.ts (P7-T01 — READ IT: AttackOrder shape; the invasion fleet feeds launchAttack's troopsCommitted).
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/invasion.ts
- tests/invasion.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `InvasionForce = { attackerId: string; troops: number; recruitedFrom: ReadonlyMap<string, number>; fleetSize: number; raisedAt: number; status: 'assembling' | 'ready' | 'committed' | 'destroyed' }` — recruitedFrom = planet name → troops drawn (the recruitment ledger; committed = lost whether win or lose — DESIGN).
2. `RecruitmentResult = { force: InvasionForce; recruitmentCost: { credits: number; population: number }; deficiencies: string[] }`.
3. Pure functions:
   - `recruitTroops(input: { attackerId: string; planets: readonly OwnedPlanet[]; desiredTroops: number; fleetSize: number; raisedAt: number; at: number }): RecruitmentResult` — the recruitment model (mirror DESIGN's locked semantics):
     - desiredTroops positive integer; fleetSize >= 0.
     - available troops = Σ min(planet.population, garrisonCap(planet)) — the recruitable pool (READ accrual/effects for the garrison cap formula — BARRACKS_GARRISON_CAP_PER_LEVEL × barracks level per planet; DELEGATE if a locked helper exists); deficiency = desired − available (deficiencies array 'planet X at cap' when a planet can't contribute its share? — NO, keep it simple: deficiencies = [] when available >= desired; else ['insufficient population: need N, have M']).
     - recruitmentCost = { credits: 0 (the credit cost is the LAUNCH cost — T01; document), population: min(desired, available) } — population is the real price (DESIGN: lives are the real price; document).
     - recruits drawn proportionally across planets (deterministic: larger pools first — sort by available desc, name tie-break; take min(planet share, remaining)).
     - force status 'ready'; fleetSize recorded.
   - `commitInvasion(force: InvasionForce, at: number): InvasionForce` — 'ready' → 'committed' (the troops are gone whether win or lose — the committed marker; assembling/committed throw); at validated.
   - `invasionInvariants(force: InvasionForce): { ok: boolean; problems: string[] }` — troops positive; recruitedFrom sums to troops; fleetSize >= 0; status valid; raisedAt positive finite.
4. Invariants (test): recruitment math (hand-computed 2-planet pool: desired 5,000 across planets with 3,000 + 3,000 caps → 5,000 recruited, 3,000 from the first (tie → name asc? — DEFINE the tie-break: available desc then name asc — document + test); deficiency (desired > available → deficiency message + recruits = available); zero-fleet edge; commitInvasion transitions; invariants tamper classes; immutability; determinism; validation.

TESTS (vitest, tests/invasion.test.ts, ~28-34): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/invasion.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (resolution/combat → T03; garrison cap formula delegated from which locked source).
