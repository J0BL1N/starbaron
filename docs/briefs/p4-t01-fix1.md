TASK (StarBaron P4-T01, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/hud.ts, tests/hud.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDING (fix exactly this):
[src/sim/ui/hud.ts:192-195] Raw alert timestamps are not validated — `NaN` yields a non-total sort comparator, so "sorted by at, id" is not guaranteed. Fix: validate each alert.at as a finite number > 0 BEFORE mapping/sorting (throw descriptive Error on violation — consistent with the module's other validation); add negative coverage (NaN alert.at throws).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/hud.test.ts --pool threads` all pass (report counts). Report changed lines + results.
