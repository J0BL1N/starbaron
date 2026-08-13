TASK (StarBaron P6-T04, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/intel/missions.ts, tests/missions.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[missions.ts:351-370] A REPORTED mission can re-record EQUAL or LOWER intel. The contract: re-recording is only allowed when `gained` is STRICTLY higher than the mission's recordedLevel (promotion-only re-record). Fix: reject non-promoting re-records (equal or lower gained) with a descriptive Error ('re-record must exceed the recorded level' style); update the module docstring; update tests/missions.test.ts:362-377 — the current test asserts the lower-level re-record SUCCEEDS; change it to assert rejection (throws), and keep a test that a HIGHER-level re-record still succeeds.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/missions.test.ts --pool threads` all pass (report counts). Report changed lines + results.
