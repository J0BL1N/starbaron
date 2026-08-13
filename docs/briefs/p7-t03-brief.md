TASK (StarBaron P7-T03, master roadmap): COMBAT RESOLUTION — attack power vs defense power resolution: the deterministic battle outcome (victory/defeat, surviving troops, who takes the planet). DESIGN's locked AP model: Attack Power (AP) = deployed soldiers (fleet) × shipyard tier; defense power from turrets + militia (READ DESIGN §5 lines ~120-160 + the old combat-era code in src/sim/player/estimator.ts — the estimator may already carry attack/defense resolution: READ it).

CONTEXT — existing code you may READ but NOT modify:
- DESIGN.md §5 (lines ~108-186): AP = deployed soldiers × shipyard tier; Defense Power (DP) = turret defense power + militia (0.15 × population? READ effects.ts MILITIA_DEFENSE_PER_POPULATION + TURRET_DEFENSE_POWER_PER_LEVEL + defensePower() — the LOCKED defense formula); "Taking a planet costs a large, escalating cost in population + fleet + credits — not easy, not spammable".
- src/sim/player/estimator.ts: the locked combat-era estimators (launchCost; possibly attack odds/outcome — READ the whole file; if it has an attack-resolution function, DELEGATE to it).
- src/sim/structures/effects.ts: LOCKED defensePower(turretLevels, population) — the locked DP.
- src/sim/combat/attack-orders.ts (P7-T01): AttackOrder.
- src/sim/combat/invasion.ts (P7-T02): InvasionForce.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/resolution.ts
- tests/resolution.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `BattleOutcome = { battleId: string; attackerId: string; targetId: string; resolvedAt: number; attackPower: number; defensePower: number; victory: boolean; survivingTroops: number; defenderCasualties: number; result: 'victory' | 'defeat' | 'stalemate' }` — battleId = fnv1a(`${attackerId}|${targetId}|${resolvedAt}`) deterministic.
2. Pure functions:
   - `battlePowers(input: { troops: number; shipyardTier: number; turretLevels: number; population: number }): { attackPower: number; defensePower: number }` — attackPower = troops × shipyardTier (DESIGN's LOCKED AP formula — READ estimator.ts first: if a locked AP helper exists DELEGATE; else mirror DESIGN with the formula exported as consts/comment); defensePower = LOCKED defensePower(turretLevels, population) from effects.ts (DELEGATE — never re-derive).
   - `resolveBattle(input: { attackerId: string; targetId: string; troops: number; shipyardTier: number; turretLevels: number; population: number; resolvedAt: number; casualtyRate?: number }): BattleOutcome` — powers via battlePowers; victory = attackPower > defensePower; stalemate = EQUAL (documented — no planet changes hands; defenders hold); defeat = attackPower < defensePower; survivingTroops = victory ? floor(troops × (1 − casualtyRate)) : 0 (casualtyRate default exported const BATTLE_CASUALTY_RATE = 0.3 — the committed troops lost whether win or lose (DESIGN); on defeat ALL committed troops are lost — surviving 0; on stalemate surviving = floor(troops × 0.5)? — NO: keep it simple + DESIGN-true: stalemate → attackers withdraw, surviving = floor(troops × 0.5) — DOCUMENT the choice; defenderCasualties = defeat ? floor(population × 0.2) : 0 (draft DEFENDER_CASUALTY_RATE = 0.2 — documented balance input; victory → defenders take none? NO — defenders take casualties on ANY attack that lands: victory → floor(population × 0.1) (a smaller draft rate) — DOCUMENT both; pick deterministic numbers and pin them).
   - `battleReport(outcome: BattleOutcome): string` — deterministic one-line report ('Victory: 3,500 of 5,000 troops survived · defenders lost 850' style).
3. Invariants (test): battlePowers math (hand-computed: 5,000 troops × tier 2 = 10,000 AP; DP via locked defensePower); victory/stalemate/defeat classification (AP > DP / == / <); survivingTroops math (victory 0.7×, defeat 0, stalemate 0.5×); defenderCasualties per result; battleId determinism; immutability; determinism; validation (bad tier/troops/population/at).

TESTS (vitest, tests/resolution.test.ts, ~30-36): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/resolution.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (who-takes-the-planet handover → T07; escalation/tech modifiers → T09/T11).
