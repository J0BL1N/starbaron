TASK (StarBaron P4-T08, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/ui/layout.ts, tests/layout.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS.

CODEX FINDING (fix exactly this):
[src/sim/ui/layout.ts:97,103,109] Module-scope lookup objects/array are mutable at runtime despite `const` bindings. Fix: make them immutable — `Object.freeze` the objects (with `as const`/readonly typing) and `Object.freeze` the array (or restructure to switch/local logic). Add a purity test: the module-level tables are frozen (Object.isFrozen on each) OR a source-scan test asserting no mutable module-scope containers (mirror the sim-purity.test.ts pattern for this file — pick the approach the repo's purity tests already use).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/layout.test.ts --pool threads` all pass (report counts). Report changed lines + results.
