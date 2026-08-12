TASK (StarBaron P3-T08, Codex FAIL round 3 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/core/offline-model.ts, tests/offline-model.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS.

CODEX FINDING (fix exactly this):
[src/sim/core/offline-model.ts:206] validateOfflineResult permits an under-banked result (e.g. elapsedSeconds 7200, bankedSeconds 3600, capped true) — not the locked min(elapsed, MAX_OFFLINE_BANK_SECONDS) projection. Fix: after the finite checks, validate `bankedSeconds === Math.min(elapsedSeconds, MAX_OFFLINE_BANK_SECONDS)` exactly (add a problem entry on mismatch); add a tamper test with an under-banked result.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/offline-model.test.ts --pool threads` all pass (report counts). Report changed lines + results.
