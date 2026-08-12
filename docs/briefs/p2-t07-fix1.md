TASK (StarBaron P2-T07, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/player/transfer.ts ONLY.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no behavior changes.

CODEX FINDING (fix exactly this):
[src/sim/player/transfer.ts:1,5] Imports violate the authorised boundary: `BodyId` from '../world/identity' and `StructureGrid` from './types' are not in the permitted set. Fix: derive the body-id type from `OwnershipRecord['bodyId']` (already imported from ownership) and define the structural grid alias locally as `Record<StructureId, number>` using the permitted `StructureId` import (from structures/types).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/transfer.test.ts` all pass. Report changed imports + results.
