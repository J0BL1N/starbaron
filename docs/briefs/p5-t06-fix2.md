TASK (StarBaron P5-T06, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/fleet/render-state.ts ONLY (comment rewording, no behavior changes).

RESTRICTIONS: unchanged — purity.

CODEX FINDING (fix exactly this):
[render-state.ts:4-7,15,51-52] Comments contain banned tokens: `scene`, `Three.js`, `clock`, literal `any` ("at any timestamp", "no `any`"). Reword all of them without those tokens (e.g. "no rendering-library imports", "each timestamp", "no literal `any` type" → "strictly typed throughout").

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/render-state.test.ts --pool threads` all pass; grep confirms the banned tokens are gone from the file. Report changed lines + results.
