READ-ONLY AUDIT — StarBaron P7-T03 (master roadmap): Combat Resolution.

READ LIST:
- src/sim/combat/resolution.ts   (NEW — under audit)
- tests/resolution.test.ts       (NEW — test suite)
- src/sim/player/estimator.ts    (attackPower — LOCKED AP helper the module delegates to)
- src/sim/structures/effects.ts  (defensePower — LOCKED DP)
- src/sim/combat/attack-orders.ts (P7-T01: id convention)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT fd60484e867b2bbdbca0ddfea457a318e1f62b0c (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t03-brief.md + master roadmap P7-T03):
1. BattleOutcome { battleId (fnv1a(attackerId|targetId|resolvedAt)), attackerId, targetId, resolvedAt, attackPower, defensePower, victory, survivingTroops, defenderCasualties, result victory|defeat|stalemate }.
2. battlePowers: AP via the LOCKED estimator.attackPower(troops, shipyardTier) (DELEGATED — 5,000×tier2 = 10,000); DP via LOCKED effects.defensePower(turretLevels, population) (DELEGATED).
3. resolveBattle: victory AP>DP; stalemate AP==DP (defenders hold — documented); defeat AP<DP; survivors: victory floor(troops×0.7), defeat 0, stalemate floor(troops×0.5) (rates exported consts); defender casualties: victory floor(pop×0.1), defeat floor(pop×0.2), stalemate 0 (draft rates documented).
4. battleReport deterministic (troops optional 2nd arg — documented).
5. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ player/estimator + structures/effects + planets/hash + ui/validate + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. AP/DP delegation (hand-computed via the locked helpers); no re-derived formulas.
C. Result classification (AP>DP / == / <); survivors + defender casualty math per result (hand-computed); battleId determinism.
D. battleReport; validation (bad troops/tier/turrets/population/at); immutability; determinism.
E. Tests ~42 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
