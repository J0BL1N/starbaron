TASK (StarBaron PHASE 2 whole-phase audit FAIL round 3 — FIX ONLY THESE 3 FINDINGS, no broadening; this closes Phase 2):

ALLOWED FILES (ONLY): supabase/migrations/0016_ownership_canonical.sql (append new ALTER/CREATE OR REPLACE sections — the fix vehicle), supabase/tests/10_home_claim_atomicity.sql, and the model-side file src/sim/player/grid.ts IF a shared shape constant needs adjustment. Do NOT touch anything else. Migrations 0001-0015/0012 stay append-only — fixes via 0016 CREATE OR REPLACE / ALTER.

RESTRICTIONS: SQL write-only + idempotent; no banned comment tokens; static read-back verification.

FINDINGS (fix exactly these — the round-2 SQL changes did NOT fully land; complete them now):

1. [T02/T04/T06/T08 — canonical body_id REQUIRED] 0016 still has `p_body_id default null` on the claim RPCs (lines ~202, ~283, ~310, ~381), a PARTIAL unique index, and the audit trigger still falls back to planet_name (lines ~158, ~167). Fix in 0016:
   - CREATE OR REPLACE claim_home_planet + claim_colony: `p_body_id` is REQUIRED (drop the default; the parameter must be non-null — raise a descriptive exception when null).
   - Replace the partial unique index with a FULL UNIQUE index on owned_planets (body_id) (document: requires all rows to have body_id — write-only stack, no data yet, safe at apply; add a guarded note about any applied stack needing backfill first).
   - CREATE OR REPLACE the audit trigger function: write NEW.body_id ONLY (remove the planet_name COALESCE fallback entirely).
   - Update 10_home_claim_atomicity.sql: claims now pass body_id; add a case where p_body_id is NULL → raises; keep the duplicate-body_id unique_violation case.

2. [T06/T08 — RPC starter grid] Both claim RPCs insert housing:0 (lines ~296, ~394), contradicting STARTER_STRUCTURES ({housing:1}) in src/sim/player/grid.ts + onboarding. Fix in 0016: the HOME claim RPC inserts the FULL starter grid {housing: 1, other structures 0} (match the STARTER_STRUCTURES shape exactly — if grid.ts exports a full Record shape, reference its values in the SQL comment and mirror them); the COLONY claim RPC keeps housing:0 — document in the header that colonies start with no starter structures (intended distinction: starter resources apply to the home world only). Add a 10-test assertion: home claim row has housing 1; colony row has housing 0.

3. [T04/T07 — fortification resolver acquisition method] 0012's fortification resolver changes owner_id without setting acquisition_method='conquest' (0012 line ~752). Fix in 0016: CREATE OR REPLACE the fortification/conquest resolver (read 0012 for its exact name + statement) so EVERY owner_id change sets acquisition_method = 'conquest' (consistent with transferOwnership/conquestTransfer). Add a 10-test section: simulate a fortification-resolution owner change → row acquisition_method is 'conquest' AND the audit row records method 'conquest'.

VERIFY: static SQL read-back only (no supabase commands); `npx tsc -b` exit 0 (if grid.ts changes); `npx vitest run tests/ownership.test.ts tests/grid*.test.ts tests/onboarding.test.ts` pass if affected. Report per-finding changed lines + which test covers which finding.
