TASK (StarBaron P3-T07, master roadmap): CONSTRUCTION QUEUES — start time, finish time, resource reservation, cancellation rules, offline completion, idempotent completion.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/structures/data.ts: buildTimeSec per structure (30-300s).
- src/sim/structures/framework.ts (P3-T04): buildCost, upgradeCost, canBuild.
- src/sim/structures/types.ts: StructureId.
- src/sim/core/transactions.ts (P3-T01): CreditTransaction pattern (validation, immutability).
- src/sim/player/wallet.ts: WalletState.
- DESIGN.md: construction/cancellation rules (refund policy) — READ the construction section; use DESIGN's numbers when present.

ALLOWED FILES (create ONLY):
- src/sim/structures/queues.ts
- tests/queues.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `ConstructionJob = { id: string; structure: StructureId; fromLevel: number; toLevel: number; startedAt: number; finishesAt: number; cost: { credits: number; alloys: number }; status: 'building' | 'complete' | 'cancelled' }`.
2. `ConstructionQueue = { planet: string; jobs: ConstructionJob[] }`.
3. Pure functions:
   - `queueConstruction(input: { planet: string; structure: StructureId; fromLevel: number; toLevel: number; startedAt: number; wallet: WalletState; existingJobs: readonly ConstructionJob[]; grid: Record<StructureId, number> }): { queue: ConstructionQueue; job: ConstructionJob; cost: { credits: number; alloys: number } }`
     - validates: toLevel === fromLevel + 1 (single-level builds); canBuild ladder (prereqs + funds — use framework.canBuild with the wallet; throw descriptive Error mapping reasons); duration = buildTimeSec × level factor (READ DESIGN/data — mirror any level scaling; if none, duration = buildTimeSec at toLevel — document); startedAt finite > 0; finishesAt = startedAt + duration × 1000.
     - RESOURCE RESERVATION: cost returned + the wallet IS NOT debited here (pure model — document: the caller debits via transactions; the queue represents the reservation; validation prevents over-reserving).
     - id = fnv1a(`${planet}|${structure}|${toLevel}|${startedAt}|${index}`) — deterministic; use the shared fnv1a from ../planets/hash.
   - `jobsAt(queue: ConstructionQueue, at: number): ConstructionJob[]` — building jobs with finishesAt <= at (due) + still-building; deterministic order (startedAt then id).
   - `completeDueJobs(queue: ConstructionQueue, at: number): { queue: ConstructionQueue; completed: ConstructionJob[] }` — IDEMPOTENT completion: every building job with finishesAt <= at → status 'complete' (status set ONLY ONCE — a job already 'complete' is never re-completed; the completed array contains only newly-completed jobs); immutable; at >= all finishesAt validated? NO — at just advances; jobs complete when due.
   - `cancelJob(queue: ConstructionQueue, jobId: string, at: number): { queue: ConstructionQueue; refund: { credits: number; alloys: number } }` — cancellation rules per DESIGN (default: full refund of the reserved cost — READ DESIGN; if DESIGN has partial-refund rules, mirror them); cancelled job status 'cancelled'; immutable; unknown jobId throws; a complete job cannot be cancelled (throws).
   - `queueInvariants(queue: ConstructionQueue): { ok: boolean; problems: string[] }` — no duplicate job ids; every job's fields valid (status in union, finishesAt > startedAt, toLevel === fromLevel + 1, cost non-negative); single building job per (structure) at any time? — NO concurrency rule per DESIGN? CHECK DESIGN; if DESIGN allows parallel construction, allow it; document the choice.
4. Invariants (test): enqueue validation (funds, prereqs, level step, bad timestamps); reservation cost correct (buildCost at fromLevel); finishesAt math; due/undue classification; idempotent completion (running twice → second returns no new completions); cancel refund + complete-job-cancel throws; immutability everywhere; determinism; queueInvariants tamper-catching.

TESTS (vitest, tests/queues.test.ts, ~28-34): all invariants + edges (zero-duration edge, many jobs, cancel-after-complete).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/queues.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (DESIGN refund/concurrency decisions).
