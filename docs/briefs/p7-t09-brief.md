TASK (StarBaron P7-T09, master roadmap): COMBAT REPORTS — the battle report: winner/loser, ship losses, the full post-battle summary players see (attack + defense + casualties + capture + cost + ship losses). (Pure report projection over T03/T05/T06/T07 outputs.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/combat/resolution.ts (P7-T03): BattleOutcome (result, attackPower, defensePower, survivingTroops, defenderCasualties).
- src/sim/combat/casualties.ts (P7-T05): CasualtyLedger (attacker/defender losses).
- src/sim/combat/conquest-cost.ts (P7-T06): ConquestCost.
- src/sim/combat/capture.ts (P7-T07 — READ IF PRESENT; captureSummary exists there).
- src/sim/combat/attack-orders.ts (P7-T01): AttackOrder.
- src/sim/core/format.ts: the locked suffix/number formatter.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/combat-reports.ts
- tests/combat-reports.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `CombatReport = { reportId: string; battleId: string; attackerId: string; defenderId: string; targetId: string; resolvedAt: number; result: 'victory' | 'defeat' | 'stalemate'; sections: { winner: string; loser: string | null; shipLosses: { attacker: number; defender: number }; summary: string } }` — reportId = fnv1a(`${battleId}|${resolvedAt}`).
2. Pure functions:
   - `buildCombatReport(input: { outcome: BattleOutcome; ledger: CasualtyLedger; attackerFleetSize: number; defenderFleetSize: number; at: number }): CombatReport` — winner/loser: victory → attacker winner, defender loser; defeat → defender winner, attacker loser; stalemate → winner attacker? NO — stalemate → winner '' (none — 'stalemate — defenders hold'; loser null); shipLosses: attacker = defeat ? attackerFleetSize : floor(attackerFleetSize × (ledger.attacker.populationLoss / max(1, committedTroops))) — NO, keep it simple + deterministic: attacker ship losses = defeat ? attackerFleetSize : floor(attackerFleetSize × casualty ratio from the ledger (populationLoss/committed)); defender ship losses = victory ? defenderFleetSize : floor(defenderFleetSize × garrison loss ratio)? — SIMPLER PINNED MODEL: shipLosses.attacker = outcome.result === 'defeat' ? attackerFleetSize : floor(attackerFleetSize × (1 − outcome.survivingTroops / committedTroops)); shipLosses.defender = outcome.result === 'victory' ? defenderFleetSize : 0 (defenders hold → their ships survive; document). committedTroops = ledger.attacker.troopsCommitted.
   - `reportText(report: CombatReport): string` — the deterministic one-line: 'VICTORY — you took the planet: 2,000 troops lost, 850 defenders fell, fleet losses 120/300' / 'DEFEAT — defenders held: all 5,000 troops lost, fleet destroyed' / 'STALEMATE — defenders hold'.
   - `reportInvariants(report: CombatReport): { ok: boolean; problems: string[] }` — winner/loser consistency with result; shipLosses in [0, fleetSize]; reportId deterministic.
3. Invariants (test): winner/loser mapping per result (incl. stalemate → none); ship losses math (hand-computed victory: 5,000 committed, 3,500 survivors → attacker ships lost 30%; defeat → all attacker ships); defender ships (victory → all lost; defeat/stalemate → 0); reportText per result; reportId determinism; validation; immutability; determinism.

TESTS (vitest, tests/combat-reports.test.ts, ~26-32): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/combat-reports.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (notifications UI → T11; battle feed persistence → P10).
