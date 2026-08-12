TASK (StarBaron P3-T04, Codex FAIL round 2 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/structures/framework.ts ONLY (tests untouched unless a compile fix requires it — prefer type-only changes).

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no behavior changes.

CODEX FINDING (fix exactly this):
[src/sim/structures/framework.ts:3] `StructureGrid` is imported from '../player/types', outside the authorised import set. Fix: import the type from '../player/grid' (check grid.ts re-exports it; if grid.ts does NOT export the type, use a LOCAL structural type — `Record<StructureId, number>` via the already-permitted structures/types import — and document). Prefer the local structural type if grid.ts lacks the re-export.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/framework.test.ts --pool threads` all pass. Report changed line + results.
