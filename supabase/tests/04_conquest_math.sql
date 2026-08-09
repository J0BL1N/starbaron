-- =====================================================================
-- 04_conquest_math
-- Purpose   : P3-T03-B exact conquest-math contract tests against the
--             applied 0001-0010 migration set. Pins the DESIGN §5a
--             resolver math EXACTLY (integer-boundary recipes — never a
--             repeating-decimal ratio, audit §6.1) plus the P3-T03-B D1
--             AP→effectiveLevel alignment (0010):
--               * all four §5a outcome buckets at their exact integer
--                 boundaries (ratio 1.5 decisive / 1.0 pyrrhic / 0.75
--                 repelled / 0.748 crushed) with per-member casualty pins
--                 (loss 0.4 / 0.7 / 0.6 / 0.9).
--               * the zero-DP guard (AP>0 → ratio 9999, decisive) and the
--                 zero-AP guard (tier-0 shipyard → ratio 0, crushed).
--               * the massiveWorld DP pin (×1.1) and the effectiveLevel
--                 turret DP pin (turrets 11 → 500 × 10.5 = 5250).
--               * the D1 effectiveLevel AP pin: tier-15 shipyard → AP =
--                 soldiers × effectiveLevel(15) = soldiers × 12.5 (raw
--                 tier would give × 15) — proves the resolver applies
--                 half-after-10 to AP, exactly as it does to turret DP.
--               * transfer + turret destruction on a win (owner := winner,
--                 grid minus defenseTurret, population/garrison/fleet = 0,
--                 is_home/unconquerable = false, economy keys survive).
--               * repelled → defender population × 0.7 with turrets fully
--                 surviving (B4 v1 exclusion) and crushed → no defender
--                 change.
--               * war-weariness stacking: a launcher with 2 prior launches
--                 in the 24h window faces 1.2^2 = 1.44 (§5a B1 semantics).
--             Bands: one band-together case (two members, per-member AP +
--             casualties, winner = highest committer) PLUS the equal-commit
--             winner tie-break (0010:173 order: soldiers_committed desc,
--             joined_at asc, player_id asc) — earlier joiner wins, and
--             identical joined_at falls to the lower player_id.
-- Run      : npx --no-install supabase db query --linked -f supabase/tests/04_conquest_math.sql
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Actors + planet seed. A = attacker (main launcher), B = defender (owns
-- every target), C = band-together joiner. Each bucket uses its OWN target
-- planet so DP/AP recipes are independent.
-- ---------------------------------------------------------------------
insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@test.local', now(), now());

-- A: home + six shipyard-tier sources (3 / 15 / 0 / 1 / 11 / 21).
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('alpha-math', 2::smallint);
  perform public.claim_colony('a3-math',  1::smallint);
  perform public.claim_colony('a15-math', 1::smallint);
  perform public.claim_colony('a0-math',  1::smallint);
  perform public.claim_colony('a1-math',  1::smallint);
  perform public.claim_colony('a11-math', 1::smallint);
  perform public.claim_colony('a21-math', 1::smallint);
end $$;

-- B: home + every target colony.
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('beta-math', 2::smallint);
  perform public.claim_colony('t-dec',      1::smallint);
  perform public.claim_colony('t-pyrrhic',  1::smallint);
  perform public.claim_colony('t-repelled', 1::smallint);
  perform public.claim_colony('t-crushed',  1::smallint);
  perform public.claim_colony('t-zdp',      1::smallint);
  perform public.claim_colony('t-zap',      1::smallint);
  perform public.claim_colony('t-mw',       1::smallint, 5, true);
  perform public.claim_colony('t-efft',     1::smallint);
  perform public.claim_colony('t-effap',    1::smallint);
  perform public.claim_colony('t-rep30',    1::smallint);
  perform public.claim_colony('t-band',     1::smallint);
  perform public.claim_colony('t-tie1',     1::smallint);
  perform public.claim_colony('t-tie2',     1::smallint);
  perform public.claim_colony('t-wear1',    1::smallint);
  perform public.claim_colony('t-wear2',    1::smallint);
  perform public.claim_colony('t-wear',     1::smallint);
  perform public.claim_colony('t-below15',  1::smallint);
  perform public.claim_colony('t-below10',  1::smallint);
  perform public.claim_colony('t-zero0',    1::smallint);
  perform public.claim_colony('t-mwflip',   1::smallint, 5, true);
  perform public.claim_colony('t-mwctl',    1::smallint);
  perform public.claim_colony('t-efft21',   1::smallint);
  perform public.claim_colony('t-ap11',     1::smallint);
  perform public.claim_colony('t-ap21',     1::smallint);
  perform public.claim_colony('t-rounddec', 1::smallint);
  perform public.claim_colony('t-roundfl',  1::smallint);
  perform public.claim_colony('t-repodd',   1::smallint);
  perform public.claim_colony('t-pop0',     1::smallint);
  perform public.claim_colony('t-we1',      1::smallint);
  perform public.claim_colony('t-wexp',     1::smallint);
  perform public.claim_colony('t-we2',      1::smallint);
  perform public.claim_colony('t-winc',     1::smallint);
  perform public.claim_colony('t-wt1',      1::smallint);
  perform public.claim_colony('t-wt2',      1::smallint);
  perform public.claim_colony('t-wt3',      1::smallint);
  perform public.claim_colony('t-w3',       1::smallint);
end $$;

-- C: home + a tier-3 shipyard source for the band-together join.
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('gamma-math', 1::smallint);
  perform public.claim_colony('c3-math', 1::smallint);
end $$;

-- Direct seed (as postgres): backdate B/C shields, fund A/C, set source
-- shipyard tiers and every target's turrets/population/quirk.
update public.players set created_at = now() - interval '10 days'
 where id in ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
update public.players set credits = 1000000
 where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc');

update public.owned_planets set structure_levels = structure_levels || '{"shipyard":3}'  where planet_name = 'a3-math';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":15}' where planet_name = 'a15-math';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":0}'  where planet_name = 'a0-math';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":1}'  where planet_name = 'a1-math';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":3}'  where planet_name = 'c3-math';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":11}' where planet_name = 'a11-math';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":21}' where planet_name = 'a21-math';

