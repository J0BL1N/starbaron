TASK (StarBaron P1-T07, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/world/reconstruct.ts, tests/reconstruct.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic, no signature/format changes to public APIs.

CODEX FINDINGS (fix exactly these):

1. [src/sim/world/reconstruct.ts:151-159] `deserializeUniverse` never validates `parentOf(system.id) === galaxy.id` — it only checks the declared `system.galaxy` field. A payload with `id: 'sys:other|x'`, `galaxy: 'gal:seed-prime'` (declared), empty bodyIds, and a matching galaxy registry is accepted even though its canonical parent is `gal:other`. Fix: after parsing each system id, compare `parentOf(system.id)` to `system.galaxy` AND to the universe galaxy id; throw descriptive Error on mismatch (consistent with the existing body-chain validation).

2. [tests/reconstruct.test.ts:161-180] Add a negative payload with a parseable system ID rooted under a DIFFERENT galaxy while its declared `galaxy` and registries remain internally consistent — assert `deserializeUniverse` throws.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/reconstruct.test.ts` all pass (report counts). Report changed lines + results + which test covers which finding.
