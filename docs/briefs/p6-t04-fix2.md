TASK (StarBaron P6-T04, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/intel/missions.ts, tests/missions.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[missions.ts:393-406] abortMission validates `at` but never uses it against the projected lifecycle — a 'launched' mission can be aborted after scanCompletesAt even though missionStatusAt(mission, at) is 'reported' (terminal). Fix: reject stored terminal states (destroyed/failed/reported), then derive missionStatusAt(mission, at) and permit only projected 'launched'/'traveling'/'scanning'; reject projected 'reported' (Error). Add tests: abort at at >= scanCompletesAt on a still-'launched' mission throws; abort within the scan window works.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/missions.test.ts --pool threads` all pass (report counts). Report changed lines + results.