-- Target grids. t-dec also carries economy keys (oreMine 5, shipyard 2) to
-- prove non-defense structures SURVIVE a conquest (transfer removes only
-- defenseTurret, §5 line 129 LOCKED).
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3,"oreMine":5,"shipyard":2}' where planet_name = 't-dec';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name = 't-pyrrhic';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name = 't-repelled';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name = 't-crushed';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":0}' where planet_name = 't-zdp';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":1}' where planet_name = 't-zap';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}' where planet_name = 't-mw';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":11}' where planet_name = 't-efft';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}' where planet_name = 't-effap';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}' where planet_name = 't-rep30';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name = 't-band';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name = 't-tie1';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name = 't-tie2';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name = 't-wear';
update public.owned_planets set population = 1000 where planet_name in ('t-mw','t-rep30');

-- P3-T03-C additions (just-below / zero-zero / MW flip / effLevel 21 / AP
-- tier-11-21 / rounding / empty-pop / weariness-window targets).
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}'  where planet_name = 't-below15';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}'  where planet_name = 't-below10';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":0}'  where planet_name = 't-zero0';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}'  where planet_name = 't-mwflip';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}'  where planet_name = 't-mwctl';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":21}' where planet_name = 't-efft21';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}'  where planet_name = 't-ap11';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}'  where planet_name = 't-ap21';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}'  where planet_name = 't-rounddec';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":0}'  where planet_name = 't-roundfl';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}'  where planet_name = 't-repodd';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":2}'  where planet_name = 't-pop0';
update public.owned_planets set population = 1001 where planet_name = 't-repodd';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name in ('t-wexp','t-winc','t-w3');

-- ---------------------------------------------------------------------
-- Recipe table (D1-aligned AP; effectiveLevel(tier) for tier ≤ 10 == tier,
-- so the integer-boundary recipes are unchanged; the effap case pins the
-- >10 half-after-10 path):
--   target  | turret | pop  | quirk | soldiers × source tier | AP  | DP  | ratio | outcome
--   t-dec   | 3      | 0    | —     | 750 × 3                | 2250| 1500| 1.5   | decisive
--   t-pyrrhic| 3     | 0    | —     | 500 × 3                | 1500| 1500| 1.0   | pyrrhic
--   t-repelled| 3    | 0    | —     | 375 × 3                | 1125| 1500| 0.75  | repelled
--   t-crushed| 3     | 0    | —     | 374 × 3                | 1122| 1500| 0.748 | crushed
--   t-zdp   | 0      | 0    | —     | 100 × 1                | 100 | 0   | 9999  | decisive
--   t-zap   | 1      | 0    | —     | 100 × 0                | 0   | 500 | 0     | crushed
--   t-mw    | 2      | 1000 | mw    | 200 × 3                | 600 | 1265| 0.474 | crushed
--   t-efft  | 11     | 0    | —     | 200 × 3                | 600 | 5250| 0.114 | crushed
--   t-effap | 2      | 0    | —     | 120 × 15 → eff 12.5    | 1500| 1000| 1.5   | decisive
--   t-rep30 | 2      | 1000 | —     | 300 × 3                | 900 | 1150| 0.7826| repelled
--   t-band  | 3      | 0    | —     | A 500×3 + C 250×3      | 2250| 1500| 1.5   | decisive
--   t-tie1  | 3      | 0    | —     | A 250×3 + C 250×3      | 1500| 1500| 1.0   | pyrrhic (winner A: earlier joined_at)
--   t-tie2  | 3      | 0    | —     | A 250×3 + C 250×3      | 1500| 1500| 1.0   | pyrrhic (winner A: lower player_id)
--   t-wear  | 3      | 0    | —     | 750 × 3 (2 prior)      | 2250| 1500| 1.0417| pyrrhic (weariness 1.44)
--   (P3-T03-C) just-below / zero-zero / MW-flip / rounding / weariness pins:
--   t-below15 | 3    | 0    | —     | 749 × 3                | 2247| 1500| 1.498 | pyrrhic
--   t-below10 | 3    | 0    | —     | 499 × 3                | 1497| 1500| 0.998 | repelled
--   t-zero0   | 0    | 0    | —     | 100 × 0                | 0   | 0   | 0     | crushed (no crash)
--   t-mwflip  | 2    | 0    | mw    | 350 × 3                | 1050| 1100| 0.9545| repelled
--   t-mwctl   | 2    | 0    | —     | 350 × 3                | 1050| 1000| 1.05  | pyrrhic
--   t-efft21  | 21   | 0    | —     | 200 × 3                | 600 | 7750| 0.0774| crushed
--   t-ap11    | 2    | 0    | —     | 100 × 11 → eff 10.5    | 1050| 1000| 1.05  | pyrrhic
--   t-ap21    | 2    | 0    | —     | 100 × 21 → eff 15.5    | 1550| 1000| 1.55  | decisive
--   t-rounddec| 2    | 0    | —     | 501 × 3                | 1503| 1000| 1.503 | decisive (losses 200)
--   t-roundfl | 0    | 0    | —     | 12 × 3                 | 36  | 0   | 9999  | decisive (losses 5)
--   t-repodd  | 2    | 1001 | —     | 300 × 3                | 900 | 1150.15|0.7825| repelled (pop_after 701)
--   t-pop0    | 2    | 0    | —     | 200 × 3                | 600 | 1000| 0.6   | crushed (turrets only)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. decisive boundary (ratio exactly 1.5): 750 × tier 3 = 2250 vs 1500.
--    Also the transfer + turret-destruction + economy-survival pin.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-dec', 750, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-dec launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-dec' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-dec' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-dec expected decisive, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.5 then
    raise exception '8653 ASSERTION FAILED: t-dec expected ratio 1.5, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'combined_ap')::numeric <> 2250 then
    raise exception '8653 ASSERTION FAILED: t-dec expected AP 2250, got %', v_res->0->>'combined_ap';
  end if;
  if (v_res->0->>'defense_power')::numeric <> 1500 then
    raise exception '8653 ASSERTION FAILED: t-dec expected DP 1500, got %', v_res->0->>'defense_power';
  end if;
  if (v_res->0->>'planet_taken') <> 'true' then
    raise exception '8653 ASSERTION FAILED: t-dec decisive must take the planet';
  end if;
  -- first conquest of a 24h window → weariness 1.0x (B1 semantics).
  if (v_res->0->>'war_weariness_multiplier')::numeric <> 1.0 then
    raise exception '8653 ASSERTION FAILED: t-dec expected weariness 1.0 (0 prior), got %', v_res->0->>'war_weariness_multiplier';
  end if;
  -- casualty pin: loss 0.4 → round(750 × 0.4) = 300.
  if (v_res->0->'members'->0->>'losses')::numeric <> 300 then
    raise exception '8653 ASSERTION FAILED: t-dec member losses expected 300, got %', v_res->0->'members'->0->>'losses';
  end if;
  if (v_res->0->'members'->0->>'ap')::numeric <> 2250 then
    raise exception '8653 ASSERTION FAILED: t-dec member ap expected 2250, got %', v_res->0->'members'->0->>'ap';
  end if;
