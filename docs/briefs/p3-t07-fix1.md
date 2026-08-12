TASK (StarBaron P3-T07, Codex FAIL round 1 — FIX ONLY THESE 3 FINDINGS, no broadening):

ALLOWED FILES: src/sim/structures/queues.ts, tests/queues.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDINGS (fix exactly these):

1. [src/sim/structures/queues.ts:111-133] queueConstruction accepts invalid level values: `fromLevel: -1`, `toLevel: 0`, fractional levels (and a matching grid) pass the step/grid checks and enqueue invalid jobs. Fix: validate `fromLevel` and `toLevel` as FINITE NON-NEGATIVE INTEGERS (Number.isInteger + >= 0) BEFORE computing cost / calling canBuild; throw descriptive Error on violation. Also validate the grid's level for the structure the same way at enqueue (grid[structure] must be a finite non-negative integer AND equal fromLevel — the grid consistency check).

2. [tests/queues.test.ts:199-208] Add rejection tests: fromLevel -1 → toLevel 0 (with matching grid) throws; fromLevel 0.5 → toLevel 1.5 throws; grid with a negative level for the structure throws.

3. [src/sim/structures/queues.ts:161] `finishesAt` can silently overflow: startedAt = Number.MAX_VALUE + duration → finishesAt === startedAt (not strictly greater). Fix: compute finishesAt = startedAt + durationMs; reject unless Number.isFinite(finishesAt) AND finishesAt > startedAt (throw descriptive Error). Add a regression test with a large finite startedAt (e.g. Number.MAX_VALUE / 2 and Number.MAX_VALUE).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/queues.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which finding.
