TASK (StarBaron P2-T04, master roadmap): PLANET OWNERSHIP — ownership records with acquisition metadata and audit history.

CONTEXT — existing code you may READ but NOT modify:
- supabase/migrations/0001_players_owned_planets.sql: owned_planets (owner_id, is_home, unconquerable, one-home index).
- src/sim/player/types.ts: OwnedPlanet { claimedAt, isHome, unconquerable }.
- src/sim/player/claim.ts: claimHomePlanet/claimColony (claim-time ownership creation).
- src/sim/player/profile.ts: PlayerProfile.
- src/sim/player/protection.ts (P2-T03): HomeProtection, attemptedConquest.
- src/sim/world/identity.ts: BodyId.
- src/sim/structures/types.ts (structure IDs — for survival rules later; read-only reference).

ALLOWED FILES (create ONLY):
- src/sim/player/ownership.ts
- tests/ownership.test.ts
- supabase/migrations/0015_ownership_audit.sql
- supabase/tests/09_ownership_audit.sql

RESTRICTIONS: pure module (no nondeterministic APIs, no module-level mutable state, no wall-clock — timestamps are INPUTS, no `any`, strict TS); SQL WRITE-ONLY (no supabase commands, not even in comments); NO modification of existing files.

DESIGN SPEC — ownership.ts (pure model):
1. `AcquisitionMethod = 'home-assignment' | 'colonisation' | 'conquest' | 'trade'` (extensible union).
2. `OwnershipRecord = { bodyId: BodyId; ownerId: string; previousOwnerId: string | null; acquiredAt: number; acquisitionMethod: AcquisitionMethod; isHome: boolean; unconquerable: boolean; }`.
3. `OwnershipEvent = { bodyId: BodyId; fromOwnerId: string | null; toOwnerId: string; at: number; method: AcquisitionMethod; }` — the audit-history entry.
4. Pure functions:
   - `ownershipFor(bodyId, ownerId, previousOwnerId, acquiredAt, method, isHome, unconquerable): OwnershipRecord` — validates (acquiredAt finite > 0; ownerId non-empty; previousOwnerId !== ownerId when both present; method in union; isHome && method !== 'home-assignment' → allowed? NO — decide: isHome true REQUIRES method 'home-assignment' OR 'colonisation'? Home = the FIRST world; keep simple: isHome implies method 'home-assignment' — throw otherwise; unconquerable implies isHome — throw otherwise).
   - `transferOwnership(record, toOwnerId, at, method): { updated: OwnershipRecord; event: OwnershipEvent }` — immutably creates the new record (previousOwnerId = record.ownerId, acquiredAt = at, method) + the audit event; throws if record.unconquerable (protected — P2-T03 integration).
   - `historyAppend(history: OwnershipEvent[], event: OwnershipEvent): OwnershipEvent[]` — immutable append (new array).
   - `ownershipHistory(history, bodyId): OwnershipEvent[]` — filter by body, oldest-first (stable order by `at` then input order).
   - `currentOwner(history, bodyId): string | null` — the LAST event's toOwnerId for that body, null if none.
3. Invariants (test): field validation throws; isHome/unconquerable rules; transfer creates correct record + event; transfer of protected throws; historyAppend immutable; ownershipHistory order + filter; currentOwner resolution; determinism.

DESIGN SPEC — 0015_ownership_audit.sql (write-only migration):
- `ownership_audit` table: id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, body_id TEXT NOT NULL, from_owner_id UUID NULL, to_owner_id UUID NOT NULL, method TEXT NOT NULL CHECK (method IN ('home-assignment','colonisation','conquest','trade')), at_ms BIGINT NOT NULL (epoch ms — matches the pure model), created_at TIMESTAMPTZ NOT NULL DEFAULT now() (non-canonical persistence metadata — document). INDEX on (body_id, at_ms).
- RLS enabled, no policies (locked, mirror 0013 conventions); revoke from public/anon/authenticated (backend writes only).
- Trigger on owned_planets INSERT/UPDATE of owner_id → INSERT into ownership_audit automatically (keeps the audit in sync; OLD.owner_id → from, NEW.owner_id → to, method = CASE WHEN OLD is null then 'home-assignment' when OLD.is_home... keep simple: 'conquest' default for changes, 'home-assignment' for inserts — document; at_ms = extract(epoch from now()) * 1000). Header documents the interaction with 0014's protection trigger.
- Idempotent constructs.

DESIGN SPEC — 09_ownership_audit.sql (contract tests, repo style):
- Insert owned_planets row → audit row auto-created (method home-assignment); update owner_id → second audit row (from/to correct); protected home transfer blocked by 0014 trigger → no audit row; re-run contract.

TESTS (vitest, tests/ownership.test.ts, ~22-26): all model invariants above.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/ownership.test.ts` all pass (counts); SQL static read-back only. DO NOT run the full suite. Report changed files, commands + results, limitations.
