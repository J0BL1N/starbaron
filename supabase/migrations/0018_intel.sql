-- =====================================================================
-- 0018_intel (P6-T08 — WRITE-ONLY, deferred to Jay, NEVER applied)
-- Purpose   : Intel persistence — the SQL mirror of the P6-T08 intel store
--             (src/sim/intel/store.ts + src/sim/intel/levels.ts): one row
--             per stored TargetIntel (intel_record). The table is OWNER-
--             scoped direct-client read/write via RLS policies — the
--             RECORDING player (owner_id) owns their intel store and can
--             only read/write THEIR OWN records (the no-leak rule).
--             WRITE-ONLY: this file is shipped for review only and is
--             NEVER applied without Jay's explicit authorisation. RLS is
--             LOCKED (enabled + FORCED) so even the apply window leaks
--             nothing to anon/other players.
-- The no-leak rule + the gate: the PvP projection (pvpGatedView,
--             src/sim/intel/pvp-gate.ts) runs INSIDE a server-side RPC,
--             NEVER in the client. The RPC reads the VIEWER'S OWN store
--             (RLS already gated every row to the viewer) and applies the
--             gate over it — the table's SELECT policy admits only the
--             recording player's rows, so no other player's intel can be
--             SELECTed into a projection. This file ships the row-level
--             ownership only; the gate RPC itself is the T08 backend layer
--             (documented here — the RPC boundary is where the gate runs).
-- Conventions (locked repo, 0017):
--   * Player FK: owner_id uuid references public.players (id) — the
--     RECORDING player (who scouted); the repo's player identity table
--     (0001) + 0017 fleet.owner_id precedent. Deleting a player cascades
--     away their intel store (0017 fleet.owner_id precedent).
--   * Enums: text + CHECK (D7, not enums) — intel_level is text with an
--     inline CHECK naming the SIX ladder values EXACTLY as levels.ts
--     INTEL_LEVELS (none, observed, scanned, scouted, deep recon, full
--     intelligence).
--   * Timestamps: last_updated_at is the sim's lastUpdatedAt as an exact
--     numeric millisecond number (0017 round-4: numeric, NOT bigint, no
--     timestamptz mapper). NULL mirrors the TS never-updated state
--     (store.ts allows lastUpdatedAt null), so the column is NULLABLE with
--     `check (last_updated_at is null or last_updated_at > 0)` — a null
--     (never updated) row is legal, a 0 or negative ms value is not.
--   * sources: jsonb array mirror of TargetIntel.sources (the
--     deterministic source ids) — structural CHECK only (jsonb_typeof =
--     'array'); the string-content rule stays in the TS store invariants
--     (store.ts).
--   * search_path: pure DDL (no functions) — all objects are public.-
--     qualified, same as 0017.
-- Idempotent : NO (forward-only; runs exactly once on an empty schema).
--   CREATE POLICY has no IF NOT EXISTS, so this file is NOT re-runnable —
--   the 0017 convention for user-owned tables.
-- Date      : 2026-08-13
-- Scope     : 1 new table + 1 index + RLS (enable + force) + owner
--             policies + grants. No data, no RPCs, no changes to existing
--             objects. NOT APPLIED — deferred to Jay.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. intel_record — one row per stored TargetIntel (src/sim/intel/store.ts
--    + levels.ts). owner_id is the RECORDING player (who scouted — the
--    store is per-owner; a TargetIntel carries no owner, ownership lives on
--    the store, mirrored here as the row's owner_id). target_id is the
--    target object id (with owner_id, the store map's key). intel_level is
--    the quality ladder as text + CHECK matching levels.ts INTEL_LEVELS
--    EXACTLY. last_updated_at is the sim's lastUpdatedAt (exact numeric ms;
--    NULL mirrors the TS never-updated state, so the column is NULLABLE with
--    check (last_updated_at is null or last_updated_at > 0)). sources is the
--    TargetIntel.sources JSONB array (deterministic source ids; string-content
--    validation stays in TS). The PK (owner_id, target_id) mirrors the store's
--    targetId-keyed map per owner; the owner_id index serves the per-owner
--    store read.
-- ---------------------------------------------------------------------
create table public.intel_record (
  owner_id        uuid not null references public.players (id) on delete cascade, -- the RECORDING player (who scouted)
  target_id       text not null,                                                  -- the target object id
  intel_level     text not null check (intel_level in ('none','observed','scanned','scouted','deep recon','full intelligence')), -- levels.ts INTEL_LEVELS, EXACT
  last_updated_at numeric check (last_updated_at is null or last_updated_at > 0), -- sim lastUpdatedAt in ms (null = never updated; round-4: exact numeric, not bigint)
  sources         jsonb not null check (jsonb_typeof(sources) = 'array'),          -- TargetIntel.sources (deterministic source ids)
  primary key (owner_id, target_id)
);
create index intel_record_owner_idx on public.intel_record (owner_id);

-- =====================================================================
-- RLS + grants.
--   intel_record is OWNER-scoped exactly like 0017's fleet tables: the
--     direct row gate auth.uid() = owner_id (0001 players_own_row + 0002
--     notifications_own_rows shape; INSERT/UPDATE add WITH CHECK so a
--     player can only ever write their OWN rows). The no-leak rule: a
--     player can only read/write THEIR OWN records — another player's rows
--     are invisible (SELECT) and un-writable (WITH CHECK). The gate
--     projection (pvpGatedView) is a server-side RPC that filters via the
--     VIEWER'S OWN store — the RPC boundary is where the gate runs, never
--     the client (see the header). No helper functions, no client-EXECUTE
--     probes — a client can never evaluate another player's intel.
--   FORCE row-level security (0017 belt-and-braces) so the table owner is
--     still subject to the policies. service_role bypasses RLS (BYPASSRLS)
--     and is not granted table privileges here.
-- =====================================================================

alter table public.intel_record enable row level security;
alter table public.intel_record force row level security;

revoke all on table public.intel_record from public, anon;

grant select, insert, update, delete on table public.intel_record to authenticated;

create policy "intel_record_own_rows_select"
  on public.intel_record
  for select to authenticated
  using (auth.uid() = owner_id);

create policy "intel_record_own_rows_insert"
  on public.intel_record
  for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "intel_record_own_rows_update"
  on public.intel_record
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "intel_record_own_rows_delete"
  on public.intel_record
  for delete to authenticated
  using (auth.uid() = owner_id);
