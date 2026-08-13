READ-ONLY AUDIT — StarBaron P7-T06 (master roadmap): Conquest Cost.

READ LIST:
- src/sim/combat/conquest-cost.ts   (NEW — under audit)
- tests/conquest-cost.test.ts       (NEW — test suite)
- src/sim/player/estimator.ts       (verified: NO locked conquest-cost — launchCost is credits-only launch fee; the curve is drafted as balance-harness input)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT e98e0b0062c0fac4bf27520e0be1e48e575525b5 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t06-brief.md + master roadmap P7-T06):
1. ConquestCost { targetId, tier, base {population, fleet, credits}, escalation {multiplier, reason}, total (= floor(base × multiplier) per component) }.
2. baseConquestCost: population = 2,000×tier (CONQUEST_BASE_POPULATION), fleet = 1,000×tier, credits = 50,000×tier (draft — documented P10 harness inputs; estimator has NO locked conquest-cost).
3. empireEscalation: multiplier = 1 + 0.1×attackerConquests (EMPIRE_ESCALATION_PER_CONQUEST), capped ≤ 2.0 (CONQUEST_ESCALATION_CAP); reason 'recent conquest #N' / 'none'.
4. conquestCostFor (validation: tier ≥ 1 int, attackerConquests ≥ 0 int, targetId non-empty); conquestCostSummary deterministic.
5. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ ui/validate + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Base math per tier (hand-compute T4 → 8,000/4,000/200K); escalation (0 → ×1.0 'none'; 3 → ×1.3; 15 → capped ×2.0); total = floor(base×multiplier) per component.
C. Summary deterministic; validation; immutability; determinism.
D. Tests ~38 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
