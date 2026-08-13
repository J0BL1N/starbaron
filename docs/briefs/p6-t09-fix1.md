TASK (StarBaron P6-T09, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/hover-intel.ts, tests/hover-intel.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[hover-intel.ts:62,65] The module runtime-imports `contractFor` from './info' and world query APIs from '../world/api' — the contract permits ./info + ../world/* only as PURE TYPE imports. Fix: remove those runtime imports and the `valuesForTarget` helper; instead EXTEND the module's input to accept the already-composed gated projection data: add `contractFields: readonly InfoField[]` (the target's contract field set — the caller supplies it) and `values: ReadonlyMap<string, string | number | null>` (the value map the gate projects over) to hoverIntelInfo's input; use them where contractFor/query were used. Update the tests to supply the new inputs (the test fixture already builds the universe/contract — wire it through).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/hover-intel.test.ts --pool threads` all pass (report counts). Report changed lines + results.
