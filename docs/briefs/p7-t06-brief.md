TASK (StarBaron P7-T06, master roadmap): CONQUEST COST — base cost + empire-size escalation: the escalating cost of taking a planet (DESIGN: "Taking a planet costs a large, escalating cost in population + fleet + credits — not easy, not spammable"; the cost grows with the defender's empire/planet tier and the attacker's repeated conquests). (Pure cost model — T07 applies it.)

CONTEXT — existing code you may READ but NOT modify:
- DESIGN.md §5 (lines ~120-160): conquest costs "a large, escalating cost in population + fleet + credits"; check for a locked cost multiplier in the estimator (READ src/sim/player/estimator.ts fully — launchCost + any conquestCost).
- src/sim/player/ownership.ts (P2-T04): OwnedPlanet/tier.
- src/sim/world/catalogue.ts: planet tiers (tier of the target).
- src/sim/combat/resolution.ts (P7-T03): BattleOutcome.
- src/sim/combat/invasion.ts (P7-T02): InvasionForce.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/conquest-cost.ts
- tests/conquest-cost.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `ConquestCost = { targetId: string; tier: number; base: { population: number; fleet: number; credits: number }; escalation: { multiplier: number; reason: string }; total: { population: number; fleet: number; credits: number } }`.
2. Pure functions:
   - `baseConquestCost(tier: number): { population: number; fleet: number; credits: number }` — READ the estimator/design first: if a LOCKED conquest-cost exists DELEGATE; else draft the DESIGN-true escalating curve: population = 2,000 × tier, fleet = 1,000 × tier, credits = 50,000 × tier (draft exported consts CONQUEST_BASE_POPULATION = 2000, CONQUEST_BASE_FLEET = 1000, CONQUEST_BASE_CREDITS = 50000 — DOCUMENT as balance-harness inputs; tier from the catalogue, tier >= 1).
   - `empireEscalation(attackerConquests: number): { multiplier: number; reason: string }` — the empire-size escalation: each successful conquest raises the next conquest's cost (anti-spam — DESIGN "not spammable"): multiplier = 1 + 0.1 × attackerConquests (exported const EMPIRE_ESCALATION_PER_CONQUEST = 0.1; reason 'recent conquest #N' when attackerConquests > 0 else 'none'); clamp multiplier ≤ 2.0 (max escalation — exported CONQUEST_ESCALATION_CAP = 2.0, documented).
   - `conquestCostFor(input: { targetId: string; tier: number; attackerConquests: number }): ConquestCost` — total = base × multiplier (each component floored); id-free (no hash needed — targetId carried); validation (tier >= 1 integer, attackerConquests >= 0 integer).
   - `conquestCostSummary(cost: ConquestCost): string` — deterministic ('Conquest cost (T4 · ×1.3): 10,400 population · 5,200 fleet · 260K cr').
3. Invariants (test): base math per tier (hand-computed T4 → 8,000 pop / 4,000 fleet / 200K cr); escalation math (0 conquests → ×1.0 'none'; 3 → ×1.3 'recent conquest #3'); cap (attackerConquests 15 → ×2.0); total = base × multiplier (floor each); summary; determinism; validation.

TESTS (vitest, tests/conquest-cost.test.ts, ~26-32): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/conquest-cost.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (application → T07; balance numbers are harness inputs — P10).