end $$;

-- Transfer + turret destruction + economy survival (read as postgres).
do $$
declare
  v_owner  uuid;
  v_turret int;
  v_ore    int;
  v_ship   int;
  v_pop    double precision;
  v_gar    double precision;
  v_fleet  double precision;
  v_home   boolean;
  v_unc    boolean;
begin
  select owner_id, population, garrison, fleet, is_home, unconquerable,
         coalesce((structure_levels->>'defenseTurret')::int, -1),
         coalesce((structure_levels->>'oreMine')::int, -1),
         coalesce((structure_levels->>'shipyard')::int, -1)
    into v_owner, v_pop, v_gar, v_fleet, v_home, v_unc, v_turret, v_ore, v_ship
    from public.owned_planets where planet_name = 't-dec';
  if v_owner is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: t-dec owner must transfer to the winner';
  end if;
  if v_turret <> -1 then
    raise exception '8653 ASSERTION FAILED: t-dec defenseTurret must be destroyed';
  end if;
  if v_ore <> 5 or v_ship <> 2 then
    raise exception '8653 ASSERTION FAILED: t-dec economy structures must survive (ore=%, ship=%)', v_ore, v_ship;
  end if;
  if v_pop <> 0 or v_gar <> 0 or v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: t-dec population/garrison/fleet must reset to 0';
  end if;
  if v_home or v_unc then
    raise exception '8653 ASSERTION FAILED: t-dec must be non-home and conquerable post-transfer';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. pyrrhic boundary (ratio exactly 1.0): 500 × tier 3 = 1500 vs 1500.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-pyrrhic', 500, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-pyrrhic launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-pyrrhic' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-pyrrhic' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-pyrrhic expected pyrrhic, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.0 then
    raise exception '8653 ASSERTION FAILED: t-pyrrhic expected ratio 1.0, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'combined_ap')::numeric <> 1500 then
    raise exception '8653 ASSERTION FAILED: t-pyrrhic expected AP 1500, got %', v_res->0->>'combined_ap';
  end if;
  if (v_res->0->>'planet_taken') <> 'true' then
    raise exception '8653 ASSERTION FAILED: t-pyrrhic must take the planet';
  end if;
  -- casualty pin: loss 0.7 → round(500 × 0.7) = 350.
  if (v_res->0->'members'->0->>'losses')::numeric <> 350 then
    raise exception '8653 ASSERTION FAILED: t-pyrrhic member losses expected 350, got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. repelled boundary (ratio exactly 0.75): 375 × tier 3 = 1125 vs 1500.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-repelled', 375, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-repelled launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-repelled' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-repelled' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-repelled expected repelled, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'ratio')::numeric <> 0.75 then
    raise exception '8653 ASSERTION FAILED: t-repelled expected ratio 0.75, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'planet_taken') <> 'false' then
    raise exception '8653 ASSERTION FAILED: t-repelled must NOT take the planet';
  end if;
  -- casualty pin: loss 0.6 → round(375 × 0.6) = 225.
  if (v_res->0->'members'->0->>'losses')::numeric <> 225 then
    raise exception '8653 ASSERTION FAILED: t-repelled member losses expected 225, got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. crushed just-below boundary (ratio 0.748 < 0.75): 374 × tier 3 = 1122.
--    Also the crushed → no defender change pin (population + turrets intact).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-crushed', 374, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-crushed launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-crushed' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-crushed' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'crushed' then
    raise exception '8653 ASSERTION FAILED: t-crushed expected crushed, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'ratio')::numeric <> 0.748 then
    raise exception '8653 ASSERTION FAILED: t-crushed expected ratio 0.748, got %', v_res->0->>'ratio';
  end if;
  -- casualty pin: loss 0.9 → round(374 × 0.9) = round(336.6) = 337.
  if (v_res->0->'members'->0->>'losses')::numeric <> 337 then
    raise exception '8653 ASSERTION FAILED: t-crushed member losses expected 337, got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

do $$
declare v_owner uuid; v_pop double precision; v_turret int;
begin
  select owner_id, population, coalesce((structure_levels->>'defenseTurret')::int, -1)
    into v_owner, v_pop, v_turret
    from public.owned_planets where planet_name = 't-crushed';
  if v_owner is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: t-crushed owner must be unchanged';
  end if;
  if v_pop <> 0 or v_turret <> 3 then
    raise exception '8653 ASSERTION FAILED: t-crushed defender must be unchanged (pop=%, turret=%)', v_pop, v_turret;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. zero-DP guard: AP 100 > 0, DP 0 → ratio 9999 → decisive. No div/0.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-zdp', 100, 'a1-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-zdp launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-zdp' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-zdp' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'ratio')::numeric <> 9999 then
    raise exception '8653 ASSERTION FAILED: t-zdp expected ratio 9999, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-zdp expected decisive, got %', v_res->0->>'outcome';
  end if;
  -- casualty pin: loss 0.4 → round(100 × 0.4) = 40.
  if (v_res->0->'members'->0->>'losses')::numeric <> 40 then
    raise exception '8653 ASSERTION FAILED: t-zdp member losses expected 40, got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. zero-AP guard: tier-0 shipyard source, soldiers 100 → AP 0 vs DP 500
