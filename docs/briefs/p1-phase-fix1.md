TASK (StarBaron PHASE 1 whole-phase audit FAIL — FIX ALL 5 FINDINGS, no broadening; this closes Phase 1):

ALLOWED FILES (ONLY these): src/sim/world/galaxy.ts, src/sim/world/system.ts, src/sim/world/body.ts, src/sim/world/catalogue.ts, src/sim/world/api.ts, supabase/migrations/0013_world_schema.sql, and their test files (tests/galaxy-model.test.ts, tests/system-model.test.ts, tests/body-model.test.ts, tests/catalogue.test.ts, tests/api.test.ts, supabase/tests/07_world_schema.sql). Do NOT touch anything else.

RESTRICTIONS: purity preserved (no nondeterministic APIs, no module-level mutable state — and NO literal banned tokens in comments); no `any`; strict TS; backwards-compatible public APIs where possible (signature extensions allowed, removals not); deterministic.

FINDINGS (fix exactly these):

1. [T06 — supabase/migrations/0013_world_schema.sql:19-23, 74-89, 103-124] SQL does not enforce canonical IDs or embedded parent chains. `UNIQUE (galaxy_id, id)` / `UNIQUE (system_id, id)` are redundant (id is already PK) and permit e.g. `sys:other|seed` under `gal:this`. Fix: add deterministic CHECK constraints tying system ids to their galaxy_id (system id must start with 'sys:' + the galaxy slug embedded in galaxy_id + '|') and body ids to their system_id (body id must start with 'body:' + the system slug+seed embedded in system_id + '|'), plus a CHECK that the body id's type segment matches the `type` column (regexp match on the segment between the 2nd and 3rd '|'). Drop the redundant UNIQUE (galaxy_id,id)/(system_id,id) or keep them as documented belt-and-braces — your call, but the CHECKs are mandatory. Add negative SQL tests to supabase/tests/07_world_schema.sql (insert sys:other|x under gal:this → check_violation; body id whose prefix doesn't match its system_id → check_violation).

2. [T05 — src/sim/world/catalogue.ts:274-285] validateCatalogue parses system ids but never verifies `system.galaxy === mapping.galaxy.id` nor `parentOf(system.id) === system.galaxy`, nor registry membership (every system id present in galaxy.systemIds and vice versa). Fix: add those checks to the problems list + mutation tests (swap a system's galaxy field; drop a system from the galaxy registry → validation reports).

3. [T08 — src/sim/world/api.ts:43-58, 66-79] Lookups trust registries/declared fields: a system/body whose canonical parent disagrees with its declared parent can be returned. Fix: validate parent-chain membership before returning (for the requested id, parse it, check parentOf(id) matches the record's declared parent AND the record is in the right registry); on contradiction return null (lookup semantics) — or reject the state at the boundary; choose ONE and document. Add contradictory-fixture tests (system record whose id encodes a different galaxy than its declared galaxy field → lookup returns null).

4. [T02-T05/T07 — src/sim/world/galaxy.ts:80-101, system.ts:109-137, body.ts:260-290] Procedural factories publicly accept arbitrary realData:true + arbitrary provenance — non-catalogue construction can create records labelled real. Fix: constrain provenance-bearing construction to catalogue/reconstruction internals. Recommended: keep the public factories but validate that realData:true requires provenance to be one of the known catalogue provenance values (e.g. starts with 'nasa-exoplanet-archive-') OR introduce a non-exported trusted marker — pick the simplest consistent scheme, document it, and add negative tests (buildGalaxyRecord({realData: true, provenance: 'procedural'}) throws; same for system/body).

5. [T06 — supabase/migrations/0013_world_schema.sql:63,87,122] `created_at default now()` is persistence metadata the canonical models don't carry. Fix: classify it EXPLICITLY as non-canonical persistence metadata — add a comment block in 0013's header (and amend the module doc contract in the relevant world/*.ts JSDoc if needed) stating: persistence-only columns (created_at) are filled by the DB and excluded from the canonical record contract. Keep the column. Update supabase/tests/07_world_schema.sql header comment to match.

VERIFY (per-file focused runs only — never the full suite):
- `npx tsc -b` exit 0
- `npx vitest run tests/galaxy-model.test.ts tests/system-model.test.ts tests/body-model.test.ts tests/catalogue.test.ts tests/api.test.ts` all pass (report per-file counts)
- SQL: careful static read-back only (no supabase commands; write-only deliverable)

REPORT: per-finding changed lines + which test covers which finding + any signature changes (backwards-compatible only).
