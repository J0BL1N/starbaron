READ-ONLY AUDIT — StarBaron P7-T11 (master roadmap): Attack Notifications.

READ LIST:
- src/sim/ui/attack-notifications.ts   (NEW — under audit)
- tests/attack-notifications.test.ts   (NEW — test suite)
- src/sim/combat/attack-orders.ts      (P7-T01: AttackOrder)
- src/sim/ui/notifications.ts          (P4-T07: the locked notification conventions)
- src/sim/planets/hash.ts              (fnv1a)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = the CURRENT state of src/sim/ui/attack-notifications.ts + tests/attack-notifications.test.ts on staging (HEAD; the feat commit covers exactly these two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t11-brief.md + master roadmap P7-T11):
1. AttackNotification { notificationId (fnv1a(kind|orderId|at)), kind incoming-attack|attack-arrived|battle-result, orderId, targetId, at, etaSeconds|null, message }.
2. incomingAttackNotification: ETA floor((arrivalAt−at)/1000); message floored h/m ('INCOMING ATTACK on HD 564 b — ETA 2h 14m'); in-flight only (arrived/resolved throw); half-open at < arrivalAt.
3. attackArrivedNotification (at >= arrivalAt else throw; etaSeconds null); battleResultNotification (defender-perspective messages + attackerWon flip + result-consistency); attackNotificationState (count/unread/latest, deterministic tie-break; unread mirrors the P4 new-items convention — documented).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ combat/attack-orders + ui/notifications (types) + ui/validate + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. ETA math (hand-computed 8040s → 'ETA 2h 14m'); boundaries (at == arrivalAt throws; arrived requires at >= arrivalAt); in-flight-only guard.
C. battle-result perspective flip + consistency throws; projection (count/unread/latest, tie-break); message strings deterministic.
D. Validation; immutability; determinism; tests ~31 covering.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
