-- =====================================================================
-- 0004_attacks_members
-- Purpose   : P3-T01-B attack lifecycle tables — attacks (async PvP header
--             row) and attack_members (band-together joins, §5).
--             travel_seconds derived at launch (floor 600 / cap 172800,
--             §5.2); join window from launched_at regardless of travel (D11).
-- Idempotent: NO (forward-only; runs exactly once on an empty schema).
-- Date      : 2026-08-09
-- Scope     : tables, CHECKs, due/join indexes, RLS per §3.2. Writes flow
--             through the SECURITY DEFINER attack RPCs (0005).
--             RLS recursion (audit note): the two SELECT policies share the
--             same visibility predicate (attacks ↔ attack_members), so a
--             naive cross-table subquery in either policy re-enters the other
--             table's policy → infinite recursion. The recursion is broken
--             by a SINGLE-DIRECTION subquery design (no shared helpers):
--             the attacks policy subqueries attack_members membership only,
--             while the attack_members policy is a simple owner-scoped row
--             gate (auth.uid() = player_id) that never references attacks.
--             No helper functions, no starbaron_private schema, no client
--             EXECUTE grants — a client can never evaluate visibility for an
--             arbitrary player UUID.
-- =====================================================================

-- attacks: the async lifecycle. status/outcome as text+CHECK (D7, not enums).
create table public.attacks (
  id                  uuid primary key default gen_random_uuid(),
  target_planet_name  text not null references public.owned_planets (planet_name),
  launcher_id         uuid not null references public.players (id),
  status              text not null default 'inbound' check (status in ('inbound','resolved')),
  outcome             text check (outcome in ('decisive','pyrrhic','repelled','crushed')),
  winner_id           uuid references public.players (id),
  launched_at         timestamptz not null default now(),
  join_window_seconds int  not null default 7200             check (join_window_seconds > 0),
  travel_seconds      int  not null                          check (travel_seconds between 600 and 172800), -- floor 10 min / cap 48h (§5.2)
  resolves_at         timestamptz not null,
  resolved_at         timestamptz,
  attack_report       jsonb                                   -- full report: who/what/when, casualties, survivors (DESIGN §5)
);
create index attacks_target_idx   on public.attacks (target_planet_name) where status = 'inbound';
create index attacks_launcher_idx on public.attacks (launcher_id);
create index attacks_due_idx      on public.attacks (resolves_at) where status = 'inbound';  -- lazy resolve scan

-- attack_members: band-together joins (DESIGN §5 "multiple players can join … one target").
create table public.attack_members (
  attack_id          uuid not null references public.attacks (id) on delete cascade,
  player_id          uuid not null references public.players (id),
  soldiers_committed double precision not null check (isfinite(soldiers_committed) and soldiers_committed > 0),  -- permanent war cost (§4a); finite+positive (NaN/±∞/0 rejected)
  shipyard_tier      smallint not null check (shipyard_tier between 0 and 100),  -- AP = soldiers × shipyard tier (§5a) — snapshot at join
  joined_at          timestamptz not null default now(),
  primary key (attack_id, player_id)
);

-- =====================================================================
-- RLS (§3.2)
--   attacks:         launcher OR member OR target owner: always;
--                    inbound → visible to ALL authenticated (band-together
--                    coordination IS the mechanic).
--   attack_members:  owner-scoped row gate only — a client sees their OWN
--                    membership rows (auth.uid() = player_id); participants
--                    and the target owner are not exposed through the table.
--                    Full member details surface post-resolve in the
--                    attack_report payload.
-- No anon grants. No direct write grants — INSERT via launch_attack/
-- join_attack, UPDATE via resolve (definer RPCs).
-- =====================================================================

alter table public.attacks        enable row level security;
alter table public.attacks        force row level security;
alter table public.attack_members enable row level security;
alter table public.attack_members force row level security;

revoke all on table public.attacks        from public, anon;
revoke all on table public.attack_members from public, anon;

grant select on table public.attacks        to authenticated;
grant select on table public.attack_members to authenticated;

-- Single-direction subqueries (no helper functions, no recursion):
--   the attacks policy subqueries attack_members membership only; the
--   attack_members policy is a pure row gate (auth.uid() = player_id) that
--   never references attacks. RLS subqueries re-enter the referenced table's
--   policies, but that direction is one-way here, so the attacks ↔
--   attack_members recursion cannot form. No starbaron_private schema, no
--   client-executable helper — a client can never probe visibility for an
--   arbitrary player UUID.
create policy "attacks_participants_and_open"
  on public.attacks
  for select to authenticated
  using (
    auth.uid() = launcher_id
    or status = 'inbound'
    or auth.uid() = (select owner_id from public.owned_planets where planet_name = target_planet_name)
    or exists (select 1 from public.attack_members where attack_id = id and player_id = auth.uid())
  );

create policy "attack_members_own_rows"
  on public.attack_members
  for select to authenticated
  using (auth.uid() = player_id);
