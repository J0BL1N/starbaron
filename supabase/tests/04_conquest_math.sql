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

-- A: home + four shipyard-tier sources (3 / 15 / 0 / 1).
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('alpha-math', 2::smallint);
  perform public.claim_colony('a3-math',  1::smallint);
  perform public.claim_colony('a15-math', 1::smallint);
  perform public.claim_colony('a0-math',  1::smallint);
  perform public.claim_colony('a1-math',  1::smallint);
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
--     0.7) = 525). Run LAST so the backdated prior buckets do not pollute
--     the count. Throwaways stay inbound (future resolves_at).
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

set local role postgres;

rollback;
