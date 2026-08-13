TASK (StarBaron P7-T11, master roadmap): ATTACK NOTIFICATIONS — incoming attack + ETA: the notification model for attacks (the P4-T07 notification state for combat events — attack launched against you, ETA, arrival, battle result). (Pure UI-state contract over the combat chain.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/ui/notifications.ts (P4-T07): NotificationState, addNotification, unreadCount — THE locked notification model (read/reaction/dedup/expiry).
- src/sim/combat/attack-orders.ts (P7-T01): AttackOrder (arrivalAt, status).
- src/sim/combat/resolution.ts (P7-T03): BattleOutcome (result).
- src/sim/combat/combat-reports.ts (P7-T09 — READ IF PRESENT): CombatReport (reportText).
- src/sim/ui/validate.ts: assertPositiveAt.
- src/sim/planets/hash.ts: fnv1a.

ALLOWED FILES (create ONLY):
- src/sim/ui/attack-notifications.ts
- tests/attack-notifications.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `AttackNotification = { notificationId: string; kind: 'incoming-attack' | 'attack-arrived' | 'battle-result'; orderId: string; targetId: string; at: number; etaSeconds: number | null; message: string }` — notificationId = fnv1a(`${kind}|${orderId}|${at}`).
2. Pure functions:
   - `incomingAttackNotification(order: AttackOrder, at: number): AttackNotification` — kind 'incoming-attack'; message deterministic ('INCOMING ATTACK on HD 564 b — ETA 2h 14m' — floored h/m like the intel age-label conventions); etaSeconds = floor((order.arrivalAt − at) / 1000) (validated ≥ 0; order must be launched/traveling — arrived/resolved throw).
   - `attackArrivedNotification(order: AttackOrder, at: number): AttackNotification` — kind 'attack-arrived'; message 'ATTACK ARRIVED on HD 564 b — defenders engaged'; requires at >= order.arrivalAt (else throw — the arrival boundary, half-open like positioning).
   - `battleResultNotification(input: { orderId: string; targetId: string; result: 'victory' | 'defeat' | 'stalemate'; attackerWon: boolean; at: number }): AttackNotification` — kind 'battle-result'; message deterministic per result ('VICTORY — you repelled the attack on HD 564 b' / 'DEFEAT — HD 564 b fell to the attackers' / 'STALEMATE — attackers withdrew from HD 564 b'; attackerWon flips the perspective — document the caller passes whether the DEFENDER won).
   - `attackNotificationState(notifications: readonly AttackNotification[], at: number): { count: number; unread: number; latest: AttackNotification | null }` — the projection the HUD consumes (count, unread via the P4 unread semantics — DELEGATE to the notifications module's unread computation IF there is a shared helper, else mirror the P4 convention and document).
3. Invariants (test): incoming ETA math (hand-computed: arrival in 2h 14m → etaSeconds 8040, message floored); boundary (at == arrivalAt → arrived not incoming — throw); id determinism; battle-result perspective flip; notificationState projection; validation; immutability; determinism.

TESTS (vitest, tests/attack-notifications.test.ts, ~24-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/attack-notifications.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (the HUD wiring → P12 UI; the notification store feed → P10).
