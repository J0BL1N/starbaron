TASK (StarBaron P6-T08, master roadmap): INTEL-SAFE BACKEND — never send unauthorized hidden truth: the pure intel-store operations (record/promote/decay/query) + the WRITE-ONLY SQL deliverable (intel tables with RLS enforcing owner-only writes + the gate's no-leak rule server-side; NOT applied, deferred to Jay).

CONTEXT — existing code you may READ but NOT modify:
- src/sim/intel/levels.ts (P6-T02): TargetIntel, recordIntel, promoteIntel.
- src/sim/intel/staleness.ts (P6-T06): applyDecay, needsRescout.
- src/sim/intel/pvp-gate.ts (P6-T07): pvpGatedView (the server-side projection decision).
- src/sim/intel/permissions.ts (P6-T01): permissionFor.
- src/sim/intel/reports.ts (P6-T05): IntelReport.
- supabase/migrations/0017_fleets.sql + 0016_ownership_canonical.sql: the SQL conventions (players(id) uuid FK, text+CHECK enums, RLS owner-gate + child subquery, numeric sim timestamps, forward-only).
- supabase/tests/11_fleets.sql + 10_home_claim_atomicity.sql: SQL test conventions (begin/rollback, do $$ blocks).

ALLOWED FILES (create ONLY):
- src/sim/intel/store.ts
- tests/store.test.ts
- supabase/migrations/0018_intel.sql      (WRITE-ONLY — never applied; RLS locked; deferred to Jay)
- supabase/tests/12_intel.sql             (WRITE-ONLY SQL test)

RESTRICTIONS (TS): pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock; no `any`; strict TS; NO modification of existing files. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC (TS — src/sim/intel/store.ts):
1. `IntelStore = { ownerId: string; records: ReadonlyMap<string, TargetIntel> }` — per-owner intel store (key = targetId).
2. Pure functions:
   - `storeRecord(store: IntelStore, intel: TargetIntel): IntelStore` — immutable upsert via recordIntel semantics (promote; dedup sources); validates ownerId match? — the record has no owner; the STORE is per-owner (documented).
   - `storeApplyDecay(store: IntelStore, at: number): IntelStore` — applyDecay over ALL records (expired → dropped); returns the new store; at validated.
   - `storeQuery(store: IntelStore, targetId: string): TargetIntel | null` — the store read (null when absent).
   - `storeRescoutNeeded(store: IntelStore, at: number): string[]` — targetIds where needsRescout (deterministic order: targetId ascending).
   - `storeInvariants(store: IntelStore): { ok: boolean; problems: string[] }` — records' targetIds unique (map key), each TargetIntel valid (level valid, lastUpdatedAt positive finite or null, sources deduped + non-empty strings), ownerId non-empty.
3. Invariants (test): upsert promote/dedup; decay drops expired; query; rescout list; invariants tamper classes; immutability; determinism.

DESIGN SPEC (SQL — supabase/migrations/0018_intel.sql, WRITE-ONLY):
1. Follow 0017's conventions EXACTLY (players(id) uuid FK, text+CHECK, numeric sim ms timestamps, forward-only DDL, RLS).
2. Table `intel_record` (owner_id uuid not null references public.players(id) — the RECORDING player (who scouted), target_id text not null, intel_level text not null check in the 6 ladder values ('none','observed','scanned','scouted','deep recon','full intelligence' — match levels.ts EXACTLY), last_updated_at numeric not null check (> 0), sources jsonb not null check (jsonb_typeof(sources) = 'array'), primary key (owner_id, target_id)).
3. RLS: enable; SELECT/INSERT/UPDATE/DELETE policies by owner_id = auth.uid() — the RECORDING player owns their intel store (the no-leak rule: a player can only read/write THEIR OWN records; the gate projection (pvpGatedView) is a server-side RPC that filters via the viewer's own store — document that the RPC boundary is where the gate runs).
4. Index: intel_record(owner_id); unique already via PK.
5. supabase/tests/12_intel.sql: follow 11's conventions — insert records as a test owner; RLS probes (other user sees 0 rows; insert as other user fails); level-CHECK violation probe; sources-array violation probe; last_updated_at violation probe; rollback. Also document (comment) the server-side gate contract (pvpGatedView runs in the RPC, never the client).

VERIFY: TS: `npx tsc -b` exit 0; `npx vitest run tests/store.test.ts --pool threads` all pass. SQL: static self-review ONLY (do NOT run psql; do NOT apply). Report changed files, commands + results, limitations (SQL deferred; the RPC boundary documented).
