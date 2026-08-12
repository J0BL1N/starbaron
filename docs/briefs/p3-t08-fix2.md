TASK (StarBaron P3-T08, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/core/offline-model.ts, tests/offline-model.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS.

CODEX FINDING (fix exactly this):
[src/sim/core/offline-model.ts:215] `validateOfflineResult` accepts a finite NEGATIVE populationByPlanet delta, despite population deltas being non-negative by contract. Fix: reject any population delta < 0 (add a problem entry); add a tamper test with a negative population delta.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/offline-model.test.ts --pool threads` all pass (report counts). Report changed lines + results.
