READ-ONLY AUDIT — StarBaron P7-T05 (master roadmap): Population Casualties.

READ LIST:
- src/sim/combat/casualties.ts    (NEW — under audit)
- tests/casualties.test.ts        (NEW — test suite)
- src/sim/combat/resolution.ts    (P7-T03: BattleOutcome — survivors/defenderCasualties DELEGATED)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 45cd9023f4418ec0ac7068e2050719413dab1912 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t05-brief.md + master roadmap P7-T05):
1. CasualtyLedger { attackerId, targetId, battleId, resolvedAt, attacker {troopsCommitted, survivors, populationLoss (= committed − survivors — DESIGN: committed lost whether win or lose), fleetLost (defeat only)}, defender {populationLoss (= outcome.defenderCasualties — DELEGATED), garrisonLoss (victory → full garrison; defeat → floor(garrison×0.2) DEFENDER_GARRISON_LOSS_RATE; stalemate → 0 — pinned)}, result }.
2. applyCasualties: survivors/defenderCasualties EXACTLY from the constructed BattleOutcome (no recompute); throws when defenderCasualties > defenderPopulationBefore; attackers' survivors RETURN (documented).
3. attackerPopulationImpact { totalPopulationLost, survivorsReturned }; casualtyReport deterministic ('2,000 troops lost · 3,000 returned home · defenders lost 850').
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ combat/resolution + ui/validate + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Delegation (survivors/defenderCasualties mirrored verbatim from a constructed outcome — no re-derivation); populationLoss = committed − survivors (hand-compute victory 5,000→3,500 → 1,500).
C. fleetLost (defeat only); garrisonLoss mapping per result (victory full, defeat 20%, stalemate 0) + flooring + zero-garrison edge; defender population guard.
D. attackerPopulationImpact; casualtyReport; validation; immutability; determinism.
E. Tests ~37 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
