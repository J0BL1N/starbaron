TASK (StarBaron PHASE 1 whole-phase audit FAIL round 4 — FIX ALL 3 FINDINGS, no broadening; this closes Phase 1):

ALLOWED FILES (ONLY): src/sim/world/identity.ts, src/sim/world/catalogue.ts, src/sim/world/reconstruct.ts, src/sim/world/api.ts (if needed for compile), supabase/migrations/0013_world_schema.sql, supabase/tests/07_world_schema.sql, tests/identity.test.ts, tests/catalogue.test.ts, tests/reconstruct.test.ts. Do NOT touch anything else.

RESTRICTIONS: purity preserved; no `any`; strict TS; deterministic; no literal banned comment tokens; SQL write-only. parseCanonicalId must keep returning {ok:false, reason} for rejected input (never throw).

FINDINGS (fix exactly these):

1. [T01/T06/T07/T08 — src/sim/world/identity.ts:63,153-167 + 0013 SQL:169,207-210] The ordinal grammar is not canonical: `body:gal|sys|planet|01` parses as ordinal 1 but is a DISTINCT ID string from the factory output `...|1` (two ids, same ordinal — violates uniqueness/no-duplicates); ordinals above PostgreSQL integer range (2,147,483,647) are accepted by TS but cannot persist; ordinals above JS safe integer lose precision on parse. Fix:
   - In identity.ts: enforce a normalized, bounded ordinal grammar in BOTH bodyId() and parseCanonicalId(): ordinal text must match `^0$|^[1-9][0-9]*$` (no leading zeros) AND numeric value ≤ 2,147,483,647 (PostgreSQL int4 range). bodyId throws descriptive Error on violations (factory-side, consistent with existing factory validation); parseCanonicalId returns {ok:false, reason} on violations. Export the bounds as consts (e.g. ORDINAL_MAX = 2_147_483_647) so other modules reference them.
   - In 0013: keep/strengthen the SQL ordinal CHECK — `ordinal >= 0 AND ordinal <= 2147483647` and the id-grammar regexp `[0-9]+` stays (leading-zero ids are rejected by the model; SQL column is INTEGER so '01' text can't persist with distinct identity — the model-side normalization is the primary gate; document the parity).
   - Regression tests: bodyId with '01'-style ordinal in string input path (if any) rejected; parseCanonicalId('body:gal|sys|planet|01') → ok:false; parseCanonicalId with ordinal 2147483648 → ok:false; 2147483647 → ok:true; factory ordinal 2147483648 → throws.

2. [T07 — src/sim/world/reconstruct.ts:258-283] deserializeUniverse does not validate exact system→body registry ownership — swapping valid body ids between two systems' bodyIds registries (counts preserved, ids exist globally) passes. Fix: for each system, derive the expected body set from `body.system === system.id` AND `parentOf(body.id) === system.id`, then require the registry to be duplicate-free and EXACTLY match that set (same ids, same order as the canonical derivation — choose deterministic order = the state's bodies array order filtered by parent, document it). Add negative tests: swapped registries → deserializeUniverse throws AND reconstructConsistency reports the problem.

3. [T05/T07 — src/sim/world/catalogue.ts:276-441 + reconstruct.ts:120-309] Validators do not validate realData/provenance consistency — a record with `realData: true, provenance: 'procedural'` (or the inverse) passes catalogue validation / deserialization. Fix: in BOTH validators, enforce: realData must be boolean; if realData === true → provenance must start with 'nasa-exoplanet-archive-'; if realData === false → provenance must be 'procedural' (mirror the 0013 SQL CHECKs exactly). Add tampered-payload tests for both validators (each of the two inconsistent combos → problem/thrown).

VERIFY (focused per-file runs only): `npx tsc -b` exit 0; `npx vitest run tests/identity.test.ts tests/catalogue.test.ts tests/reconstruct.test.ts` all pass (per-file counts); SQL static read-back only.

REPORT: per-finding changed lines + which test covers which finding.
