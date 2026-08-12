TASK (StarBaron PHASE 1 whole-phase audit FAIL round 5 — FIX ALL 4 FINDINGS, no broadening; this MUST close Phase 1):

ALLOWED FILES (ONLY): src/sim/world/identity.ts, src/sim/world/catalogue.ts, src/sim/world/reconstruct.ts, src/sim/world/api.ts, supabase/migrations/0013_world_schema.sql, supabase/tests/07_world_schema.sql, tests/identity.test.ts, tests/catalogue.test.ts, tests/reconstruct.test.ts, tests/api.test.ts. Do NOT touch anything else.

RESTRICTIONS: purity preserved; no `any`; strict TS; deterministic; no literal banned comment tokens; SQL write-only.

FINDINGS (fix exactly these):

1. [T01/T06 — supabase/migrations/0013_world_schema.sql:217-225] SQL ordinal CHECK accepts `01` while identity.ts rejects it. Fix: change the id-grammar CHECK to require `(0|[1-9][0-9]*)` for the ordinal segment (`id ~ '^body:[^|]+\|[^|]+\|(star|planet|moon|asteroid)\|(0|[1-9][0-9]*)$'`), and add a rejection case in supabase/tests/07_world_schema.sql (insert body id with leading-zero ordinal → check_violation).

2. [T05/T07/T08 — registry duplicate handling] Galaxy registry exactness is incomplete: catalogue.ts Set-based check loses duplicates (a one-system mapping with [id,id] passes); reconstruct.ts accepts a registry [A,A] omitting B; api.ts emits duplicate systems for duplicate registry entries. Fix — enforce "every mapped child exactly once, no duplicates, canonical order" in ALL three modules:
   - Canonical registry order (document once in identity.ts or a shared spot and reference from all): systems sorted by id string; bodies sorted by (ordinal, then id string).
   - catalogue.ts validateCatalogue: registry array length === unique-set length AND registry equals the canonical order of mapped children (reject dupes, missing, extra, wrong order).
   - reconstruct.ts deserializeUniverse + reconstructConsistency: same exactness for both systemIds and bodyIds registries.
   - api.ts list resolution: defensively reject (or dedupe — pick REJECT via the canonical resolvers: a duplicated registry entry cannot produce two distinct records; if the state is malformed, list results must not duplicate) — implement the same canonical-order derivation so duplicates are impossible to emit.
   - Negative tests in each: [id,id] registry → problem/thrown; [A,B] vs canonical order reversed → problem.

3. [T08 — src/sim/world/api.ts:41-53] resolveSystem does not require the resolved system's galaxy to equal state.galaxy.id — a self-consistent sys:other|seed registered in the state galaxy is returned by querySystemsByGalaxy/regionQuery/rendererPayload. Fix: resolveSystem (and the body resolver) must require `record.galaxy === state.galaxy.id` (and for bodies, `record.system` resolves within that galaxy) — otherwise treat as not-found. Add a malformed-state regression test (sys:other|seed registered in the galaxy → lookups/region/payload exclude it).

4. [T02/T03/T05/T06/T07/T08 — registry ordering persistence] GalaxyRecord.systemIds / SystemRecord.bodyIds have no persistence representation — child FKs preserve membership only, not the registry order T05/T07 validate and T08 uses. Fix WITHOUT adding schema columns: define registries as DERIVED + ordered (the canonical order from finding 2: systems ORDER BY id; bodies ORDER BY ordinal, id), enforce that order in the TS validators AND document in 0013's header that registries are derived at query time via `ORDER BY id` (systems) / `ORDER BY ordinal, id` (bodies) — an exact deterministic round trip. Make the TS registry contract match this derived order everywhere (factories produce registries in canonical order; validators enforce it; api derives by canonical order, not by trusting stored array order).

VERIFY (focused per-file runs only): `npx tsc -b` exit 0; `npx vitest run tests/identity.test.ts tests/catalogue.test.ts tests/reconstruct.test.ts tests/api.test.ts` all pass (per-file counts); SQL static read-back only.

REPORT: per-finding changed lines + which test covers which finding + any contract changes (registry order rule documented where?).
