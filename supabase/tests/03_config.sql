-- =====================================================================
-- 03_config
-- Purpose   : P3-T01-C game_config contract test against the applied
--             0002 + 0006 seed. Proves:
--               * the draft PvP tunables exist with the exact seed values
--                 (travel / launch / join-window / war-weariness / shield /
--                 repelled-pop-loss — DESIGN §5a, §5.2; 0006 seed).
--               * the D4 combat-balance constants exist (turret DP,
--                 militia DP, effectiveLevel, quirk multipliers, outcome
--                 table buckets) — server-authoritative resolve math.
--               * game_config is service_role-ONLY: authenticated (and
--                 anon) are denied — resolved values reach clients via RPC
--                 responses, never the raw table (audit §3.2).
-- Run      : npx --no-install supabase db query --linked -f supabase/tests/03_config.sql
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: BEGIN ... ROLLBACK (role switches only, no data writes).
-- No auth.users seeding needed — this file is role-probe only.
-- =====================================================================

begin;

-- 1. travel / launch / join-window / weariness tunables (0006 seed).
do $$
declare
  i int;
  vk text[] := array['travel_minutes_per_pc',
                     'travel_floor_seconds',
                     'travel_cap_seconds',
                     'join_window_seconds',
                     'launch_cost_base_credits',
                     'launch_cost_per_fleet_credits',
                     'launch_cost_per_pc_credits',
                     'war_weariness_multiplier',
                     'war_weariness_window_hours',
                     'new_player_shield_days',
                     'defender_pop_loss_repelled'];
  vv text[] := array['1',
                     '600',
                     '172800',
                     '7200',
                     '200',
                     '0.2',
                     '10',
                     '1.2',
                     '24',
                     '3',
                     '0.3'];
  v jsonb;
begin
  for i in 1..array_length(vk, 1) loop
    select value into v from public.game_config where key = vk[i];
    if v is null then
      raise exception '8653 ASSERTION FAILED: game_config key % is missing', vk[i];
    end if;
    if v::text <> vv[i] then
      raise exception '8653 ASSERTION FAILED: game_config % expected %, got %', vk[i], vv[i], v;
    end if;
  end loop;
end $$;

-- 2. D4 combat-balance constants present (server-authoritative resolve).
do $$
declare
  i int;
  vk text[] := array['turret_defense_power_per_level',
                     'militia_defense_per_population',
                     'effective_level_cap',
                     'diminishing_returns_factor',
                     'massive_world_multiplier',
                     'dense_core_multiplier',
                     'base_income_per_tier',
                     'starter_credits',
                     'starter_population'];
  vv text[] := array['500',
                     '0.15',
                     '10',
                     '0.5',
                     '1.1',
                     '1.1',
                     '10',
                     '1000',
                     '1000'];
  v jsonb;
begin
  for i in 1..array_length(vk, 1) loop
    select value into v from public.game_config where key = vk[i];
    if v is null then
      raise exception '8653 ASSERTION FAILED: game_config key % is missing', vk[i];
    end if;
    if v::text <> vv[i] then
      raise exception '8653 ASSERTION FAILED: game_config % expected %, got %', vk[i], vv[i], v;
    end if;
  end loop;
end $$;

-- 3. outcome table present with all four DESIGN §5a ratio buckets.
do $$
declare v jsonb;
begin
  select value into v from public.game_config where key = 'outcome_ratios_and_losses';
  if v is null
     or v->'decisive'  is null
     or v->'pyrrhic'   is null
     or v->'repelled'  is null
     or v->'crushed'   is null then
    raise exception '8653 ASSERTION FAILED: outcome_ratios_and_losses buckets missing: %', v;
  end if;
end $$;

-- 4. service_role-only readability: authenticated (and anon) are denied.
set local role authenticated;
do $$ begin
  begin
    perform count(*) from public.game_config;
    raise exception '8653 ASSERTION FAILED: authenticated must be denied game_config';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;
set local role postgres;

set local role anon;
do $$ begin
  begin
    perform count(*) from public.game_config;
    raise exception '8653 ASSERTION FAILED: anon must be denied game_config';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;
set local role postgres;

set local role service_role;
do $$
declare n bigint;
begin
  select count(*) into n from public.game_config;
  if n < 1 then
    raise exception '8653 ASSERTION FAILED: service_role must read game_config, saw % rows', n;
  end if;
end $$;
set local role postgres;

rollback;
