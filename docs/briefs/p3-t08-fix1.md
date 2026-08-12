TASK (StarBaron P3-T08, Codex FAIL round 1 — FIX ONLY THESE 3 FINDINGS, no broadening):

ALLOWED FILES: src/sim/core/offline-model.ts, tests/offline-model.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDINGS (fix exactly these):

1. [src/sim/core/offline-model.ts:5] `emptyStructureLevels` is imported from '../player/grid' — outside the authorised set. Fix: remove that import; when a planet grid is absent, use LOCAL housing/hydroponics defaults (0) directly in the population computation.

2. [src/sim/core/offline-model.ts:43,150] Comments contain banned tokens: `any`, `toLocaleString`, 'locale APIs'. Reword those comments without the identifiers (e.g. "strictly typed", "manual comma grouping", "deterministic number formatting").

3. [src/sim/core/offline-model.ts:115 vs tests:329-349] At `at === lastTickAt` a due construction job is returned (completeDueJobs is inclusive), contradicting the "zero elapsed → zero everything" contract. Fix: in offlineProgress, when elapsedSeconds === 0, return NO completed jobs (completedJobs: [] — zero time → zero progress of any kind; the anti-duplication delta contract holds). Update the boundary test accordingly: at === lastTickAt → completedJobs []; a job whose finishesAt === lastTickAt completes only in a NON-zero window (e.g. at = lastTickAt + 1ms). Document the boundary semantics in the module JSDoc.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/offline-model.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which finding.
