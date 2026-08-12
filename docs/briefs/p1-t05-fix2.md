TASK (StarBaron P1-T05, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/world/catalogue.ts, tests/catalogue.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDING (fix exactly this):
[src/sim/world/catalogue.ts:281] `validateCatalogue` only verifies that `body.system` names an existing system; it never verifies that the body ID's canonical parent (`parentOf(body.id)`) equals that declared system. A mutation can swap all bodies between two existing systems while preserving valid IDs, counts, host-seed count, and per-group ordinals — validation then incorrectly returns ok:true. Fix: after parsing each body ID, compare its canonical parent to `body.system` and add a problem on mismatch. Add a regression test: two existing systems with swapped body `system` fields → validation reports the mismatch problem(s).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/catalogue.test.ts` all pass (report counts). Report changed lines + results + the new test.
