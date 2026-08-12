TASK (StarBaron PHASE 1 whole-phase audit FAIL round 2 — FIX ALL 3 FINDINGS, no broadening; this closes Phase 1):

ALLOWED FILES (ONLY): src/sim/world/galaxy.ts, src/sim/world/system.ts, src/sim/world/body.ts, src/sim/world/api.ts, src/sim/world/catalogue.ts, src/sim/world/reconstruct.ts, supabase/migrations/0013_world_schema.sql, and their test files (tests/galaxy-model.test.ts, tests/system-model.test.ts, tests/body-model.test.ts, tests/api.test.ts, tests/catalogue.test.ts, tests/reconstruct.test.ts, supabase/tests/07_world_schema.sql). Do NOT touch anything else. You MAY create ONE new file: src/sim/world/trust.ts.

RESTRICTIONS: purity preserved; no `any`; strict TS; deterministic; NO literal banned tokens in comments (e.g. avoid the exact phrases the audits flag: "shared mutable data", "global state", "Math.random" — write "nondeterministic APIs", "module-level mutable state", "randomness" instead). SQL remains write-only (no supabase commands).

FINDINGS (fix exactly these):

1. [T01/T06 — supabase/migrations/0013_world_schema.sql:66-80, 91-109, 126-150] SQL does not enforce the canonical ID grammar: world_galaxies.id accepts anything; system/body CHECKs only verify a prefix, so extra segments, empty seeds, and mismatches between embedded seed/ordinal and the `seed`/`ordinal` columns are accepted. Fix:
   - world_galaxies.id CHECK: `id ~ '^gal:[^|]+$'`
   - world_systems.id CHECK: `id ~ '^sys:[^|]+\|[^|]+$'` AND the embedded seed segment (after the second '|') equals the `seed` column (compare via split_part(id, '|', 2) = seed).
   - world_bodies.id CHECK: `id ~ '^body:[^|]+\|[^|]+\|(star|planet|moon|asteroid)\|[0-9]+$'` AND split_part(id, '|', 3) = type AND split_part(id, '|', 4)::bigint = ordinal.
   - Keep the existing parent-derived prefix checks.
   - Add negative SQL tests in supabase/tests/07_world_schema.sql: gal with '|' → check_violation; sys with embedded seed != seed column → check_violation; body with non-numeric ordinal or type/ordinal mismatch → check_violation; body with extra '|' segment → check_violation.

2. [T01/T08 — src/sim/world/api.ts:87-89, 140-146, 190-196] List/region API paths bypass canonical validation: queryBodiesBySystem uses a hand-rolled prefix match instead of parseCanonicalId/parentOf (a malformed id with the right prefix gets returned); regionQuery returns spatial systems without resolveSystem (parent-chain-invalid registered/unregistered systems can be emitted). Fix: replace the prefix helper with parse + `parentOf(id) === systemId`; construct region systems through the canonical resolver (resolveSystem/querySystemsByGalaxy semantics) before projecting bodies. Add malformed-id and contradictory-region tests (system registered but parent-chain-invalid → excluded from region results).

3. [T02-T07 — src/sim/world/galaxy.ts, system.ts, body.ts + 0013 SQL] The real-data policy is still provenance-shaped, not source-of-construction: any caller can pass realData:true with an arbitrary 'nasa-exoplanet-archive-' string; SQL permits real_data=true with provenance='procedural'. Fix — implement the branded construction capability:
   - Create src/sim/world/trust.ts exporting `const CATALOGUE_TRUST = Symbol('catalogueTrust')` and `export interface CatalogueTrust { [CATALOGUE_TRUST]: true }` (typed, single-symbol).
   - In galaxy.ts/system.ts/body.ts: REMOVE public realData/provenance elevation — factories now REQUIRE a `trust: CatalogueTrust` argument to set realData:true (throw descriptive Error otherwise; realData defaults false + provenance 'procedural' without trust). Keep existing signatures working for procedural construction (no trust arg needed → procedural defaults).
   - In catalogue.ts: import CATALOGUE_TRUST and pass a trust token when building catalogue records (the ONLY legitimate source). reconstruct.ts keeps passing through whatever catalogue produces (no change needed beyond compiling).
   - SQL: add CHECKs — `CHECK (NOT real_data OR provenance LIKE 'nasa-exoplanet-archive-%')` and `CHECK (real_data OR provenance = 'procedural')` on all three tables (provenance/flag consistency enforced at rest).
   - Bypass-regression tests: attempting realData:true without the trust token throws in all three factories; SQL fixture inserting real_data=true + provenance='procedural' → check_violation.

VERIFY (focused per-file runs only): `npx tsc -b` exit 0; `npx vitest run tests/galaxy-model.test.ts tests/system-model.test.ts tests/body-model.test.ts tests/catalogue.test.ts tests/api.test.ts tests/reconstruct.test.ts` all pass (report per-file counts); SQL static read-back only.

REPORT: per-finding changed lines + which test covers which finding + any signature changes.
