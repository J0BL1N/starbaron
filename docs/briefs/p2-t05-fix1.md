TASK (StarBaron P2-T05, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/player/territory.ts ONLY.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no behavior changes.

CODEX FINDING (fix exactly this):
[src/sim/player/territory.ts:73] A comment contains the banned token `any` ("never any owner field"). Reword to avoid the exact token (e.g. "never an owner field").

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/territory.test.ts` all pass. Report changed line + results.
