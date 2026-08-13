TASK (StarBaron P6-T08, Codex FAIL round 1 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/intel/store.ts, tests/store.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
[store.ts:230,235,247,262] storeInvariants claims to never throw, but calls .trim() and iterates intel.sources WITHOUT runtime type guards — tampered values (ownerId: null, non-string map key/targetId, sources: undefined) THROW instead of returning { ok: false, problems }. Fix: add typeof/iterability guards for: store.ownerId (non-empty string), every map KEY (non-empty string) and every RECORD (object with the right field types), targetId (non-empty string), lastUpdatedAt (number or null), intelLevel (in the ladder), sources (array of non-empty strings — guard before iterating); report invalid types as problem entries (never throw). Add tamper tests: ownerId null, non-string map key, record with undefined sources, record with null level.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/store.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which tamper.