--    → ratio 0 → crushed (audit edge #5: constructible per T02 finding).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-zap', 100, 'a0-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-zap launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-zap' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-zap' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'ratio')::numeric <> 0 then
    raise exception '8653 ASSERTION FAILED: t-zap expected ratio 0, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'crushed' then
    raise exception '8653 ASSERTION FAILED: t-zap expected crushed, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'combined_ap')::numeric <> 0 then
    raise exception '8653 ASSERTION FAILED: t-zap expected combined AP 0, got %', v_res->0->>'combined_ap';
  end if;
  if (v_res->0->'members'->0->>'ap')::numeric <> 0 then
    raise exception '8653 ASSERTION FAILED: t-zap member ap expected 0, got %', v_res->0->'members'->0->>'ap';
  end if;
  -- casualty pin: loss 0.9 → round(100 × 0.9) = 90.
  if (v_res->0->'members'->0->>'losses')::numeric <> 90 then
    raise exception '8653 ASSERTION FAILED: t-zap member losses expected 90, got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. massiveWorld DP pin: (500×2 + 0.15×1000) × 1.1 = 1265.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-mw', 200, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-mw launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-mw' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-mw' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'defense_power')::numeric <> 1265 then
    raise exception '8653 ASSERTION FAILED: t-mw expected DP 1265, got %', v_res->0->>'defense_power';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. effectiveLevel turret DP pin (server-side, P2 fix): turrets 11 →
--    effective 10.5 → DP 500 × 10.5 = 5250.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-efft', 200, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-efft launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-efft' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-efft' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'defense_power')::numeric <> 5250 then
    raise exception '8653 ASSERTION FAILED: t-efft expected DP 5250, got %', v_res->0->>'defense_power';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. D1 effectiveLevel AP pin: tier-15 shipyard → AP = soldiers ×
--    effectiveLevel(15) = × 12.5 (raw × 15 would give 1800). 120 × 12.5 =
--    1500 vs DP 1000 → ratio exactly 1.5 → decisive. This is the regression
--    guard for 0010: RAW tier would push the ratio to 1.8 (still decisive,
--    wrong AP), so the combined_ap + member ap + ratio pins catch it.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-effap', 120, 'a15-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-effap launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-effap' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-effap' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'combined_ap')::numeric <> 1500 then
    raise exception '8653 ASSERTION FAILED: t-effap expected AP 1500 (effectiveLevel 12.5), got %', v_res->0->>'combined_ap';
  end if;
  if (v_res->0->'members'->0->>'ap')::numeric <> 1500 then
    raise exception '8653 ASSERTION FAILED: t-effap member ap expected 1500, got %', v_res->0->'members'->0->>'ap';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.5 then
    raise exception '8653 ASSERTION FAILED: t-effap expected ratio 1.5, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-effap expected decisive, got %', v_res->0->>'outcome';
  end if;
  -- casualty pin: loss 0.4 → round(120 × 0.4) = 48.
  if (v_res->0->'members'->0->>'losses')::numeric <> 48 then
    raise exception '8653 ASSERTION FAILED: t-effap member losses expected 48, got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. repelled 30% population pin: t2 turrets + pop 1000 (DP 1150), AP 900
--     → ratio 0.7826 repelled; defender population 1000 → 700; turrets
--     fully survive (B4 v1 exclusion — defenseTurret key still present).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-rep30', 300, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-rep30 launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-rep30' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-rep30' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-rep30 expected repelled, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'ratio')::numeric <> 0.7826 then
    raise exception '8653 ASSERTION FAILED: t-rep30 expected ratio 0.7826, got %', v_res->0->>'ratio';
  end if;
  -- casualty pin: loss 0.6 → round(300 × 0.6) = 180.
  if (v_res->0->'members'->0->>'losses')::numeric <> 180 then
    raise exception '8653 ASSERTION FAILED: t-rep30 member losses expected 180, got %', v_res->0->'members'->0->>'losses';
  end if;
  if (v_res->0->'defender'->>'population_after')::numeric <> 700 then
    raise exception '8653 ASSERTION FAILED: t-rep30 report population_after expected 700, got %', v_res->0->'defender'->>'population_after';
  end if;
end $$;

do $$
declare v_owner uuid; v_pop double precision; v_turret int;
begin
  select owner_id, population, coalesce((structure_levels->>'defenseTurret')::int, -1)
    into v_owner, v_pop, v_turret
    from public.owned_planets where planet_name = 't-rep30';
  if v_owner is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: t-rep30 owner must be unchanged';
  end if;
  if v_pop <> 700 then
    raise exception '8653 ASSERTION FAILED: t-rep30 stored population expected 700, got %', v_pop;
  end if;
  if v_turret <> 2 then
    raise exception '8653 ASSERTION FAILED: t-rep30 turrets must fully survive (B4), got %', v_turret;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. band-together + per-member casualty + winner pin: A 500×3 (AP 1500),
