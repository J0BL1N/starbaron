TASK (StarBaron P1-T08, Codex FAIL round 1 — FIX ONLY THESE 4 FINDINGS, no broadening):

ALLOWED FILES: src/sim/world/api.ts, tests/api.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic, no public signature changes.

CODEX FINDINGS (fix exactly these):

1. [src/sim/world/api.ts:6] A comment contains the banned literal phrase `shared mutable data`. Reword the purity JSDoc without that exact phrase (e.g. "free of mutable module-level state").

2. [src/sim/world/api.ts:153,164,243,250,259] Projections retain MUTABLE references from UniverseState (`position` and `orbit` objects) — a consumer mutating a returned summary/payload mutates the supplied state. Fix: clone nested objects before returning them (`{ ...position }`, `{ ...orbit }` — shallow clone is enough since those are flat numeric objects), in every summary AND rendererPayload path. Add mutation-isolation tests: mutate the returned payload's position/orbit, assert the state's records are unchanged (and vice versa).

3. [src/sim/world/api.ts:69-74] queryBodiesBySystem doesn't verify the system exists before filtering — an inconsistent state with an orphan body whose `system` equals the requested absent id returns that body instead of []. Fix: first verify the system id is present in the state (or derive membership from the galaxy registry), then filter bodies.

4. [tests/api.test.ts:165-170,197-213] Ordering tests don't prove ordering — fixture storage and registry order are both ALPHA,BETA and the region body result is re-sorted before assertion. Fix: build fixtures with DELIBERATELY CONFLICTING orders (e.g. storage order BETA,ALPHA vs registry order ALPHA,BETA; region bodies in scrambled id order) and assert the API's returned order directly without re-sorting.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/api.test.ts` all pass (report counts). Report changed lines + results + which test covers which finding.
