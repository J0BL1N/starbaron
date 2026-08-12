TASK (StarBaron P1-T03, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/world/system.ts ONLY.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no format/signature changes, no other edits.

CODEX FINDING (fix exactly this):
[src/sim/world/system.ts:5] A comment contains the banned purity token phrase `global state`. Deterministic fix: reword the comment so that exact phrase does not appear (e.g. "calculations are self-contained" or similar).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/system-model.test.ts` all pass. Report changed lines + results.
