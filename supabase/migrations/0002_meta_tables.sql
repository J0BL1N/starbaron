-- =====================================================================
-- 0002_meta_tables
-- Purpose   : P3-T01-B meta/config tables — notifications, seasons,
--             leaderboard_snapshots (schema-only; leaderboard/season
--             population + rotation = P4-T01, no jobs in P3, D6) and
--             game_config (key/value tunables as DATA, D9). The
--             game_config TABLE + RLS live HERE so the attack RPCs in
--             0005 — whose SQL-language function bodies are validated at
--             creation — see the table before they are created; the SEED
--             data lives in 0006_game_config_seed (tunables = data, not
--             migrations, §5.2 D9).
-- Idempotent: NO (forward-only; runs exactly once on an empty schema).
-- Date      : 2026-08-09
-- Scope     : tables, RLS, anon/PUBLIC REVOKE + authenticated SELECT /
--             UPDATE grants, per docs/P3_T01_A_AUDIT.md §1.4 + §3.2.
-- =====================================================================

-- notifications: §5b v1 kinds (under attack / invasion landed / planet
-- fell / attack result / revenge). Rows inserted by attack RPCs (definer),
-- read + marked read by the owner only.
create table public.notifications (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references public.players (id) on delete cascade,
  kind       text not null check (kind in ('under_attack','invasion_landed','planet_fell','attack_result','revenge')),
  payload    jsonb not null default '{}'::jsonb,              -- attack_id, planet_name, actor_id, casualties…
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index notifications_player_idx on public.notifications (player_id, read_at);

-- seasons + leaderboard_snapshots: §5b meta (schema now, population mechanics = P4-T01).
create table public.seasons (
  id         bigint generated always as identity primary key,
  name       text not null,
  started_at timestamptz not null,
  ends_at    timestamptz
);
create table public.leaderboard_snapshots (
  id          bigint generated always as identity primary key,
  season_id   bigint references public.seasons (id),          -- NULL = all-time
  player_id   uuid not null references public.players (id),
  score       double precision not null,                      -- metric TBD at P4-T01 (D6)
  rank        int,
  snapshot_at timestamptz not null default now()
);

-- game_config: draft tunables as DATA not migrations (§5.2, D9). The table
-- is created here (not in 0006 with its seed) because the attack RPCs in
-- 0005 read it and PostgreSQL validates SQL-language function bodies at
-- creation — the table must pre-exist. Seed data = 0006_game_config_seed.
create table public.game_config (
  key   text primary key,
  value jsonb not null
);

-- =====================================================================
-- RLS + grants (§3.2)
--   notifications:      owner-scoped SELECT + UPDATE (mark read_at).
--   seasons:            read-only to authenticated; admin/service_role writes.
--   leaderboard_snapshots: public read; service_role (job) writes.
--   game_config:        no client read — resolved values reach clients via
--                       RPC responses, never the raw table; service_role
--                       only (server-side, D9 §3.2).
-- =====================================================================

alter table public.notifications          enable row level security;
alter table public.notifications          force row level security;
alter table public.seasons                enable row level security;
alter table public.seasons                force row level security;
alter table public.leaderboard_snapshots  enable row level security;
alter table public.leaderboard_snapshots  force row level security;
alter table public.game_config            enable row level security;
alter table public.game_config            force row level security;

revoke all on table public.notifications         from public, anon;
revoke all on table public.seasons               from public, anon;
revoke all on table public.leaderboard_snapshots from public, anon;
revoke all on table public.game_config           from public, anon, authenticated;

grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;  -- mark read only; kind/payload/created_at immutable to clients (§3.2)
grant select on table public.seasons               to authenticated;
grant select on table public.leaderboard_snapshots to authenticated;
grant select on table public.game_config           to service_role;

create policy "notifications_own_rows"
  on public.notifications
  for select to authenticated
  using (auth.uid() = player_id);

create policy "notifications_own_rows_update_read_at"
  on public.notifications
  for update to authenticated
  using (auth.uid() = player_id)
  with check (auth.uid() = player_id);

create policy "seasons_shared_read"
  on public.seasons
  for select to authenticated
  using (true);

create policy "leaderboard_snapshots_public_read"
  on public.leaderboard_snapshots
  for select to authenticated
  using (true);
