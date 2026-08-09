-- =====================================================================
-- 06_fortification (P3-T05-B)
-- Purpose   : P3-T05-C fortification + war-weariness + soldier-commitment
--             contract tests against the applied 0001-0012 migration set.
--             Extends the 05 convention (BEGIN...ROLLBACK, actors,
--             RAISE '8653 ASSERTION FAILED'). Pins the Jay-authorised
--             P3-T05 decisions (B1-B7, docs/P3_T05_A_AUDIT.md §5.2):
--               * Fortified-target ratio math at FORTRESS scale: defenseTurret
--                 30 → effectiveLevel 20 → DP 10,000 (500 × 20) with the
--                 EXACT 1.5 / 1.0 / 0.75 boundaries (decisive / pyrrhic /
--                 repelled) and the just-below crushed bucket — proving the
--                 resolver handles large DP with no precision surprise.
--               * build_structure() — the B1 server build RPC: charges the
--                 credits cost curve (base × 1.15^level) + FLAT alloy (B6),
--                 writes the grid under FOR UPDATE, and applies the barracks
--                 garrison conversion (garrison cap 5,000 × effectiveLevel).
--               * Garrison deduction at launch (B1 carry): garrison -= 400,
--                 fleet += 400; 'insufficient garrison' (700 over 600) and
--                 'fleet cap exceeded' (1,500 over a 1,000-shipyard cap)
--                 both reject without mutating state.
--               * Survivor return (B4 UNIFORM reading): decisive +0.6×
--                 committed returns (winner AND losers both return), pyrrhic
--                 +0.3×; repelled +0.4× and crushed +0.1× return. fleet −=
--                 committed → 0 at resolve in every bucket. The report
--                 `losses` field is unchanged.
--               * source_planet_name integrity: survivors land on the
--                 CORRECT source planet (gang case), and return
--                 UNCONDITIONALLY to the source planet even when it changed
--                 owner mid-flight (B5) — the mid-flight source-loss edge.
--               * get_attack roster per-member `weariness` (B7): each
--                 member's own 1.2^n stack, NULL-exclude semantics.
-- Run      : npx --no-install supabase db query --linked -f supabase/tests/06_fortification.sql
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Actors. A = attacker/launcher (owns the fortification sources), B =
-- band-together joiner, C = defender (owns every target), D = the foreign
-- conqueror for the mid-flight source-loss edge.
-- ---------------------------------------------------------------------
insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@test.local', now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd@test.local', now(), now());

-- A: home + the fortification sources.
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('alpha-06', 2::smallint);
  perform public.claim_colony('f-src', 1::smallint);
  perform public.claim_colony('s-a',   1::smallint);
  perform public.claim_colony('s-c',   1::smallint);
  perform public.claim_colony('s-d',   1::smallint);
  perform public.claim_colony('s-e',   1::smallint);
  perform public.claim_colony('s-loss', 1::smallint);
  perform public.claim_colony('g-launch-src', 1::smallint);
  perform public.claim_colony('g-cap-src',    1::smallint);
  perform public.claim_colony('build-src',    1::smallint);
  perform public.claim_colony('gar-src',      1::smallint);
end $$;

-- B: home + the joiner source.
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('beta-06', 2::smallint);
  perform public.claim_colony('s-b', 1::smallint);
end $$;

-- C: home + every target (fortress turrets, gang/pyrrhic/repelled/crushed,
-- launch-guard, loss-edge and roster targets).
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('gamma-06', 2::smallint);
  perform public.claim_colony('f-dec',     1::smallint);
  perform public.claim_colony('f-pyr',     1::smallint);
  perform public.claim_colony('f-rep',     1::smallint);
  perform public.claim_colony('f-cru',     1::smallint);
  perform public.claim_colony('t-dec-gang', 1::smallint);
  perform public.claim_colony('t-pyr-gang', 1::smallint);
  perform public.claim_colony('t-rep-ded',  1::smallint);
  perform public.claim_colony('t-cru-ded',  1::smallint);
  perform public.claim_colony('t-loss-tgt', 1::smallint);
  perform public.claim_colony('g-launch-tgt', 1::smallint);
  perform public.claim_colony('g-launch-tgt2', 1::smallint);
  perform public.claim_colony('g-cap-tgt',   1::smallint);
  perform public.claim_colony('t-roster',    1::smallint);
  perform public.claim_colony('t-bw',        1::smallint);
