READ-ONLY AUDIT — StarBaron P7-T09 (master roadmap): Combat Reports.

READ LIST:
- src/sim/combat/combat-reports.ts   (NEW — under audit)
- tests/combat-reports.test.ts       (NEW — test suite)
- src/sim/combat/resolution.ts       (P7-T03: BattleOutcome)
- src/sim/combat/casualties.ts       (P7-T05: CasualtyLedger)
- src/sim/core/format.ts             (locked formatter)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = the CURRENT state of src/sim/combat/combat-reports.ts + tests/combat-reports.test.ts on staging (HEAD; the feat commit covers exactly these two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t09-brief.md + master roadmap P7-T09):
1. CombatReport { reportId (fnv1a(battleId|resolvedAt)), battleId, attackerId, defenderId, targetId, resolvedAt, result victory|defeat|stalemate, sections { winner, loser|null, shipLosses {attacker, defender}, summary } }.
2. buildCombatReport: winner/loser per result (victory → attacker/defender; defeat → defender/attacker; stalemate → '' / null); ship losses: attacker = defeat ? attackerFleetSize : floor(attackerFleetSize × (1 − surviving/committed)); defender = victory ? defenderFleetSize : 0.
3. reportText pinned lines ('VICTORY — you took the planet: …' / 'DEFEAT — defenders held: all 5,000 troops lost, fleet destroyed' / 'STALEMATE — defenders hold'); reportInvariants (id determinism, winner/loser consistency, ship-loss bounds, cross-source battle binding); defenderId added to build input (documented deviation — outcome/ledger carry no defender id).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ combat/resolution + combat/casualties + planets/hash + core/format + ui/validate + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Winner/loser mapping per result (incl. stalemate → none); ship-loss math (hand-computed victory: 5,000 committed, 3,500 survivors → attacker ships 30% lost; defeat → all attacker ships; defender ships victory → all / else 0).
C. reportText pinned strings; reportInvariants; validation (at < resolvedAt throws; bad fleet sizes); immutability; determinism.
D. Tests ~33 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
