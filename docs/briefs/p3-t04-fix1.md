TASK (StarBaron P3-T04, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/structures/framework.ts, tests/framework.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no behavior changes to public API.

CODEX FINDING (fix exactly this):
[src/sim/structures/framework.ts:45-48] PREREQUISITES is not DEEPLY frozen: arrays and the table are frozen but each contained `{ structure, minLevel }` object stays mutable — a consumer can mutate `PREREQUISITES.defenseTurret[0].minLevel` and change later canBuild/structureSummary results. Fix: freeze every prerequisite object before freezing its containing array (deep freeze; Object.freeze per object, or a deepFreeze helper). Add a test: mutating `PREREQUISITES.defenseTurret[0].minLevel` throws in strict mode / has no effect, and prerequisitesMet/canBuild results are unchanged.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/framework.test.ts --pool threads` all pass (report counts). Report changed lines + results.