end $$;

-- D: home + the conqueror source.
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('delta-06', 2::smallint);
  perform public.claim_colony('d-src', 1::smallint);
end $$;

-- ---------------------------------------------------------------------
-- Seed context (as postgres): backdate ALL shields, fund A/B/D, set grids.
-- P3-T05-B garrison/barracks: every launch now requires garrison >= committed
-- (deducted at launch) and fleetCap = 1000 × effectiveLevel(shipyard); the
-- resolver clamps survivor returns to the barracks garrison cap, so every
-- source that hosts MULTIPLE launches carries barracks with a cap above its
-- garrison (f-src barracks 5 → cap 25000; the single-shot survivor sources
-- barracks 10 → cap 50000 so the pins are never clamp-truncated).
-- ---------------------------------------------------------------------
set local role postgres;
update public.players set created_at = now() - interval '10 days'
 where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
update public.players set credits = 1000000
 where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              'dddddddd-dddd-4ddd-8ddd-dddddddddddd');

-- Source grids + garrison/barracks (A).
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":10,"barracks":5}'  where planet_name = 'f-src';
update public.owned_planets set garrison = 5000, population = 0 where planet_name = 'f-src';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":10,"barracks":10}' where planet_name = 's-a';
update public.owned_planets set garrison = 2000 where planet_name = 's-a';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":1,"barracks":10}'  where planet_name = 's-c';
update public.owned_planets set garrison = 1500 where planet_name = 's-c';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":1,"barracks":10}'  where planet_name = 's-d';
update public.owned_planets set garrison = 2000 where planet_name = 's-d';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":1,"barracks":10}'  where planet_name = 's-e';
update public.owned_planets set garrison = 1000 where planet_name = 's-e';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":1,"barracks":10}'  where planet_name = 's-loss';
update public.owned_planets set garrison = 2000 where planet_name = 's-loss';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":3}' where planet_name = 'g-launch-src';
update public.owned_planets set garrison = 1000 where planet_name = 'g-launch-src';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":1}' where planet_name = 'g-cap-src';
update public.owned_planets set garrison = 5000 where planet_name = 'g-cap-src';
-- B's joiner source.
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":10,"barracks":10}' where planet_name = 's-b';
update public.owned_planets set garrison = 1000 where planet_name = 's-b';
-- D's conqueror source.
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":1}' where planet_name = 'd-src';
update public.owned_planets set garrison = 500 where planet_name = 'd-src';
-- build_structure test planets (all-zero grids; wallet handled per case).
update public.owned_planets set population = 1000, garrison = 0 where planet_name = 'gar-src';

-- Target grids (C). The fortress targets carry defenseTurret 30 (eff 20 → DP 10000).
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":30}' where planet_name in ('f-dec','f-pyr','f-rep','f-cru');
-- zero-DP gang target, pyrrhic/repelled/crushed t2 targets, launch-guard targets, loss-edge target.
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}' where planet_name in ('t-pyr-gang','t-rep-ded','t-cru-ded','t-loss-tgt');
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":1}' where planet_name = 't-bw';

-- ---------------------------------------------------------------------
-- 1. Fortified-target ratio math at fortress scale. DP 10,000 (t30 → eff 20
--    → 500×20) with the exact 1.5 / 1.0 / 0.75 boundaries + just-below
--    crushed. Source f-src (shipyard 10 → eff 10 → AP = soldiers×10;
--    fleetCap 10,000; garrison 5,000 covers the four cumulative commits).
--    Every attack is backdated 2 days out of the weariness window.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

