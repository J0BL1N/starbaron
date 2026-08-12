READ-ONLY WHOLE-PHASE AUDIT — StarBaron PHASE 3 (Planet Economy & Structures), cross-task coherence.

READ LIST (all Phase 3 deliverables):
- src/sim/core/transactions.ts + tests/transactions.test.ts       (T01 credits ledger)
- src/sim/core/alloys.ts + tests/alloys.test.ts                   (T02 alloy ledger)
- src/sim/core/population-model.ts + tests/population-model.test.ts (T03 population)
- src/sim/structures/framework.ts + tests/framework.test.ts       (T04 structure framework)
- src/sim/structures/housing.ts + tests/housing.test.ts           (T05 housing)
- src/sim/structures/production.ts + tests/production.test.ts     (T06 production)
- src/sim/structures/queues.ts + tests/queues.test.ts             (T07 construction queues)
- src/sim/core/offline-model.ts + tests/offline-model.test.ts     (T08 offline)
- src/sim/planets/quirk-model.ts + tests/quirk-model.test.ts      (T09 quirks)
- src/sim/balance/harness.ts + tests/harness.test.ts              (T10 balancing harness)
- Locked sources: src/sim/core/economy.ts, population.ts, offline.ts, src/sim/player/accrual.ts, src/sim/structures/effects.ts, data.ts, types.ts, src/sim/planets/quirks.ts, hash.ts

AUDIT TARGET: the whole Phase 3 feature set on staging (through the P3-T10 PASS state, INCLUDING the phase-fix commit 5937b62 which addresses all 8 prior findings). Docs commits OUT OF SCOPE.

CHECK — CROSS-TASK COHERENCE:
A. LOCKED-FORMULA DISCIPLINE: every Phase 3 module WRAPS the locked formulas (economy.ts/population.ts/offline.ts/effects.ts/accrual.ts) — no module re-derives a cost/income/growth formula independently (spot-check transactions, production, housing, queues, offline-model, harness against their locked sources).
B. LEDGER CONSISTENCY: credits (transactions.ts) and alloys (alloys.ts) are SEPARATE ledgers with the SAME validation semantics (amount finite > 0, kind union, insufficient-funds throws, exact-balance ok, immutability, injective ids, -0 nonce rejected); walletInvariants identical; no module mutates wallet directly (caller-owned pattern consistent across colonisation/queues/harness).
C. TIME SEMANTICS: all timestamps are inputs (no wall-clock anywhere in src/sim/** new modules); offline-model banked window (8h) consistent with offline.ts; population-model/offline-model agree on growth application; queues/offline-model agree on completion semantics (zero-elapsed boundary documented).
D. PRODUCTION PIPELINE: production.ts (per-structure rates) ↔ accrual.ts (locked) ↔ harness.ts (simulation) all agree numerically (spot-check the credits identity + a tier/quirk example); quirk-model's productionModifier numbers match accrual's composition (binarySystem 1.1, highGravity 1.2).
E. RESERVATION/SPEND CONTRACT: queues reserve (no debit); harness debits its own ledger; colonisation reports cost; the caller-owned spend pattern is uniform — flag any module that BOTH reserves and debits.
F. DETERMINISM: every new module deterministic (no Math.random/Date/performance/global-state/locale APIs — comments included); fnv1a is the only hash; no module-level MUTABLE state (deep-frozen consts where tables exist).
G. GRID CONTRACT: StructureGrid shape consistent (framework local type vs grid.ts emptyStructureLevels vs harness); validateGrid rules (non-negative integers, known keys, max level) consistent with queues' level validation.
H. GAP SCAN vs the roadmap subtask list: T01-T10 subtasks (base income/structure income/storage/spending/transaction validation/formatting; generation/storage/spending/scarcity/defensive uses/tests; current/cap/growth/modifiers/timestamp recovery/war-loss; ids/levels/build/upgrade/prereqs/placement/backend authority; cap bonus/growth bonus/upgrade curve/modifiers/offline/UI; credit prod/alloy prod/rates/levels/efficiency/summary; start/finish/reservation/cancel/offline completion/idempotent; accrual/growth/construction/cap policy/reconnect/anti-dup; atmosphere/gravity/environment/modifiers/determinism; simulations/curves/time-to-upgrade/progression tests/telemetry) — flag any subtask with NO implementation.
I. No duplicated logic (two modules implementing the same validation/formula differently).

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix, implicated task). PASS → phase-level invariants verified. Keep under ~1300 words.