--     C 250×3 (AP 750) vs DP 1500 → ratio 1.5 decisive; winner = A (500 >
--     250); A losses round(500×0.4)=200, C losses round(250×0.4)=100.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-band', 500, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-band launch must be inbound';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks
   where target_planet_name = 't-band' and status = 'inbound';
  if (select public.join_attack(v_id, 250, 'c3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-band join must keep the attack inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-band' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-band' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res jsonb;
  v_a_ap numeric; v_a_los numeric; v_c_ap numeric; v_c_los numeric;
  v_n    int;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-band expected decisive, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'combined_ap')::numeric <> 2250 then
    raise exception '8653 ASSERTION FAILED: t-band expected combined AP 2250, got %', v_res->0->>'combined_ap';
  end if;
  if (v_res->0->>'winner_id') is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: t-band winner must be the highest committer (A)';
  end if;
  select jsonb_array_length(v_res->0->'members') into v_n;
  if v_n <> 2 then
    raise exception '8653 ASSERTION FAILED: t-band expected 2 members, got %', v_n;
  end if;
  -- per-member casualties: A 200, C 100 (band-together casualty pin).
  select (m->>'losses')::numeric into v_a_los
    from jsonb_array_elements(v_res->0->'members') m
   where m->>'player_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select (m->>'losses')::numeric into v_c_los
    from jsonb_array_elements(v_res->0->'members') m
   where m->>'player_id' = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  select (m->>'ap')::numeric into v_a_ap
    from jsonb_array_elements(v_res->0->'members') m
   where m->>'player_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select (m->>'ap')::numeric into v_c_ap
    from jsonb_array_elements(v_res->0->'members') m
   where m->>'player_id' = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if v_a_ap is distinct from 1500 or v_c_ap is distinct from 750 then
    raise exception '8653 ASSERTION FAILED: t-band member APs expected 1500/750, got %/%', v_a_ap, v_c_ap;
  end if;
  if v_a_los is distinct from 200 or v_c_los is distinct from 100 then
    raise exception '8653 ASSERTION FAILED: t-band member losses expected 200/100, got %/%', v_a_los, v_c_los;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 12. equal-commit winner tie-break (§5 band-together; winner ORDER BY at
--     0010:173 = soldiers_committed desc, joined_at asc, player_id asc).
--     A and C commit EQUAL soldiers from EQUAL-tier sources (a3/c3, AP 750
--     each) so commitment cannot decide — the winner must fall to the
--     tie-break terms. now() is transaction-fixed in this suite, so the two
--     membership joined_at defaults would be IDENTICAL; set them explicitly:
--       * t-tie1: A joins EARLIER than C → A must win (joined_at asc).
--       * t-tie2: A and C join at the SAME timestamp → A must win
--         (player_id asc; aaaa… < cccc…).
--     Outcome pyrrhic (ratio 1.0) — the winner term runs for pyrrhic too.
--     Both attacks backdated out of the 24h window (weariness count safe).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-tie1', 250, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-tie1 launch must be inbound';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks
   where target_planet_name = 't-tie1' and status = 'inbound';
  if (select public.join_attack(v_id, 250, 'c3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-tie1 join must keep the attack inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-tie1' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-tie1' and status = 'inbound';
-- Deterministic joined_at: A the EARLIER joiner, C the later.
update public.attack_members set joined_at = now() - interval '2 days'
 where attack_id = (select id from public.attacks where target_planet_name = 't-tie1')
   and player_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.attack_members set joined_at = now()
 where attack_id = (select id from public.attacks where target_planet_name = 't-tie1')
   and player_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res  jsonb;
  v_a_ap numeric; v_c_ap numeric;
  v_a_los numeric; v_c_los numeric;
  v_n    int;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-tie1 expected pyrrhic, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.0 then
    raise exception '8653 ASSERTION FAILED: t-tie1 expected ratio 1.0, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'combined_ap')::numeric <> 1500 then
    raise exception '8653 ASSERTION FAILED: t-tie1 expected combined AP 1500, got %', v_res->0->>'combined_ap';
  end if;
  -- EQUAL commits → tie-break fires: the EARLIER joiner (A) must win.
  if (v_res->0->>'winner_id') is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: t-tie1 equal-commit winner must be the earlier joiner (A), got %', v_res->0->>'winner_id';
  end if;
  if (v_res->0->>'planet_taken') <> 'true' then
    raise exception '8653 ASSERTION FAILED: t-tie1 pyrrhic must take the planet';
  end if;
  select jsonb_array_length(v_res->0->'members') into v_n;
  if v_n <> 2 then
    raise exception '8653 ASSERTION FAILED: t-tie1 expected 2 members, got %', v_n;
  end if;
  select (m->>'ap')::numeric into v_a_ap
    from jsonb_array_elements(v_res->0->'members') m
   where m->>'player_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select (m->>'ap')::numeric into v_c_ap
    from jsonb_array_elements(v_res->0->'members') m
   where m->>'player_id' = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  -- Equal AP is the precondition that forces the tie-break.
  if v_a_ap is distinct from 750 or v_c_ap is distinct from 750 then
    raise exception '8653 ASSERTION FAILED: t-tie1 member APs must both be 750, got %/%', v_a_ap, v_c_ap;
  end if;
  -- casualty pin: pyrrhic loss 0.7 → round(250 × 0.7) = 175 each.
  select (m->>'losses')::numeric into v_a_los
    from jsonb_array_elements(v_res->0->'members') m
   where m->>'player_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select (m->>'losses')::numeric into v_c_los
    from jsonb_array_elements(v_res->0->'members') m
   where m->>'player_id' = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if v_a_los is distinct from 175 or v_c_los is distinct from 175 then
    raise exception '8653 ASSERTION FAILED: t-tie1 member losses expected 175/175, got %/%', v_a_los, v_c_los;
  end if;
end $$;

-- t-tie2: IDENTICAL joined_at → player_id asc must decide (A, lower id).
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-tie2', 250, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-tie2 launch must be inbound';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks
   where target_planet_name = 't-tie2' and status = 'inbound';
  if (select public.join_attack(v_id, 250, 'c3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-tie2 join must keep the attack inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-tie2' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-tie2' and status = 'inbound';
-- IDENTICAL joined_at for both members → player_id asc decides the winner.
update public.attack_members set joined_at = now()
 where attack_id = (select id from public.attacks where target_planet_name = 't-tie2')
   and player_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-tie2 expected pyrrhic, got %', v_res->0->>'outcome';
  end if;
  -- Equal joined_at → lower player_id (A, aaaa… < cccc…) must win.
  if (v_res->0->>'winner_id') is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: t-tie2 equal joined_at winner must be the lower player_id (A), got %', v_res->0->>'winner_id';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 13. war-weariness stack pin (B1 semantics): A launches 2 throwaways in
--     the 24h window + the pin, so the pin resolves against 1.2^2 = 1.44.
--     AP 2250 / (1500 × 1.44) = 1.0417 → pyrrhic (loss 0.7 → round(750 ×
--     0.7) = 525). Backdated prior buckets do not pollute the count; the
--     throwaways stay inbound (future resolves_at) and are expired out of
--     the window by the postlude below so the later cases resolve at 1.0.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-wear1', 100, 'a1-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-wear1 throwaway launch must be inbound';
  end if;
  if (select public.launch_attack('t-wear2', 100, 'a1-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-wear2 throwaway launch must be inbound';
  end if;
  if (select public.launch_attack('t-wear', 750, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-wear pin launch must be inbound';
  end if;
end $$;

-- Keep t-wear1/t-wear2 OUT of the due scan; make only the pin due.
set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-wear' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'war_weariness_multiplier')::numeric <> 1.44 then
    raise exception '8653 ASSERTION FAILED: t-wear expected weariness 1.44 (1.2^2), got %', v_res->0->>'war_weariness_multiplier';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.0417 then
    raise exception '8653 ASSERTION FAILED: t-wear expected ratio 1.0417 (2250/2160), got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-wear expected pyrrhic, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 525 then
    raise exception '8653 ASSERTION FAILED: t-wear member losses expected 525, got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- Postlude (P3-T03-D fix): the case-13 throwaways t-wear1/t-wear2 stay
-- inbound with launched_at = now() and the resolved t-wear pin also sits at
-- now() — all three would pollute the weariness count for every case that
-- follows (14-22 resolve with weariness 1.0, so their ratio recipes hold).
-- Expire them out of the 24h window here; case 23's own prelude re-expires
-- them idempotently. (Identical WHERE shape to the case-23 prelude.)
set local role postgres;
update public.attacks set launched_at = now() - interval '2 days'
 where launcher_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and launched_at >= now() - interval '24 hours';

-- ---------------------------------------------------------------------
-- 14. just-below 1.5 boundary: 749 × tier 3 = 2247 vs DP 1500 → ratio
--     1.498 < 1.5 → pyrrhic (NOT decisive). Inclusive >= pins 1.5 decisive;
--     one integer below must drop a bucket. loss 0.7 → round(749×0.7)=524.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-below15', 749, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-below15 launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-below15' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-below15' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'ratio')::numeric <> 1.498 then
    raise exception '8653 ASSERTION FAILED: t-below15 expected ratio 1.498, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-below15 expected pyrrhic, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 524 then
    raise exception '8653 ASSERTION FAILED: t-below15 losses expected 524 (round(749×0.7)), got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 15. just-below 1.0 boundary: 499 × tier 3 = 1497 vs DP 1500 → ratio
--     0.998 < 1.0 → repelled (NOT pyrrhic). loss 0.6 → round(499×0.6)=299.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-below10', 499, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-below10 launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-below10' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-below10' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'ratio')::numeric <> 0.998 then
    raise exception '8653 ASSERTION FAILED: t-below10 expected ratio 0.998, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-below10 expected repelled, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'planet_taken') <> 'false' then
    raise exception '8653 ASSERTION FAILED: t-below10 must NOT take the planet';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 299 then
    raise exception '8653 ASSERTION FAILED: t-below10 losses expected 299 (round(499×0.6)), got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 16. BOTH-zero edge (DP 0 AND AP 0): turrets 0 + pop 0 vs a tier-0
--     shipyard source (AP 0). The resolver guard falls through to
--     v_ratio := 0 → outcome CRUSHED — a DEFINED outcome, no crash, no
--     division by zero. (Estimator mirrors: estimateRatio(0,0) = 0.)
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-zero0', 100, 'a0-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-zero0 launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-zero0' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-zero0' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'ratio')::numeric <> 0 then
    raise exception '8653 ASSERTION FAILED: t-zero0 expected ratio 0, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'combined_ap')::numeric <> 0 then
    raise exception '8653 ASSERTION FAILED: t-zero0 expected combined AP 0, got %', v_res->0->>'combined_ap';
  end if;
  if (v_res->0->>'outcome') <> 'crushed' then
    raise exception '8653 ASSERTION FAILED: t-zero0 expected crushed (defined, no crash), got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'planet_taken') <> 'false' then
    raise exception '8653 ASSERTION FAILED: t-zero0 must NOT take the planet';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 90 then
    raise exception '8653 ASSERTION FAILED: t-zero0 losses expected 90 (round(100×0.9)), got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 17. massiveWorld boundary FLIP: identical attack stats against an
--     identical turret/pop grid — the MW target's DP ×1.1 drops the ratio
--     from pyrrhic (1.05, control) to repelled (0.9545). 350 × tier 3 =
--     1050 AP; base DP 1000 (t2) → MW DP 1100.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-mwctl', 350, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-mwctl launch must be inbound';
  end if;
  if (select public.launch_attack('t-mwflip', 350, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-mwflip launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name in ('t-mwctl','t-mwflip') and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name in ('t-mwctl','t-mwflip') and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res  jsonb;
  v_ctl  jsonb;
  v_flip jsonb;
begin
  v_res := public.resolve_due_attacks();
  select r into v_ctl from jsonb_array_elements(v_res) r where r->>'target_planet_name' = 't-mwctl';
  select r into v_flip from jsonb_array_elements(v_res) r where r->>'target_planet_name' = 't-mwflip';
  if v_ctl is null or v_flip is null then
    raise exception '8653 ASSERTION FAILED: t-mwctl/t-mwflip reports missing';
  end if;
  -- Control (non-massiveWorld): DP 1000, ratio 1.05 → pyrrhic.
  if (v_ctl->>'defense_power')::numeric <> 1000 then
    raise exception '8653 ASSERTION FAILED: t-mwctl expected DP 1000, got %', v_ctl->>'defense_power';
  end if;
  if (v_ctl->>'ratio')::numeric <> 1.05 then
    raise exception '8653 ASSERTION FAILED: t-mwctl expected ratio 1.05, got %', v_ctl->>'ratio';
  end if;
  if (v_ctl->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-mwctl expected pyrrhic, got %', v_ctl->>'outcome';
  end if;
  -- Flip (massiveWorld): DP ×1.1 = 1100, ratio 0.9545 → repelled.
  if (v_flip->>'defense_power')::numeric <> 1100 then
    raise exception '8653 ASSERTION FAILED: t-mwflip expected DP 1100 (×1.1), got %', v_flip->>'defense_power';
  end if;
  if (v_flip->>'ratio')::numeric <> 0.9545 then
    raise exception '8653 ASSERTION FAILED: t-mwflip expected ratio 0.9545 (1050/1100), got %', v_flip->>'ratio';
  end if;
  if (v_flip->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-mwflip expected repelled (MW flips the pyrrhic boundary), got %', v_flip->>'outcome';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 18. effectiveLevel turret DP pin at the HIGH end: turrets 21 →
--     effective 15.5 → DP 500 × 15.5 = 7750 (audit §2 DP table + estimator
--     parity). 200 × tier 3 = 600 AP → ratio 0.0774 → crushed.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-efft21', 200, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-efft21 launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-efft21' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-efft21' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'defense_power')::numeric <> 7750 then
    raise exception '8653 ASSERTION FAILED: t-efft21 expected DP 7750 (500×15.5), got %', v_res->0->>'defense_power';
  end if;
  if (v_res->0->>'outcome') <> 'crushed' then
    raise exception '8653 ASSERTION FAILED: t-efft21 expected crushed, got %', v_res->0->>'outcome';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 19. effectiveLevel AP parity at tiers 11 AND 21 (half-after-10, D1):
--     * t-ap11: 100 × effectiveLevel(11)=10.5 → AP 1050 (raw ×11 = 1100 —
--       the combined_ap pin catches a raw-tier regression). ratio 1.05 pyrrhic.
--     * t-ap21: 100 × effectiveLevel(21)=15.5 → AP 1550 (raw ×21 = 2100).
--       ratio 1.55 → decisive (losses round(100×0.4) = 40).
--     Together with t-effap (tier 15) these pin the 11/15/21 parity set.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-ap11', 100, 'a11-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-ap11 launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-ap11' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-ap11' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'combined_ap')::numeric <> 1050 then
    raise exception '8653 ASSERTION FAILED: t-ap11 expected AP 1050 (effectiveLevel(11)=10.5), got %', v_res->0->>'combined_ap';
  end if;
  if (v_res->0->'members'->0->>'ap')::numeric <> 1050 then
    raise exception '8653 ASSERTION FAILED: t-ap11 member ap expected 1050, got %', v_res->0->'members'->0->>'ap';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.05 then
    raise exception '8653 ASSERTION FAILED: t-ap11 expected ratio 1.05, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-ap11 expected pyrrhic, got %', v_res->0->>'outcome';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-ap21', 100, 'a21-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-ap21 launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-ap21' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-ap21' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'combined_ap')::numeric <> 1550 then
    raise exception '8653 ASSERTION FAILED: t-ap21 expected AP 1550 (effectiveLevel(21)=15.5), got %', v_res->0->>'combined_ap';
  end if;
  if (v_res->0->'members'->0->>'ap')::numeric <> 1550 then
    raise exception '8653 ASSERTION FAILED: t-ap21 member ap expected 1550, got %', v_res->0->'members'->0->>'ap';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.55 then
    raise exception '8653 ASSERTION FAILED: t-ap21 expected ratio 1.55, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-ap21 expected decisive, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 40 then
    raise exception '8653 ASSERTION FAILED: t-ap21 losses expected 40 (round(100×0.4)), got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 20. casualty rounding (attacker side) — resolver pins: losses are
--     round(soldiers × loss_pct), NOT floor:
--       * t-rounddec: 501 soldiers decisive → round(501×0.4)=round(200.4)=200
--         (ratio 1503/1000 = 1.503 ≥ 1.5).
--       * t-roundfl: 12 soldiers vs DP 0 (zero-DP → ratio 9999) decisive →
--         round(12×0.4)=round(4.8)=5 (floor would give 4 — discriminates).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-rounddec', 501, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-rounddec launch must be inbound';
  end if;
  if (select public.launch_attack('t-roundfl', 12, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-roundfl launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name in ('t-rounddec','t-roundfl') and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name in ('t-rounddec','t-roundfl') and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res  jsonb;
  v_dec  jsonb;
  v_fl   jsonb;
begin
  v_res := public.resolve_due_attacks();
  select r into v_dec from jsonb_array_elements(v_res) r where r->>'target_planet_name' = 't-rounddec';
  select r into v_fl from jsonb_array_elements(v_res) r where r->>'target_planet_name' = 't-roundfl';
  if v_dec is null or v_fl is null then
    raise exception '8653 ASSERTION FAILED: t-rounddec/t-roundfl reports missing';
  end if;
  if (v_dec->>'ratio')::numeric <> 1.503 then
    raise exception '8653 ASSERTION FAILED: t-rounddec expected ratio 1.503, got %', v_dec->>'ratio';
  end if;
  if (v_dec->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-rounddec expected decisive, got %', v_dec->>'outcome';
  end if;
  if (v_dec->'members'->0->>'losses')::numeric <> 200 then
    raise exception '8653 ASSERTION FAILED: t-rounddec losses expected 200 (round(501×0.4)), got %', v_dec->'members'->0->>'losses';
  end if;
  if (v_fl->>'ratio')::numeric <> 9999 then
    raise exception '8653 ASSERTION FAILED: t-roundfl expected ratio 9999 (zero-DP), got %', v_fl->>'ratio';
  end if;
  if (v_fl->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-roundfl expected decisive, got %', v_fl->>'outcome';
  end if;
  if (v_fl->'members'->0->>'losses')::numeric <> 5 then
    raise exception '8653 ASSERTION FAILED: t-roundfl losses expected 5 (round(12×0.4)=round(4.8) — floor would be 4), got %', v_fl->'members'->0->>'losses';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 21. defender pop-loss rounding on repelled with an ODD population: pop
--     1001 × 0.7 = 700.7. Report population_after = round(700.7) = 701;
--     the STORED population stays unrounded (700.7, float8). Turrets fully
--     survive (B4). ratio 900/1150.15 = 0.7825 → repelled.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-repodd', 300, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-repodd launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-repodd' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-repodd' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-repodd expected repelled, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'ratio')::numeric <> 0.7825 then
    raise exception '8653 ASSERTION FAILED: t-repodd expected ratio 0.7825, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->'defender'->>'population_before')::numeric <> 1001 then
    raise exception '8653 ASSERTION FAILED: t-repodd population_before expected 1001, got %', v_res->0->'defender'->>'population_before';
  end if;
  -- report population_after = round(1001 × 0.7) = round(700.7) = 701.
  if (v_res->0->'defender'->>'population_after')::numeric <> 701 then
    raise exception '8653 ASSERTION FAILED: t-repodd report population_after expected 701, got %', v_res->0->'defender'->>'population_after';
  end if;
end $$;

do $$
declare v_owner uuid; v_pop double precision; v_turret int;
begin
  select owner_id, population, coalesce((structure_levels->>'defenseTurret')::int, -1)
    into v_owner, v_pop, v_turret
    from public.owned_planets where planet_name = 't-repodd';
  if v_owner is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: t-repodd owner must be unchanged';
  end if;
  -- stored population is UNROUNDED (1001 × (1−0.3) ≈ 700.7), vs the report's round().
  if abs(v_pop - 700.7) > 0.001 then
    raise exception '8653 ASSERTION FAILED: t-repodd stored population expected ≈700.7, got %', v_pop;
  end if;
  if v_turret <> 2 then
    raise exception '8653 ASSERTION FAILED: t-repodd turrets must fully survive (B4), got %', v_turret;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 22. empty-pop colony (pop 0) with turrets: DP comes from turrets ONLY —
--     militia 0.15 × 0 = 0 contributes nothing. t2 turrets → DP 1000;
--     200 × tier 3 = 600 AP → ratio 0.6 → crushed, defender unchanged.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-pop0', 200, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-pop0 launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-pop0' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-pop0' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'defense_power')::numeric <> 1000 then
    raise exception '8653 ASSERTION FAILED: t-pop0 expected DP 1000 (turrets only, militia 0), got %', v_res->0->>'defense_power';
  end if;
  if (v_res->0->>'ratio')::numeric <> 0.6 then
    raise exception '8653 ASSERTION FAILED: t-pop0 expected ratio 0.6, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'crushed' then
    raise exception '8653 ASSERTION FAILED: t-pop0 expected crushed, got %', v_res->0->>'outcome';
  end if;
end $$;

do $$
declare v_owner uuid; v_pop double precision; v_turret int;
begin
  select owner_id, population, coalesce((structure_levels->>'defenseTurret')::int, -1)
    into v_owner, v_pop, v_turret
    from public.owned_planets where planet_name = 't-pop0';
  if v_owner is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: t-pop0 owner must be unchanged';
  end if;
  if v_pop <> 0 or v_turret <> 2 then
    raise exception '8653 ASSERTION FAILED: t-pop0 defender must be unchanged (pop=%, turret=%)', v_pop, v_turret;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 23. war-weariness WINDOW edge (resolver-side; the estimator cannot model
--     the time window — warWearinessMultiplier is a pure 1.2^n). The helper
--     counts launched_at >= now() − window. All prior buckets backdate by 2
--     days, so the in-window set is fully controlled here. now() is
--     transaction-fixed, so the exact-24h boundary is exact, not approximate.
--       * Test A: a prior launch 24h+1s ago → EXPIRED → weariness 1.0.
--       * Test B: a prior launch EXACTLY 24h ago → INCLUSIVE → counted → 1.2.
--       * Test C: 3 prior in-window launches → 1.2^3 = 1.728 (§5a "4th
--         conquest needs 1.8x").
-- ---------------------------------------------------------------------
set local role postgres;
-- Prelude: t-wear/t-wear1/t-wear2 are the only A-launches still at now()
-- (all other buckets backdate 2 days). Expire them out of the window so the
-- in-window set is empty before Test A.
update public.attacks set launched_at = now() - interval '2 days'
 where launcher_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and launched_at >= now() - interval '24 hours';

-- Test A — window expiry at exactly 24h+1s → weariness 1.0 (0 prior).
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-we1', 100, 'a1-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-we1 throwaway launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = now() - interval '24 hours' - interval '1 second'
 where target_planet_name = 't-we1' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-wexp', 750, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-wexp pin launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-wexp' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'war_weariness_multiplier')::numeric <> 1.0 then
    raise exception '8653 ASSERTION FAILED: t-wexp expected weariness 1.0 (prior expired 24h+1s ago), got %', v_res->0->>'war_weariness_multiplier';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.5 then
    raise exception '8653 ASSERTION FAILED: t-wexp expected ratio 1.5, got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-wexp expected decisive, got %', v_res->0->>'outcome';
  end if;
end $$;

-- Pull the resolved pin out of the window so Test B's count is controlled.
set local role postgres;
update public.attacks set launched_at = now() - interval '2 days'
 where target_planet_name = 't-wexp';

-- Test B — inclusive boundary at EXACTLY 24h ago → counted → weariness 1.2.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-we2', 100, 'a1-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-we2 throwaway launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = now() - interval '24 hours'
 where target_planet_name = 't-we2' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-winc', 750, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-winc pin launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-winc' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'war_weariness_multiplier')::numeric <> 1.2 then
    raise exception '8653 ASSERTION FAILED: t-winc expected weariness 1.2 (prior exactly 24h ago is IN the window), got %', v_res->0->>'war_weariness_multiplier';
  end if;
  if (v_res->0->>'ratio')::numeric <> 1.25 then
    raise exception '8653 ASSERTION FAILED: t-winc expected ratio 1.25 (2250/1800), got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-winc expected pyrrhic, got %', v_res->0->>'outcome';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = now() - interval '2 days'
 where target_planet_name = 't-winc';

-- Test C — 3 prior in-window launches → 1.2^3 = 1.728 (fresh 4th conquest).
set local role postgres;
update public.attacks set launched_at = now() - interval '2 days'
 where target_planet_name = 't-we2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-wt1', 100, 'a1-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-wt1 throwaway launch must be inbound';
  end if;
  if (select public.launch_attack('t-wt2', 100, 'a1-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-wt2 throwaway launch must be inbound';
  end if;
  if (select public.launch_attack('t-wt3', 100, 'a1-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-wt3 throwaway launch must be inbound';
  end if;
  if (select public.launch_attack('t-w3', 750, 'a3-math'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-w3 pin launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-w3' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'war_weariness_multiplier')::numeric <> 1.728 then
    raise exception '8653 ASSERTION FAILED: t-w3 expected weariness 1.728 (1.2^3), got %', v_res->0->>'war_weariness_multiplier';
  end if;
  if (v_res->0->>'ratio')::numeric <> 0.8681 then
    raise exception '8653 ASSERTION FAILED: t-w3 expected ratio 0.8681 (2250/2592), got %', v_res->0->>'ratio';
  end if;
  if (v_res->0->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-w3 expected repelled, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->'members'->0->>'losses')::numeric <> 450 then
    raise exception '8653 ASSERTION FAILED: t-w3 losses expected 450 (round(750×0.6)), got %', v_res->0->'members'->0->>'losses';
  end if;
end $$;

set local role postgres;

rollback;
