TASK (StarBaron P1-T05, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/world/catalogue.ts ONLY.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no logic/format changes.

CODEX FINDING (fix exactly this):
[src/sim/world/catalogue.ts:164] `massJup` is copied into `BodyRecord.mass` but the unit is not documented in the implementation. Add a nearby JSDoc/comment stating that for catalogue mappings `BodyRecord.mass` is in Jupiter masses (`massJup`), no kg conversion.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/catalogue.test.ts` all pass. Report changed lines + results.