-- 1a. decisive boundary: 1500 × 10 = 15000 AP vs 10000 DP → ratio exactly 1.5.
do $$ begin
  if (select public.launch_attack('f-dec', 1500, 'f-src'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: f-dec launch must be inbound';
  end if;
end $$;
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 'f-dec' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 'f-dec' and status = 'inbound';
set local role authenticated;
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'defense_power')::numeric <> 10000 then
    raise exception '8653 ASSERTION FAILED: f-dec expected DP 10000 (t30 → eff 20), got %', v_res->0->>'defense_power';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.5 then
    raise exception '8653 ASSERTION FAILED: f-dec expected ratio 1.5, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: f-dec expected decisive, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 600 then
    raise exception '8653 ASSERTION FAILED: f-dec losses expected 600 (round(1500×0.4)), got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- 1b. pyrrhic boundary: 1000 × 10 = 10000 AP → ratio exactly 1.0.
set local role authenticated;
do $$ begin
  if (select public.launch_attack('f-pyr', 1000, 'f-src'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: f-pyr launch must be inbound';
  end if;
end $$;
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 'f-pyr' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 'f-pyr' and status = 'inbound';
set local role authenticated;
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'ratio')::numeric <> 1.0 then
    raise exception '8653 ASSERTION FAILED: f-pyr expected ratio 1.0, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: f-pyr expected pyrrhic, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 700 then
    raise exception '8653 ASSERTION FAILED: f-pyr losses expected 700 (round(1000×0.7)), got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- 1c. repelled boundary: 750 × 10 = 7500 AP → ratio exactly 0.75.
set local role authenticated;
do $$ begin
  if (select public.launch_attack('f-rep', 750, 'f-src'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: f-rep launch must be inbound';
  end if;
end $$;
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 'f-rep' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 'f-rep' and status = 'inbound';
set local role authenticated;
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'ratio')::numeric <> 0.75 then
    raise exception '8653 ASSERTION FAILED: f-rep expected ratio 0.75, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: f-rep expected repelled, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 450 then
    raise exception '8653 ASSERTION FAILED: f-rep losses expected 450 (round(750×0.6)), got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- 1d. crushed just-below: 749 × 10 = 7490 AP → ratio 0.749 < 0.75.
set local role authenticated;
do $$ begin
  if (select public.launch_attack('f-cru', 749, 'f-src'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: f-cru launch must be inbound';
  end if;
end $$;
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 'f-cru' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 'f-cru' and status = 'inbound';
set local role authenticated;
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'ratio')::numeric <> 0.749 then
    raise exception '8653 ASSERTION FAILED: f-cru expected ratio 0.749, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'crushed' then
    raise exception '8653 ASSERTION FAILED: f-cru expected crushed, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 674 then
    raise exception '8653 ASSERTION FAILED: f-cru losses expected 674 (round(749×0.9)), got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. build_structure() — the B1 server build/upgrade RPC. Pins the credits
--    cost curve (base × 1.15^level) + FLAT alloy (B6: 1,000 at EVERY turret
--    level) server-side, the grid write under FOR UPDATE, the barracks
--    garrison conversion (accrual semantics), and the insufficient-funds
--    rejection (which aborts the transaction — no grid/wallet mutation).
-- ---------------------------------------------------------------------
set local role postgres;
update public.players set credits = 10000, alloys = 10000 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_credits double precision; v_alloys double precision;
  v_turret int; v_barracks int;
  v_gar double precision; v_pop double precision;
begin
  -- defenseTurret 0 → 1: cost = 2000 × 1.15^0 = 2000 cr + 1000 alloys (flat).
  perform public.build_structure('build-src', 'defenseTurret');
  select credits, alloys into v_credits, v_alloys from public.players where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select coalesce((structure_levels->>'defenseTurret')::int, -1) into v_turret from public.owned_planets where planet_name = 'build-src';
  if v_credits <> 8000 or v_alloys <> 9000 then
    raise exception '8653 ASSERTION FAILED: turret 0→1 must cost 2000 cr + 1000 alloy, wallet got %/%', v_credits, v_alloys;
  end if;
  if v_turret <> 1 then
    raise exception '8653 ASSERTION FAILED: turret must be level 1 after build, got %', v_turret;
  end if;

  -- defenseTurret 1 → 2: cost = 2000 × 1.15^1 = 2300 cr + 1000 alloys (alloy FLAT, B6).
  perform public.build_structure('build-src', 'defenseTurret');
  select credits, alloys into v_credits, v_alloys from public.players where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select coalesce((structure_levels->>'defenseTurret')::int, -1) into v_turret from public.owned_planets where planet_name = 'build-src';
  if v_credits <> 5700 or v_alloys <> 8000 then
    raise exception '8653 ASSERTION FAILED: turret 1→2 must cost 2300 cr + 1000 alloy (flat), wallet got %/%', v_credits, v_alloys;
  end if;
  if v_turret <> 2 then
    raise exception '8653 ASSERTION FAILED: turret must be level 2 after build, got %', v_turret;
  end if;
end $$;

set local role postgres;
update public.players set credits = 10000, alloys = 10000 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
do $$
declare
  v_credits double precision; v_alloys double precision;
  v_barracks int; v_gar double precision; v_pop double precision;
begin
  -- Barracks 0 → 1 on gar-src (pop 1000, garrison 0): cost 1500 cr + 0 alloy;
  -- the garrison conversion applies one accrual tick (rate 10×eff1 = 10,
  -- cap 5000×eff1 = 5000) → garrison 10, population 990.
  perform public.build_structure('gar-src', 'barracks');
  select credits, alloys into v_credits, v_alloys from public.players where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select coalesce((structure_levels->>'barracks')::int, -1), garrison, population
    into v_barracks, v_gar, v_pop from public.owned_planets where planet_name = 'gar-src';
  if v_credits <> 8500 or v_alloys <> 10000 then
    raise exception '8653 ASSERTION FAILED: barracks 0→1 must cost 1500 cr, wallet got %/%', v_credits, v_alloys;
  end if;
  if v_barracks <> 1 then
    raise exception '8653 ASSERTION FAILED: barracks must be level 1 after build, got %', v_barracks;
  end if;
  if v_gar <> 10 or v_pop <> 990 then
    raise exception '8653 ASSERTION FAILED: barracks conversion must give garrison 10 / pop 990, got %/%', v_gar, v_pop;
  end if;
end $$;

-- Insufficient funds: drain the wallet (postgres), then a build must RAISE and
-- leave the grid + wallet unchanged.
set local role postgres;
update public.players set credits = 0, alloys = 0 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
do $$
declare v_credits double precision; v_alloys double precision; v_turret int;
begin
  begin
    perform public.build_structure('build-src', 'defenseTurret');
    raise exception '8653 ASSERTION FAILED: underfunded build must raise';
  exception
    when others then
      if sqlerrm !~ 'insufficient funds' then raise; end if;
  end;
  select credits, alloys into v_credits, v_alloys from public.players where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select coalesce((structure_levels->>'defenseTurret')::int, -1) into v_turret from public.owned_planets where planet_name = 'build-src';
  if v_credits <> 0 or v_alloys <> 0 or v_turret <> 2 then
    raise exception '8653 ASSERTION FAILED: underfunded build must not mutate wallet/grid, got %/% turret %', v_credits, v_alloys, v_turret;
  end if;
end $$;
-- Restore A's funding for the launch cases.
set local role postgres;
update public.players set credits = 1000000 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

-- ---------------------------------------------------------------------
-- 3. Garrison deduction at launch (B1). g-launch-src (shipyard 3 → fleetCap
--    3000, garrison 1000): launch 400 → garrison 600 / fleet 400; a second
--    launch of 700 (garrison 600 < 700) → 'insufficient garrison' with NO
--    state change; g-cap-src (shipyard 1 → fleetCap 1000): a 1,500-soldier
--    launch → 'fleet cap exceeded' with NO state change.
-- ---------------------------------------------------------------------
set local role authenticated;
do $$ begin
  if (select public.launch_attack('g-launch-tgt', 400, 'g-launch-src'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: 400-soldier launch must be inbound';
  end if;
end $$;
set local role postgres;
do $$
declare v_gar double precision; v_fleet double precision;
begin
  select garrison, fleet into v_gar, v_fleet from public.owned_planets where planet_name = 'g-launch-src';
  if v_gar <> 600 or v_fleet <> 400 then
    raise exception '8653 ASSERTION FAILED: post-launch state expected garrison 600 fleet 400, got %/%', v_gar, v_fleet;
  end if;
end $$;
set local role authenticated;
do $$
declare v_gar double precision; v_fleet double precision;
begin
  begin
    -- A SECOND launch at g-launch-tgt would hit join-first (returns
    -- attack_in_flight, not a raise), so the over-garrison probe uses a FRESH
    -- target — g-launch-src now holds only 600, so 700 soldiers must raise.
    perform public.launch_attack('g-launch-tgt2', 700, 'g-launch-src');
    raise exception '8653 ASSERTION FAILED: 700-soldier launch over a 600 garrison must raise';
  exception
    when others then
      if sqlerrm !~ 'insufficient garrison' then raise; end if;
  end;
  -- state unchanged by the rejected launch.
  select garrison, fleet into v_gar, v_fleet from public.owned_planets where planet_name = 'g-launch-src';
  if v_gar <> 600 or v_fleet <> 400 then
    raise exception '8653 ASSERTION FAILED: rejected launch must not mutate garrison/fleet, got %/%', v_gar, v_fleet;
  end if;
end $$;
do $$
declare v_gar double precision; v_fleet double precision;
begin
  begin
    perform public.launch_attack('g-cap-tgt', 1500, 'g-cap-src');
    raise exception '8653 ASSERTION FAILED: 1500-soldier launch over a 1000 fleet cap must raise';
  exception
    when others then
      if sqlerrm !~ 'fleet cap exceeded' then raise; end if;
  end;
  select garrison, fleet into v_gar, v_fleet from public.owned_planets where planet_name = 'g-cap-src';
  if v_gar <> 5000 or v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: fleet-cap rejection must not mutate garrison/fleet, got %/%', v_gar, v_fleet;
  end if;
end $$;

-- Expire the launch-guard attack (g-launch-tgt, launched at now()) out of A's
-- weariness window so the later ratio cases resolve at 1.0 — the launch-guard
-- state assertions above are time-independent (the rejected 700/1500 probes
-- never created attack rows).
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 'g-launch-tgt' and status = 'inbound';

-- ---------------------------------------------------------------------
-- 4. Survivor return — UNIFORM reading (B4): winner AND losers both return
--    committed − round(committed × loss_pct); fleet drains to 0. Decisive
--    gang: A 1000 (winner) + B 500 (loser) vs DP 0 → decisive; A's +0.6×
--    (600) returns to s-a, B's +0.6× (300) to s-b. Pyrrhic solo: A 1000 vs
--    DP 1000 → ratio 1.0 → pyrrhic; +0.3× (300) returns to s-c.
-- ---------------------------------------------------------------------
set local role authenticated;
do $$ begin
  if (select public.launch_attack('t-dec-gang', 1000, 's-a'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: gang launch must be inbound';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-dec-gang' and status = 'inbound';
  if (select public.join_attack(v_id, 500, 's-b'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: gang join must be inbound';
  end if;
end $$;
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-dec-gang' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-dec-gang' and status = 'inbound';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res jsonb;
  v_gar double precision; v_fleet double precision;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r where r->>'target_planet_name' = 't-dec-gang';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-dec-gang report missing';
  end if;
  if (v_res->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-dec-gang expected decisive, got %', v_res->>'outcome';
  end if;
  -- A (winner) returns 600; B (loser) returns 300 — UNIFORM (B4).
  select garrison, fleet into v_gar, v_fleet from public.owned_planets where planet_name = 's-a';
  if v_gar <> 1600 or v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: winner A source expected garrison 1600 fleet 0, got %/%', v_gar, v_fleet;
  end if;
  select garrison, fleet into v_gar, v_fleet from public.owned_planets where planet_name = 's-b';
  if v_gar <> 800 or v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: loser B source expected garrison 800 fleet 0, got %/%', v_gar, v_fleet;
  end if;
end $$;

-- Pyrrhic solo: +0.3× (300) returns to s-c.
set local role authenticated;
do $$ begin
  if (select public.launch_attack('t-pyr-gang', 1000, 's-c'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: pyrrhic launch must be inbound';
  end if;
end $$;
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-pyr-gang' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-pyr-gang' and status = 'inbound';
set local role authenticated;
do $$
declare
  v_res jsonb;
  v_gar double precision; v_fleet double precision;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r where r->>'target_planet_name' = 't-pyr-gang';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-pyr-gang report missing';
  end if;
  if (v_res->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-pyr-gang expected pyrrhic, got %', v_res->>'outcome';
  end if;
  if (v_res->>'ratio')::numeric <> 1.0 then
    raise exception '8653 ASSERTION FAILED: t-pyr-gang expected ratio 1.0, got %', v_res->>'ratio';
  end if;
  -- +0.3× survivors: 1000 − round(1000×0.7) = 300.
  select garrison, fleet into v_gar, v_fleet from public.owned_planets where planet_name = 's-c';
  if v_gar <> 800 or v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: pyrrhic source expected garrison 800 fleet 0, got %/%', v_gar, v_fleet;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Loser deduction (repelled +0.4×, crushed +0.1×). Repelled: A 800 vs
--    DP 1000 → ratio 0.8 → survivors 320 (+0.4×). Crushed: A 400 vs DP 1000
--    → ratio 0.4 → survivors 40 (+0.1×). Report `losses` unchanged (round).
-- ---------------------------------------------------------------------
set local role authenticated;
do $$ begin
  if (select public.launch_attack('t-rep-ded', 800, 's-d'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: repelled-deduction launch must be inbound';
  end if;
end $$;
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-rep-ded' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-rep-ded' and status = 'inbound';
set local role authenticated;
do $$
declare
  v_res jsonb;
  v_gar double precision; v_fleet double precision;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r where r->>'target_planet_name' = 't-rep-ded';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-rep-ded report missing';
  end if;
  if (v_res->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-rep-ded expected repelled, got %', v_res->>'outcome';
  end if;
  -- report losses unchanged: round(800×0.6) = 480.
  if (v_res->0->'members'->0->>'losses')::numeric <> 480 then
    raise exception '8653 ASSERTION FAILED: t-rep-ded losses expected 480, got %', v_res->0->'members'->0->>'losses';
  end if;
  -- +0.4× survivors: 800 − 480 = 320.
  select garrison, fleet into v_gar, v_fleet from public.owned_planets where planet_name = 's-d';
  if v_gar <> 1520 or v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: repelled source expected garrison 1520 fleet 0, got %/%', v_gar, v_fleet;
  end if;
end $$;

set local role authenticated;
do $$ begin
  if (select public.launch_attack('t-cru-ded', 400, 's-e'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: crushed-deduction launch must be inbound';
  end if;
end $$;
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-cru-ded' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-cru-ded' and status = 'inbound';
set local role authenticated;
do $$
declare
  v_res jsonb;
  v_gar double precision; v_fleet double precision;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r where r->>'target_planet_name' = 't-cru-ded';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-cru-ded report missing';
  end if;
  if (v_res->>'outcome') <> 'crushed' then
    raise exception '8653 ASSERTION FAILED: t-cru-ded expected crushed, got %', v_res->>'outcome';
  end if;
  -- report losses unchanged: round(400×0.9) = 360.
  if (v_res->0->'members'->0->>'losses')::numeric <> 360 then
    raise exception '8653 ASSERTION FAILED: t-cru-ded losses expected 360, got %', v_res->0->'members'->0->>'losses';
  end if;
  -- +0.1× survivors: 400 − 360 = 40.
  select garrison, fleet into v_gar, v_fleet from public.owned_planets where planet_name = 's-e';
  if v_gar <> 640 or v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: crushed source expected garrison 640 fleet 0, got %/%', v_gar, v_fleet;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. source_planet_name integrity — the mid-flight source-loss edge (B5).
--    A launches 800 from s-loss to C's t-loss-tgt (ratio 0.8 → repelled).
--    While in flight, D conquers s-loss (DP 0 → decisive, s-loss transfers
--    to D and resets to garrison/fleet/pop = 0). A's attack then resolves:
--    A's 320 survivors return to s-loss UNCONDITIONALLY (now owned by D).
--    D's attack is made due BEFORE A's so the conquest lands first.
-- ---------------------------------------------------------------------
set local role authenticated;
do $$ begin
  if (select public.launch_attack('t-loss-tgt', 800, 's-loss'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: loss-edge launch must be inbound';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('s-loss', 100, 'd-src'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: D conquest launch must be inbound';
  end if;
end $$;

set local role postgres;
-- D's conquest lands first (earlier resolves_at); A's loss-edge resolves second.
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name in ('t-loss-tgt','s-loss') and status = 'inbound';
update public.attacks set resolves_at = now() - interval '2 seconds'
 where target_planet_name = 's-loss' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-loss-tgt' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res jsonb;
  v_owner uuid; v_gar double precision; v_fleet double precision;
begin
  -- resolving as A runs BOTH resolutions (side-effects always run; the
  -- response only gates reports). A's report for t-loss-tgt is returned.
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r where r->>'target_planet_name' = 't-loss-tgt';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-loss-tgt report missing';
  end if;
  if (v_res->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-loss-tgt expected repelled, got %', v_res->>'outcome';
  end if;
  -- s-loss changed owner mid-flight (D conquered it) but survivors STILL
  -- return: garrison = 0 (conquest reset) + 320 (A's repelled survivors).
  select owner_id, garrison, fleet into v_owner, v_gar, v_fleet from public.owned_planets where planet_name = 's-loss';
  if v_owner is distinct from 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' then
    raise exception '8653 ASSERTION FAILED: s-loss must transfer to D mid-flight';
  end if;
  if v_gar <> 320 or v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: s-loss must return 320 survivors to the NEW owner (B5), got gar % fleet %', v_gar, v_fleet;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. get_attack roster per-member weariness (B7). B's prior IN-FLIGHT
--    throwaway (t-bw, in-window) gives B a 1.2× stack; A is fresh (1.0×).
--    get_attack's roster must surface each member's OWN stack.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-bw', 100, 's-b'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-bw throwaway launch must be inbound';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-roster', 100, 's-a'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-roster launch must be inbound';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-roster' and status = 'inbound';
  if (select public.join_attack(v_id, 100, 's-b'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-roster join must be inbound';
  end if;
end $$;

-- Backdate the roster attack so A reads FRESH (1.0) while B's in-window
-- throwaway (t-bw, never backdated) keeps B at 1.2 — the per-member contrast.
set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-roster' and status = 'inbound';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_get jsonb;
  v_a_wear numeric; v_b_wear numeric;
begin
  select id into v_id from public.attacks where target_planet_name = 't-roster' and status = 'inbound';
  v_get := public.get_attack(v_id);
  if (v_get->>'found') <> 'true' then
    raise exception '8653 ASSERTION FAILED: launcher must read the roster via get_attack';
  end if;
  -- A fresh → 1.0; B with the in-window t-bw in-flight prior → 1.2.
  select (m->>'weariness')::numeric into v_a_wear
    from jsonb_array_elements(v_get->'members') m where m->>'player_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select (m->>'weariness')::numeric into v_b_wear
    from jsonb_array_elements(v_get->'members') m where m->>'player_id' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_a_wear is distinct from 1.0 then
    raise exception '8653 ASSERTION FAILED: fresh member roster weariness expected 1.0, got %', v_a_wear;
  end if;
  if v_b_wear is distinct from 1.2 then
    raise exception '8653 ASSERTION FAILED: weary member roster weariness expected 1.2 (in-flight prior), got %', v_b_wear;
  end if;
end $$;

set local role postgres;

rollback;
