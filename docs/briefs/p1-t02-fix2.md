TASK (StarBaron P1-T02, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/world/galaxy.ts, tests/galaxy-model.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no signature/format changes.

CODEX FINDING (fix exactly this):
[src/sim/world/galaxy.ts:158] registerSystem's duplicate path returns a new record but ALIASES the systemIds array (`systemIds: galaxy.systemIds`), so mutating the returned record can mutate the input record. Fix: return `systemIds: [...galaxy.systemIds]` on the duplicate path, and add a duplicate-path aliasing regression test (mutate the returned record's systemIds array, assert the input record's array is unchanged) near the existing duplicate tests in tests/galaxy-model.test.ts.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/galaxy-model.test.ts` all pass (report counts, now 29+). Report changed lines + results.
