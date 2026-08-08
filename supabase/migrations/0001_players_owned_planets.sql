-- =====================================================================
-- 0001_players_owned_planets
-- Purpose   : P3-T01-B schema core — players (identity + shared empire
--             wallet) and owned_planets (one row per owned planet).
--             planet_name UNIQUE = the P3 "REAL uniqueness" promise;
--             one-home partial index = at most one unconquerable home.
-- Idempotent: NO (forward-only, never re-run/applied twice; nothing is
--             guarded — this migration must run exactly once on an empty
--             schema).
-- Date      : 2026-08-09
-- Scope     : tables, derived-field CHECKs, uniqueness indexes, RLS,
--             anon/PUBLIC REVOKE + authenticated SELECT grants.
--             Mirrors docs/P3_T01_A_AUDIT.md §1.4 + §3.2.
-- =====================================================================

create table public.players (
  id               uuid primary key references auth.users (id) on delete cascade,
  display_name     text not null default '',
  credits          double precision not null default 1000 check (isfinite(credits) and credits >= 0),   -- STARTER_CREDITS (src/sim/player/wallet.ts); NaN/±∞ rejected
  alloys           double precision not null default 0    check (isfinite(alloys) and alloys >= 0),      -- STARTER_ALLOYS; NaN/±∞ rejected
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()                             -- new-player shield (3d) derived from this, no column (D10)
);

-- owned_planets: one row per owned planet. planet_name UNIQUE = REAL uniqueness.
-- planet names come from the client-side catalogue (D3); the server enforces
-- uniqueness (not catalogue membership).
-- Quirk trust model (D4): the combat-relevant quirk FLAGS (massive_world →
-- defense × massive_world_multiplier at resolve; dense_core → housing pop-cap
-- × dense_core_multiplier in the P3-T05 accrual path) are CLIENT-PROVIDED at
-- claim, exactly like tier / distance_pc / the quirk generator itself are
-- client-side (D3). The server enforces the multiplier VALUE authoritatively
-- from game_config at resolve, so a spoofed flag can only mislabel a planet
-- (bounded cosmetic drift), never inject an arbitrary multiplier.
create table public.owned_planets (
  id                          bigint generated always as identity primary key,
  owner_id                    uuid not null references public.players (id) on delete cascade,
  planet_name                 text not null,
  tier                        smallint not null check (tier between 1 and 5),
  baseline_income_per_sec     double precision not null check (isfinite(baseline_income_per_sec) and baseline_income_per_sec >= 0),   -- 10 × tier at claim (DESIGN §4d); NaN/±∞ rejected
  population_cap_multiplier   double precision not null check (isfinite(population_cap_multiplier) and population_cap_multiplier > 0),  -- tier table §4d; NaN/±∞ rejected
  distance_pc                 double precision check (distance_pc is null or (isfinite(distance_pc) and distance_pc >= 0)), -- catalogue, denormalised (travel time, §5.2); NaN/±∞ rejected
  claimed_at                  timestamptz not null default now(),
  is_home                     boolean not null default false,
  unconquerable               boolean not null default false, -- = is_home at claim (DESIGN §5 "unconquerable home")
  massive_world               boolean not null default false, -- combat quirk flag (D4): DP × massive_world_multiplier at resolve (§5.3)
  dense_core                  boolean not null default false, -- combat quirk flag (D4): housing pop-cap × dense_core_multiplier (P3-T05 accrual)
  population                  double precision not null default 0 check (isfinite(population) and population >= 0),
  garrison                    double precision not null default 0 check (isfinite(garrison) and garrison >= 0),
  fleet                       double precision not null default 0 check (isfinite(fleet) and fleet >= 0),
  structure_levels            jsonb not null check (jsonb_typeof(structure_levels) = 'object') -- Record<StructureId, number> (§1.3)
);

-- The two uniqueness indexes are the P3 RLS promise made physical.
create unique index owned_planets_name_unique  on public.owned_planets (planet_name);
create unique index owned_planets_one_home_idx on public.owned_planets (owner_id) where is_home;
create index owned_planets_owner_idx           on public.owned_planets (owner_id);

-- =====================================================================
-- RLS + grants (§3.2 / §3.3)
--   anon:         no grants at all (deny by default).
--   authenticated: row-gated SELECT; writes only via SECURITY DEFINER RPCs.
--   service_role: bypasses RLS by definition (no policy relies on it).
-- FORCE row-level security so the table owner (postgres, superuser) still
-- bypasses via superuser privileges while every non-superuser role —
-- including a SECURITY INVOKER by accident — is subject to the policies.
-- =====================================================================

alter table public.players         enable row level security;
alter table public.players         force row level security;
alter table public.owned_planets   enable row level security;
alter table public.owned_planets   force row level security;

revoke all on table public.players       from public, anon;
revoke all on table public.owned_planets from public, anon;

grant select on table public.players       to authenticated;
grant select on table public.owned_planets to authenticated;

create policy "players_own_row"
  on public.players
  for select to authenticated
  using (auth.uid() = id);

create policy "owned_planets_shared_universe"
  on public.owned_planets
  for select to authenticated
  using (true);
