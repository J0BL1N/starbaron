TASK (StarBaron P1-T02, Codex FAIL round 1 — FIX ONLY FINDING 3, no broadening):

ALLOWED FILES: src/sim/world/galaxy.ts ONLY (tests untouched).

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no format/signature changes, do NOT remove the ../planets/hash import (that finding was a spec error on our side — the import is permitted).

CODEX FINDING (fix exactly this):
[src/sim/world/galaxy.ts:5] A comment contains the literal tokens `Math.random` and `Date`, so the purity grep matches. Deterministic fix: reword the comment so neither prohibited token appears (e.g. "No nondeterministic APIs or timestamps").

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/galaxy-model.test.ts` all pass. Report changed lines + results.
