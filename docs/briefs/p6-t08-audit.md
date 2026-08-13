READ-ONLY AUDIT — StarBaron P6-T08 (master roadmap): Intel-Safe Backend.

READ LIST:
- src/sim/intel/store.ts            (NEW — under audit)
- tests/store.test.ts               (NEW — test suite)
- src/sim/intel/levels.ts           (P6-T02: recordIntel/promoteIntel)
- src/sim/intel/staleness.ts        (P6-T06: applyDecay, needsRescout)
- src/sim/intel/pvp-gate.ts         (P6-T07: the server-side projection decision)
- supabase/migrations/0018_intel.sql   (NEW — write-only, under audit)
- supabase/tests/12_intel.sql          (NEW — write-only, under audit)
- supabase/migrations/0017_fleets.sql (conventions: players(id) uuid FK, text+CHECK, numeric ms, RLS owner-gate)

AUTHORISED SCOPE: ONLY the four new files. AUDIT TARGET = the CURRENT state of src/sim/intel/store.ts + tests/store.test.ts + supabase/migrations/0018_intel.sql + supabase/tests/12_intel.sql on staging (HEAD; the feat commit + audit-fix amends cover exactly these four). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t08-brief.md + master roadmap P6-T08):
1. TS store: IntelStore { ownerId, records map }; storeRecord (upsert via recordIntel semantics — promote + source dedup); storeApplyDecay (applyDecay over all, expired dropped); storeQuery; storeRescoutNeeded (targetId ascending); storeInvariants (map-key uniqueness, record validity, ownerId non-empty).
2. SQL 0018: intel_record (owner_id → players(id), target_id, intel_level CHECK with the 6 ladder values matching levels.ts EXACTLY, last_updated_at numeric > 0, sources jsonb array CHECK, PK (owner_id, target_id)); RLS owner-gate (recording player owns their store — the no-leak rule); server-side gate documented (pvpGatedView runs in the RPC boundary).
3. SQL 12: begin/rollback; RLS probes (other user 0 rows, insert as other fails); level/sources/last_updated CHECK probes; do $$ blocks.
4. Purity (TS): no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ intel/* + ui/validate + stdlib; banned comment tokens absent. SQL: write-only, never applied.

CHECK:
A. TS purity + imports; no banned tokens in comments.
B. Store ops: upsert promote/dedup; decay drop; query; rescout list ordering; invariants tamper classes; immutability; determinism.
C. SQL: FK/CHECK conventions match 0017; ladder values match levels.ts EXACTLY (verify both); RLS shape; PK; test structure (transaction, rollback, do $$ blocks).
D. SQL never applied (write-only).
E. Tests ~41 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; apply SQL; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
