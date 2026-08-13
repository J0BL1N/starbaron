READ-ONLY AUDIT — StarBaron P7-T04 (master roadmap): Planet Defense.

READ LIST:
- src/sim/combat/defense.ts      (NEW — under audit)
- tests/defense.test.ts          (NEW — test suite)
- src/sim/structures/effects.ts  (LOCKED defensePower(turretLevels, population) = turrets + militia; TURRET_DEFENSE_POWER_PER_LEVEL)
- src/sim/player/estimator.ts    (locked defense estimators — READ for the turret term)
- src/sim/ui/validate.ts         (shared validators)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 9f021ad4fc99b68ed3670267b9f13694ab4d9195 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t04-brief.md + master roadmap P7-T04):
1. DefenseState { planetName, turretLevels, population, garrison, defensePower, breakdown {turretPower (locked 500×effLevel), militiaPower (locked DP − turretPower — never negative/double-counted), garrisonPower (garrison × 0.1 draft)} }; total = locked defensePower + garrisonPower (composition documented — garrison = home defenders).
2. readiness { garrisonCoverage = garrison/(garrison+fleet) clamped, vulnerable = coverage < 0.5 (exact half = defended), message } — fleet is an input; empty military → coverage 0.
3. defenseSummary deterministic via the shared suffix formatter.
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ structures/effects + player/estimator (if needed) + ui/validate + ui/display (suffix formatter if used) + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Delegation: locked defensePower used verbatim (hand-compute 3 turrets × 500 + 0.15 × 10,000 pop = 3,000 locked DP); breakdown consistency (turretPower + militiaPower = locked DP; total = locked + garrison term); no re-derived formulas.
C. readiness math + threshold (exact 0.5 → defended); empty military edge; messages deterministic.
D. summary; validation (negative levels/population/garrison); immutability; determinism.
E. Tests ~52 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
