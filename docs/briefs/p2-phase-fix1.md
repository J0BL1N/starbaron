TASK (StarBaron PHASE 2 whole-phase audit FAIL — FIX ALL 6 FINDINGS, no broadening; this closes Phase 2):

ALLOWED FILES (ONLY): src/sim/player/ownership.ts, src/sim/player/protection.ts, src/sim/player/colonisation.ts, src/sim/player/transfer.ts, src/sim/player/assignment.ts, src/sim/player/onboarding.ts, src/sim/player/claim.ts, src/sim/player/player.ts, NEW src/sim/player/id.ts, NEW supabase/migrations/0016_ownership_canonical.sql, NEW supabase/tests/10_home_claim_atomicity.sql, and their existing test files (tests/ownership.test.ts, protection.test.ts, colonisation.test.ts, transfer.test.ts, assignment.test.ts, onboarding.test.ts, claim.test.ts). Do NOT touch anything else. Migrations 0014/0015 are append-only — fixes go in NEW 0016 (ALTER + CREATE OR REPLACE), never by editing them.

RESTRICTIONS: purity preserved; no `any`; strict TS; deterministic; no banned comment tokens; SQL write-only (no supabase invocation even in comments); NEW migration must be idempotent.

FINDINGS (fix exactly these):

1. [T03/T04/T07 — protection irreversibility] Home protection is bypassable: TS permits isHome && !unconquerable (ownershipFor) and transferOwnership protects only unconquerable; SQL 0001 has no is_home = unconquerable coupling; 0014 allows other-column updates. Fix:
   - ownership.ts ownershipFor: THROW when isHome && !unconquerable (and when unconquerable && !isHome — the relation is exact equality).
   - 0016 SQL: ALTER TABLE owned_planets ADD CONSTRAINT owned_planets_home_parity CHECK (is_home = unconquerable); and CREATE OR REPLACE the 0014 trigger function to ALSO raise when a protected row's is_home or unconquerable flags CHANGE (BEFORE UPDATE: if OLD.unconquerable AND (NEW.is_home <> OLD.is_home OR NEW.unconquerable <> OLD.unconquerable) → raise) — protection becomes irreversible.
   - Negative tests: ownershipFor({isHome:true, unconquerable:false}) throws; transfer of a declassified record impossible by construction.

2. [T02-T08 — canonical body ids in SQL] 0015 audit writes planet_name into body_id. Fix via 0016 (append-only): ALTER TABLE owned_planets ADD COLUMN body_id TEXT NULL REFERENCES public.world_bodies(id) ON DELETE RESTRICT; the audit trigger function (CREATE OR REPLACE) writes COALESCE(NEW.body_id, NEW.planet_name) into ownership_audit.body_id; header documents that the claim RPCs adopt body_id when the canonical world layer is applied (write-only stack — the mapping completes at apply time).

3. [T04/T06 — acquisition-method parity] SQL logs every insert as home-assignment; pure model says colonisation for colonies. Fix via 0016: ALTER TABLE owned_planets ADD COLUMN acquisition_method TEXT NOT NULL DEFAULT 'home-assignment' CHECK (acquisition_method IN ('home-assignment','colonisation','conquest','trade')); CREATE OR REPLACE claim RPCs (claim_home_planet sets 'home-assignment', claim_colony sets 'colonisation' — read 0003 for exact signatures); audit trigger copies NEW.acquisition_method.

4. [T02/T08 — atomic reservation] Selection is snapshot-based; no reservation → concurrent same-home. Fix via 0016 + tests: CREATE UNIQUE INDEX owned_planets_body_id_key ON public.owned_planets (body_id) WHERE body_id IS NOT NULL; extend claim_home_planet/claim_colony to INSERT body_id (the canonical id derived at the app layer) — the unique index makes double-claims fail with unique_violation (atomicity). NEW supabase/tests/10_home_claim_atomicity.sql: two sequential claims of the same body_id → second raises unique_violation; different body_ids succeed; the pure model's selectHomeWorld stays the SELECTOR, the DB is the RESERVATION (document this division in assignment.ts JSDoc).

5. [pre-existing — determinism gate] claim.ts claimHomePlanet defaults now = Date.now(); player.ts generatePlayerId uses crypto.randomUUID/Date.now/Math.random. Fix:
   - claim.ts: claimHomePlanet(playerId, now) — now becomes a REQUIRED parameter (no default); claimColony(entry, now) already required. Update the UI call site src/ui/PlanetView.tsx (allowed ONLY for this compile-required change) to pass Date.now() — the boundary.
   - NEW src/sim/player/id.ts: move generatePlayerId there with a `@boundary` JSDoc (nondeterministic id generation is a boundary utility BY DESIGN — the sim layer never calls it; tests assert id.ts is not imported by any other sim module). player.ts re-exports generatePlayerId from id.ts (keep the public API; the boundary marker is the contract).
   - Tests: claim tests updated to pass now explicitly.

6. [T08 — starter grid invariant] entryFlow accepts initialStructureLevel: 0 → empty starter grid; legacy paths start Housing 0. Fix (pure layer): initialStructureLevel is REMOVED from the entryFlow input — the starter grid is ALWAYS {housing: 1} (validate nothing; drop the param; update tests). Document in onboarding.ts JSDoc: legacy save/claim paths adopt the same starter grid during Phase 4 UI integration (tracked residual).

VERIFY (focused per-file runs only): `npx tsc -b` exit 0; `npx vitest run tests/ownership.test.ts tests/protection.test.ts tests/colonisation.test.ts tests/transfer.test.ts tests/assignment.test.ts tests/onboarding.test.ts tests/claim.test.ts` all pass (per-file counts); SQL static read-back only.

REPORT: per-finding changed lines + which test covers which finding + the tracked residual (finding 6 legacy-path note).
