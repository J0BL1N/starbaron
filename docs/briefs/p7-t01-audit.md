READ-ONLY AUDIT — StarBaron P7-T01 (master roadmap): Attack Orders.

READ LIST:
- src/sim/combat/attack-orders.ts   (NEW — under audit)
- tests/attack-orders.test.ts       (NEW — test suite)
- src/sim/player/estimator.ts       (launchCost — the LOCKED source the module delegates to)
- src/sim/fleet/movement.ts         (P5-T04: arrivalTime — overflow-safe)
- src/sim/planets/hash.ts           (fnv1a)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT df8f472b265eb2fde72a7e3ade52438a675d806f (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t01-brief.md + master roadmap P7-T01):
1. AttackOrder { id (fnv1a(attackerId|fleetId|launchAt|targetId)), attackerId, fleetId, targetRef {kind,id}, troopsCommitted (≤ fleetSize — committed subset), launchAt, arrivalAt (overflow-safe via movement.arrivalTime — DELEGATED), status launched|traveling|arrived|resolving|resolved|aborted, launchCost, outcome pending|victory|defeat|aborted }.
2. attackLaunchCost — DELEGATES to the locked estimator.launchCost (the 0006-seed mirror; consts alias PVP_CONSTANTS); launchAttack (validation: troops positive integer + ≤ fleetSize; wallet sufficiency; arrival math; status 'launched'); attackStatusAt (time projection: at==launchAt→traveling, at==arrivalAt→arrived — half-open, matching positioning conventions; resolved/aborted short-circuit); abortAttack (launched/traveling→aborted; terminal throws).
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ player/estimator + fleet/movement + planets/hash + ui/validate + stdlib + (CONTRACT CORRECTION — pure type): ../player/types (WalletState, type-only); banned comment tokens absent; tables deep-frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Launch cost via the LOCKED estimator (verify the delegation + DESIGN example 5,000-fleet/10pc ≈ 1,300 cr still holds via estimator's constants).
C. troops cap (committed > fleetSize throws); wallet sufficiency; arrival overflow-safe; id determinism.
D. Status windows + boundaries + short-circuits; abort transitions; immutability; determinism.
E. Tests ~36 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
