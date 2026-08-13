READ-ONLY AUDIT — StarBaron P7-T10 (master roadmap): Combat Simulation Harness.

READ LIST:
- src/sim/combat/sim-harness.ts      (NEW — under audit)
- tests/sim-harness.test.ts          (NEW — test suite)
- src/sim/combat/attack-orders.ts    (P7-T01: attackLaunchCost)
- src/sim/fleet/movement.ts          (P5-T04: travelDuration — seconds unit)
- src/sim/combat/resolution.ts       (P7-T03: resolveBattle)
- src/sim/combat/casualties.ts       (P7-T05: applyCasualties)
- src/sim/combat/conquest-cost.ts    (P7-T06: conquestCostFor)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = the CURRENT state of src/sim/combat/sim-harness.ts + tests/sim-harness.test.ts on staging (HEAD; the feat commit covers exactly these two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t10-brief.md + master roadmap P7-T10):
1. BattleScenario (full input envelope) → ScenarioResult { outcome, ledger, cost|null (victory only), captured, travelSeconds, launchCost, report }.
2. runScenario: the FULL CHAIN all DELEGATED (launchCost → attackLaunchCost; travelSeconds → movement.travelDuration; outcome → resolveBattle; ledger → applyCasualties; cost → conquestCostFor on victory); captured = victory; report = the deterministic one-liner matching the worked example ('VICTORY · 1,300 cr launch · 12h travel · 1,500 troops lost').
3. scenarioTable (deterministic, byte-wise sort — no localeCompare); replayCheck (field-by-field, firstDifference path, identical flag).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ combat/* + fleet/movement + ui/validate + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Chain delegation (every step via the locked modules — spot-check each call; no re-derived formulas); unit consistency (travel seconds vs epoch-ms at — documented).
C. Worked example (5,000 troops × tier 2 = 10,000 AP vs 3,000 DP → victory; launch 1,300 cr; 12h travel at 1.0 pc/s over 43,200 pc? — verify the fixture numbers are internally consistent); losing + stalemate scenarios.
D. replayCheck: identical for same input (determinism); tampered rerun → identical false + firstDifference names the field; scenarioTable sorted + deterministic; validation; immutability.
E. Tests ~35 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
