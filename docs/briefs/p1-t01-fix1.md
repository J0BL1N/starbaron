TASK (StarBaron P1-T01, Codex FAIL correction — FIX ONLY THE LISTED FINDINGS, no broadening):

ALLOWED FILES: src/sim/world/identity.ts, tests/identity.test.ts (both already exist — modify them). Do NOT touch any other file.

RESTRICTIONS: same as original brief — no Math.random, no `any`, strict TS, no UI/DB/rendering changes, determinism mandatory. Do not change the ID string formats or public function signatures.

CODEX FINDINGS (fix exactly these):

1. [src/sim/world/identity.ts:77-82] `bodyId` brands and returns IDs with invalid ordinals such as `-1`, `NaN`, or `2.5`, while `parseCanonicalId` correctly rejects those forms. This violates canonical construction and the round-trip invariant. Validate `ordinal` as a finite non-negative integer before constructing the `BodyId`, with focused tests.

2. [src/sim/world/identity.ts:69-74] `galaxyId` and `systemId` can construct strings their own parser rejects — for example `galaxyId('')`, `systemId('a', '')`, or `systemId('a|b', 'c')`. Validate/reject empty or delimiter-containing segments (or otherwise encode them consistently) so every factory output is canonical and parseable.

EXPECTED BEHAVIOUR AFTER FIX:
- Every ID produced by galaxyId/systemId/bodyId must parse back via parseCanonicalId with { ok: true } — the factory-output-canonical invariant holds for ALL inputs (invalid inputs are rejected — decide and document: factories either throw a descriptive Error for invalid segments/ordinals, or the brief permits returning the {ok:false} style — PREFER: throw new Error('...') with a clear message for invalid factory input, since factories are programmer-facing; parseCanonicalId keeps returning {ok:false,reason} and never throws for arbitrary strings).
- Add focused tests: galaxyId('') throws; systemId('a','') throws; systemId('a|b','c') throws; bodyId(sys,'planet',-1) throws; bodyId(sys,'planet',2.5) throws; bodyId(sys,'planet',NaN) throws; valid inputs still construct + round-trip.

VERIFY AND REPORT: `npx tsc -b` exit 0; `npx vitest run tests/identity.test.ts` all pass (report counts — the suite should now be ~30 tests); report changed lines, commands + results, and confirm both Codex findings are addressed (state which test covers which finding).
