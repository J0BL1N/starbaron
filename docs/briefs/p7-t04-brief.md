TASK (StarBaron P7-T04, master roadmap): PLANET DEFENSE — the defense model: defense structures (turrets) + population garrison; the LOCKED DP composition (turret defense power + militia per population); defense readiness state. (The defense SIDE of combat — resolution is T03; this module models the defensive capability.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/structures/effects.ts: LOCKED TURRET_DEFENSE_POWER_PER_LEVEL = 500, MILITIA_DEFENSE_PER_POPULATION = 0.15, defensePower(turretLevels, population) — THE locked DP (DELEGATE).
- src/sim/player/estimator.ts: locked defense estimators (READ — a defense-capability helper may exist).
- src/sim/structures/queues.ts (P3-T07): construction (turrets build via queues).
- src/sim/player/accrual.ts: garrison (barracks converts population → garrison; garrison cap).
- src/sim/player/types.ts: OwnedPlanet.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/defense.ts
- tests/defense.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `DefenseState = { planetName: string; turretLevels: number; population: number; garrison: number; defensePower: number; breakdown: { turretPower: number; militiaPower: number; garrisonPower: number } }`.
2. Pure functions:
   - `defenseStateFor(input: { planetName: string; turretLevels: number; population: number; garrison: number }): DefenseState` — defensePower = LOCKED defensePower(turretLevels, population) from effects.ts (DELEGATE — verify its exact semantics: does it include militia? READ it and mirror: if defensePower(turretLevels, population) = turrets + militia, then breakdown.turretPower = turretLevels × 500 (LOCKED const) and militiaPower = defensePower − turretPower; garrisonPower = garrison × GARRISON_DEFENSE_PER_UNIT (draft exported const = 0.1 — documented balance input; the garrison defends too — DESIGN: garrison = home defenders)); defensePower total = locked defensePower + garrisonPower? — CAREFUL: the LOCKED defensePower already includes militia; the garrison is the BARRACKS-converted soldiers — DESIGN's fleet view: "Garrison (home defenders) vs deployed" — garrison defends: total = locked defensePower(turrets, population) + garrison × garrisonDefensePerUnit — DOCUMENT the composition decision and pin it in tests.
   - `readiness(planet: OwnedPlanet-ish input: { turretLevels: number; population: number; garrison: number; fleet: number }): { garrisonCoverage: number; vulnerable: boolean; message: string }` — garrisonCoverage = garrison / (garrison + fleet) (clamped 0..1 — the share at home); vulnerable = garrisonCoverage < 0.5 (more than half the military away — draft threshold READINESS_VULNERABLE_THRESHOLD = 0.5, documented); message deterministic ('Defended · 80% of military at home' / 'VULNERABLE · 30% at home').
   - `defenseSummary(state: DefenseState): string` — deterministic ('3 turrets · 1.5K DP + 200 militia + 500 garrison = 2.2K DP').
3. Invariants (test): defenseStateFor delegation (hand-computed vs the locked defensePower: turrets 3 × 500 + militia 0.15 × 10,000 pop → 1,500 + 1,500; garrison adds its draft power); breakdown consistency (sums); readiness (coverage math + vulnerable threshold); summary; determinism; validation (negative levels/population/garrison).

TESTS (vitest, tests/defense.test.ts, ~26-32): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/defense.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (resolution → T03; garrison deployment mechanics → P5 fleets).
