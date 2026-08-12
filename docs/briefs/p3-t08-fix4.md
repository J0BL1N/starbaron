TASK (StarBaron P3-T08, Codex FAIL round 4 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/core/offline-model.ts ONLY.

RESTRICTIONS: unchanged — purity, no behavior changes.

CODEX FINDING (fix exactly this):
[src/sim/core/offline-model.ts:42,45] Comments contain the banned token `any` (in the English phrases "any kind" and "any `at`"). Reword without that token (e.g. "every kind", "whatever `at` is supplied" → "the supplied `at`").

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/offline-model.test.ts --pool threads` all pass. Report changed lines + results.
