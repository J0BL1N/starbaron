-- =====================================================================
-- 05_band_together
-- Purpose   : P3-T04-B band-together contract tests against the applied
--             0001-0011 migration set. Pins the Jay-authorised decisions
--             from docs/P3_T04_A_AUDIT.md (B1-B5/B7):
--               * G1/B1 — the join window is CLAMPED to
--                 least(launched_at + join_window_seconds, resolves_at):
--                 a join AFTER resolves_at is rejected even while the
--                 attack is still 'inbound' (the lazy resolver hasn't run
--                 — the window-vs-travel race is closed), and the window
--                 term alone fires when the window is shorter than travel.
--               * Fixed-DP — the defender's defense_power is IDENTICAL for
--                 a 1v1 (A 750×3) and a 1v5 (A-E 200/175/150/125/100, all
--                 tier 3 → total 2250 AP) against the same turret recipe:
--                 1500 in both, ratio 1.5 in both. More attackers never
--                 buffs the defender (§5b).
--               * G3/B2 — per-player war-weariness: A with 2 prior in-
--                 window conquests has HIS contribution divided by 1.44
--                 (144×3 → 300) while B with 0 prior is undiminished
--                 (700×3 → 2100); combined_ap = 2400, ratio 1.6 decisive.
--                 (The old launcher-only model would give (432+2100)/1.44
--                 = 1758.3 → pyrrhic — the pins discriminate.)
--               * B4 — min join commitment: 99 soldiers → 'minimum join
--                 commitment'; 100 succeeds.
--               * B3 — 'attack_joined' notification inserted for the
--                 launcher on a join (kind added to the 0002 CHECK by
--                 0011).
--               * B2 — get_attack surfaces join_window_open +
--                 window_closes_at (= resolves_at for a short-travel
--                 attack: travel 600 < window 7200).
--               * double-join rejection, defender roster via get_attack,
--                 and loser casualties REPORT-ONLY (repelled band: losses
--                 in the report, no fleet/garrison deduction — P3-T05
--                 carry).
-- Actors    : A/B/C/D/E = five DISTINCT attackers, F = the defender owning
--             every target (PK (attack_id, player_id) forbids any repeat,
--             so the 1v5 case alone needs six distinct players).
-- Run      : npx --no-install supabase db query --linked -f supabase/tests/05_band_together.sql
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK.
-- Recipes  : (integer recipes — every pinned AP/DP/loss value is integral
--             or rounds to an exact 4-dp value)
--   case | target         | turrets | members (tier 3)              | raw AP | deflated | DP  | ratio  | outcome
--   1    | t-fixed-1v1    | 3       | A 750                          | 2250   | 2250     | 1500| 1.5    | decisive
--   2    | t-fixed-1v5    | 3       | A 200 + B 175 + C 150 + D 125
--                               + E 100                             | 2250   | 2250     | 1500| 1.5    | decisive (winner A)
--   3    | t-clamp        | 1       | A 200 + B 100 (no resolve)     | 900    | —        | 500 | —      | — (join/roster/clamp)
--   4    | t-far          | 1       | A 200 (no resolve)             | —      | —        | —   | —      | — (window<travel clamp)
--   5    | t-ppw          | 3       | A 144 (2 prior) + B 700         | 2532   | 2400     | 1500| 1.6    | decisive (winner B)
--   6    | t-min          | 1       | A 200 (no resolve)             | —      | —        | —   | —      | — (min-join guard)
--   7    | t-rep          | 3       | A 300 + C 100                   | 1200   | 1200     | 1500| 0.8    | repelled (losses report-only)
--   8    | t-ppw3         | 3       | A 720 (3 prior) + B 1000 (1 prior)
--                               + C 500 (fresh)                     | 5250*  | 5250     | 1500| 3.5    | decisive (winner B — highest
--                                  COMMITTER, not launcher A)       — per-member ap 1250/2500/1500;
--                                  Σ = combined 5250; economy survives,
--                                  turrets destroyed, losers NOT deducted
--   9    | t-wedge(+r)    | —       | join-window clamp BOUNDARIES    | —      | —        | —   | —      | 1s-before-close ACCEPTED; exactly-
--                                  AT-close REJECTED; resolves_at-term
--                                  exact REJECTED; join_window_seconds=0
--                                  rejected by the schema CHECK (> 0)
--   10   | t-exp          | 3       | D 500 (1 prior EXPIRED 24h+1s)  | 1500   | 1500     | 1500| 1.0    | pyrrhic (weariness window cleared
--                                  → 1.0; ap undiminished 1500, NOT 1250)
--   11   | t-inf          | 3       | D 500 + D in-flight 100         | —      | 1250     | 1500| 0.8333 | repelled (IN-FLIGHT prior DOES
--                                  count — pins live behaviour, see report)
--   * raw sum = 2160 + 3000 + 1500 = 6660; DEFLATED sum = 5250 (combined_ap
--     is the deflated total the ratio actually uses).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Six actors (auth.users + claims feed auth.uid(); players rows are created
-- by the first claim).
-- ---------------------------------------------------------------------
insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@test.local', now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd@test.local', now(), now()),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'e@test.local', now(), now()),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'f@test.local', now(), now());

-- A: home + a tier-3 shipyard source and a tier-1 throwaway source.
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('alpha', 2::smallint);
  perform public.claim_colony('a3', 1::smallint);
  perform public.claim_colony('a1', 1::smallint);
end $$;

-- B/C/D/E: home + a tier-3 shipyard source each (joiners).
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('beta', 2::smallint);
  perform public.claim_colony('b3', 1::smallint);
end $$;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('gamma', 2::smallint);
  perform public.claim_colony('c3', 1::smallint);
end $$;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('delta', 2::smallint);
  perform public.claim_colony('d3', 1::smallint);
end $$;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('epsilon', 2::smallint);
  perform public.claim_colony('e3', 1::smallint);
end $$;

-- F: home + every target colony (t-far is a far target for the
-- window<travel clamp; the rest default to distance null → travel floor 600s).
set local request.jwt.claims = '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('phi', 2::smallint);
  perform public.claim_colony('t-fixed-1v1', 1::smallint);
  perform public.claim_colony('t-fixed-1v5', 1::smallint);
  perform public.claim_colony('t-clamp',     1::smallint);
  perform public.claim_colony('t-far',       1::smallint, 4000);
  perform public.claim_colony('t-ppw',       1::smallint);
  perform public.claim_colony('t-min',       1::smallint);
  perform public.claim_colony('t-rep',       1::smallint);
  perform public.claim_colony('t-w1',        1::smallint);
  perform public.claim_colony('t-w2',        1::smallint);
  -- P3-T04-C targets (cases 8-11): t-ppw3 is the deep weariness pin,
  -- t-pw-* are resolved prior-attack throwaways, t-exp/t-inf are the
  -- expiry + in-flight pins, t-wedge/t-wedge-r/t-win0 are window-clamp
  -- boundary probes (never resolved).
  perform public.claim_colony('t-ppw3',      1::smallint);
  perform public.claim_colony('t-pw-a1',     1::smallint);
  perform public.claim_colony('t-pw-a2',     1::smallint);
  perform public.claim_colony('t-pw-a3',     1::smallint);
  perform public.claim_colony('t-pw-b1',     1::smallint);
  perform public.claim_colony('t-exp',       1::smallint);
  perform public.claim_colony('t-pw-d1',     1::smallint);
  perform public.claim_colony('t-inf',       1::smallint);
  perform public.claim_colony('t-inf-th',    1::smallint);
  perform public.claim_colony('t-wedge',     1::smallint);
  perform public.claim_colony('t-wedge-r',   1::smallint);
  perform public.claim_colony('t-win0',      1::smallint);
end $$;

-- Seed context (as postgres): backdate ALL six shields (a shielded target is
-- rejected by launch_attack), fund the attackers, snapshot the REAL shipyard
-- tiers and every target's turrets.
set local role postgres;
update public.players set created_at = now() - interval '10 days'
 where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              'ffffffff-ffff-4fff-8fff-ffffffffffff');
update public.players set credits = 1000000
 where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

update public.owned_planets set structure_levels = structure_levels || '{"shipyard":3}' where planet_name in ('a3','b3','c3','d3','e3');
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":1}' where planet_name = 'a1';
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name in ('t-fixed-1v1','t-fixed-1v5','t-ppw','t-rep');
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":1}' where planet_name in ('t-clamp','t-far','t-min');
-- P3-T05-B garrison/barracks seeding: the new launch/join guards require
-- garrison >= committed (deducted at launch, fleet += soldiers) and
-- fleetCap = 1000 × effectiveLevel(shipyard). The multi-launch sources carry
-- 'barracks':2 (cap 10,000 — exactly the seeded garrison of 10000, so the
-- resolver's survivor-return clamp (garrison = least(garrison + survivors,
-- cap)) never bites) on a3 and b3; a1/c3/d3 carry 'barracks':1 (cap 5000,
-- matching their seeded garrisons) and e3 carries no barracks. A barracks-less
-- source would fail every later launch. Cumulative
-- commits: a3 3614, a1 1000, b3 2075, c3 750, d3 1200, e3 100. The pinned
-- AP/DP/weariness/outcome/loss numbers are unaffected (only deployment state).
update public.owned_planets set garrison = 10000, structure_levels = structure_levels || '{"barracks":2}' where planet_name = 'a3';
update public.owned_planets set garrison = 2000,  structure_levels = structure_levels || '{"barracks":1}' where planet_name = 'a1';
update public.owned_planets set garrison = 10000, structure_levels = structure_levels || '{"barracks":2}' where planet_name = 'b3';
update public.owned_planets set garrison = 5000,  structure_levels = structure_levels || '{"barracks":1}' where planet_name = 'c3';
update public.owned_planets set garrison = 5000,  structure_levels = structure_levels || '{"barracks":1}' where planet_name = 'd3';
update public.owned_planets set garrison = 1000 where planet_name = 'e3';

-- P3-T05-B: baseline-capture table for the post-resolve garrison/fleet DELTA
-- assertions. A source's absolute fleet legitimately retains OTHER in-flight
-- attacks' deployments (t-clamp/t-far/t-min stay inbound across the suite,
-- and t-clamp itself becomes due and resolves during case 5), so absolute
-- values are history-dependent; the deltas pin the deployment semantics
-- exactly: fleet −= THIS attack's committed, garrison += THIS member's
-- survivors (committed − round(committed × loss_pct)).
create temporary table t_source_base (planet text primary key, gar double precision, fleet double precision);
-- P3-T04-C recipes: t-ppw3/t-exp/t-inf face DP 1500 (t3); the t-pw-*
-- throwaways face DP 500 (t1) so the low-AP prior attacks never take them.
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":3}' where planet_name in ('t-ppw3','t-exp','t-inf');
update public.owned_planets set structure_levels = structure_levels || '{"defenseTurret":1}' where planet_name in ('t-pw-a1','t-pw-a2','t-pw-a3','t-pw-b1','t-pw-d1');
-- t-ppw3 carries an economy to prove "everything survives EXCEPT defenses"
-- on conquest (mirrors the 04 t-dec pin: oreMine 5 + shipyard 2 survive).
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":2,"oreMine":5}' where planet_name = 't-ppw3';

-- ---------------------------------------------------------------------
-- 1. Fixed-DP baseline — 1v1: A 750 × tier 3 = 2250 AP vs F t3 turrets
--    (DP 1500) → ratio exactly 1.5 → decisive.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-fixed-1v1', 750, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: 1v1 launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-fixed-1v1' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-fixed-1v1' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r
   where r->>'target_planet_name' = 't-fixed-1v1';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: 1v1 report missing';
  end if;
  if (v_res->>'defense_power')::numeric <> 1500 then
    raise exception '8653 ASSERTION FAILED: 1v1 expected DP 1500, got %', v_res->>'defense_power';
  end if;
  if (v_res->>'combined_ap')::numeric <> 2250 then
    raise exception '8653 ASSERTION FAILED: 1v1 expected AP 2250, got %', v_res->>'combined_ap';
  end if;
  if (v_res->>'ratio')::numeric <> 1.5 then
    raise exception '8653 ASSERTION FAILED: 1v1 expected ratio 1.5, got %', v_res->>'ratio';
  end if;
  if (v_res->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: 1v1 expected decisive, got %', v_res->>'outcome';
  end if;
  if (v_res->>'war_weariness_multiplier')::numeric <> 1.0 then
    raise exception '8653 ASSERTION FAILED: 1v1 expected weariness 1.0 (0 prior), got %', v_res->>'war_weariness_multiplier';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Fixed-DP pin — 1v5: FIVE distinct attackers (A-E) on an IDENTICAL
--    turret recipe. Commits 200/175/150/125/100 (all tier 3 → 600/525/450/
--    375/300 = 2250 total) — same combined AP, SAME defense_power 1500,
--    SAME ratio 1.5 as the 1v1. Winner = the highest single committer (A,
--    200 > 175). DP provably attacker-count-independent (§5b).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-fixed-1v5', 200, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: 1v5 launch must be inbound';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-fixed-1v5' and status = 'inbound';
  if (select public.join_attack(v_id, 175, 'b3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: 1v5 B join must keep the attack inbound';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-fixed-1v5' and status = 'inbound';
  if (select public.join_attack(v_id, 150, 'c3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: 1v5 C join must keep the attack inbound';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-fixed-1v5' and status = 'inbound';
  if (select public.join_attack(v_id, 125, 'd3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: 1v5 D join must keep the attack inbound';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-fixed-1v5' and status = 'inbound';
  if (select public.join_attack(v_id, 100, 'e3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: 1v5 E join must keep the attack inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 't-fixed-1v5' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-fixed-1v5' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res jsonb;
  v_n   int;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r
   where r->>'target_planet_name' = 't-fixed-1v5';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: 1v5 report missing';
  end if;
  -- SAME DP and SAME ratio as the 1v1 — the fixed-DP principle.
  if (v_res->>'defense_power')::numeric <> 1500 then
    raise exception '8653 ASSERTION FAILED: 1v5 expected DP 1500 (identical to 1v1), got %', v_res->>'defense_power';
  end if;
  if (v_res->>'combined_ap')::numeric <> 2250 then
    raise exception '8653 ASSERTION FAILED: 1v5 expected combined AP 2250, got %', v_res->>'combined_ap';
  end if;
  if (v_res->>'ratio')::numeric <> 1.5 then
    raise exception '8653 ASSERTION FAILED: 1v5 expected ratio 1.5 (identical to 1v1), got %', v_res->>'ratio';
  end if;
  if (v_res->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: 1v5 expected decisive, got %', v_res->>'outcome';
  end if;
  -- winner = the highest single committer (A, 200 > 175 > 150 > 125 > 100).
  if (v_res->>'winner_id') is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: 1v5 winner must be the highest committer (A)';
  end if;
  select jsonb_array_length(v_res->'members') into v_n;
  if v_n <> 5 then
    raise exception '8653 ASSERTION FAILED: 1v5 expected 5 members, got %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Window state + join notification + double-join + defender roster +
--    the G1 clamp (join AFTER resolves_at rejected).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-clamp', 200, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-clamp launch must be inbound';
  end if;
end $$;

-- B joins IN-WINDOW (short travel: resolves_at is ~10 min out) → the join
-- succeeds and the launcher receives an 'attack_joined' notification.
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-clamp' and status = 'inbound';
  if (select public.join_attack(v_id, 100, 'b3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-clamp B join must keep the attack inbound';
  end if;
end $$;

-- B3: the 'attack_joined' notification row exists for the launcher (A),
-- carrying the attack id and the joiner (B).
set local role postgres;
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.notifications
   where player_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and kind = 'attack_joined'
     and payload->>'attack_id' = (select id::text from public.attacks where target_planet_name = 't-clamp')
     and payload->>'actor_id' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     and payload->>'soldiers' = '100';
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: launcher must receive 1 attack_joined notification, got %', v_n;
  end if;
end $$;

-- double-join rejected ('already a member').
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-clamp' and status = 'inbound';
  begin
    perform public.join_attack(v_id, 150, 'b3');
    raise exception '8653 ASSERTION FAILED: double join must raise';
  exception
    when others then
      if sqlerrm !~ 'already a member' then raise; end if;
  end;
end $$;

-- B3 regression: the REJECTED double-join must not have duplicated the
-- earlier notification — the launcher (A) still holds exactly ONE
-- attack_joined row for B's join on t-clamp.
set local role postgres;
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.notifications
   where player_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and kind = 'attack_joined'
     and payload->>'attack_id' = (select id::text from public.attacks where target_planet_name = 't-clamp')
     and payload->>'actor_id' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: double-join must not duplicate the attack_joined notification, got %', v_n;
  end if;
end $$;

-- B3 schema pin: the notifications kind CHECK (re-created by 0011) admits
-- 'attack_joined' alongside the five §5b kinds.
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'notifications_kind_check';
  if v_def is null or v_def !~ 'attack_joined' then
    raise exception '8653 ASSERTION FAILED: notifications_kind_check must admit attack_joined, got %', v_def;
  end if;
end $$;

-- Defender roster via get_attack: F (the CURRENT owner of t-clamp, i.e. the
-- defender while the attack is inbound) reads the full member roster + the
-- window state. window_closes_at must equal resolves_at (travel 600s is
-- SHORTER than the 7200s join window, so the clamp binds the close to the
-- arrival) and join_window_open must be true (still inbound + before close).
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}';
do $$
declare
  v_id        uuid;
  v_get       jsonb;
  v_launched  timestamptz;
  v_resolves  timestamptz;
  v_window    int;
  v_n         int;
begin
  select id, launched_at, resolves_at, join_window_seconds
    into v_id, v_launched, v_resolves, v_window
    from public.attacks
   where target_planet_name = 't-clamp' and status = 'inbound';
  v_get := public.get_attack(v_id);
  if (v_get->>'found') <> 'true' then
    raise exception '8653 ASSERTION FAILED: defender must see the inbound attack via get_attack';
  end if;
  if (v_get->>'join_window_open') <> 'true' then
    raise exception '8653 ASSERTION FAILED: inbound in-window attack must report join_window_open true';
  end if;
  if (v_get->>'window_closes_at')::timestamptz is distinct from
     least(v_launched + (v_window * interval '1 second'), v_resolves) then
    raise exception '8653 ASSERTION FAILED: window_closes_at must be the clamped close';
  end if;
  -- travel 600 < window 7200 → the clamp binds window_closes_at to resolves_at.
  if (v_get->>'window_closes_at')::timestamptz is distinct from v_resolves then
    raise exception '8653 ASSERTION FAILED: short-travel clamp must close the window at resolves_at';
  end if;
  if jsonb_typeof(v_get->'members') <> 'array' then
    raise exception '8653 ASSERTION FAILED: get_attack members must be an array';
  end if;
  select jsonb_array_length(v_get->'members') into v_n;
  if v_n <> 2 then
    raise exception '8653 ASSERTION FAILED: defender roster must show 2 members, got %', v_n;
  end if;
  if (select count(*) from jsonb_array_elements(v_get->'members') m
        where m->>'player_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1
     or (select count(*) from jsonb_array_elements(v_get->'members') m
          where m->>'player_id' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then
    raise exception '8653 ASSERTION FAILED: defender roster must contain launcher A and joiner B';
  end if;
  -- Robust form (02_attack_rls precedent): jsonb_build_object emits a PRESENT
  -- "report": null key for inbound (v_report is SQL NULL → JSON null literal),
  -- so `->'report' is not null` is true for a null JSON value and falsely
  -- fires. An inbound attack must expose NO report; fail only if an actual
  -- report OBJECT is present. Belt-and-braces: the 'attack' payload may carry
  -- "attack_report": null (F is the original defender via the current-owner
  -- fallback, so the embedded payload is NOT stripped), but never an object.
  if v_get->'report' is not null and jsonb_typeof(v_get->'report') = 'object' then
    raise exception '8653 ASSERTION FAILED: inbound get_attack must not expose a report';
  end if;
  if v_get->'attack'->'attack_report' is not null
     and jsonb_typeof(v_get->'attack'->'attack_report') = 'object' then
    raise exception '8653 ASSERTION FAILED: inbound attack payload must not embed a report object';
  end if;
end $$;

-- G1 clamp: makes the attack DUE without resolving it (backdate resolves_at
-- into the past; status stays 'inbound'). A late joiner must now be REJECTED
-- ('join window closed') — the join-window-vs-travel race is closed. Before
-- 0011 this join was accepted and could change the outcome depending on when
-- the lazy resolver happened to run.
set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-clamp' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-clamp' and status = 'inbound';
  begin
    perform public.join_attack(v_id, 100, 'c3');
    raise exception '8653 ASSERTION FAILED: join after resolves_at must be rejected (G1 clamp)';
  exception
    when others then
      if sqlerrm !~ 'join window closed' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 4. Window term clamp (window SHORTER than travel): t-far travels 48h
--    (distance 4000 pc) but its join_window_seconds is shrunk to 60s and
--    launched_at backdated 120s → the window term (launched + 60) is the
--    binding close, long before the far-future resolves_at. Join rejected.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-far', 200, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-far launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks
   set join_window_seconds = 60,
       launched_at = now() - interval '120 seconds'
 where target_planet_name = 't-far' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-far' and status = 'inbound';
  begin
    perform public.join_attack(v_id, 100, 'b3');
    raise exception '8653 ASSERTION FAILED: join past the window term must be rejected';
  exception
    when others then
      if sqlerrm !~ 'join window closed' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 5. Per-player war-weariness (G3/B2): A has TWO prior in-window conquests
--    (weariness 1.44); B has NONE (1.0). A's contribution is divided by HIS
--    own 1.44: 144 × 3 = 432 → 300. B's is undiminished: 700 × 3 = 2100.
--    combined_ap = 2400 vs DP 1500 → ratio 1.6 → decisive, winner B.
--    (The old launcher-only model: (432 + 2100)/1.44 = 1758.3 → ratio 1.17
--    → pyrrhic — the combined_ap + outcome pins discriminate.)
-- ---------------------------------------------------------------------
set local role postgres;
-- Weariness reset: backdate every in-window attack (t-clamp, t-far and the
-- resolved 1v1/1v5) out of the 24h window so A's count is exactly the two
-- fresh throwaways below.
update public.attacks set launched_at = now() - interval '2 days'
 where launched_at >= now() - interval '24 hours';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-w1', 100, 'a1'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-w1 throwaway launch must be inbound';
  end if;
  if (select public.launch_attack('t-w2', 100, 'a1'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-w2 throwaway launch must be inbound';
  end if;
  if (select public.launch_attack('t-ppw', 144, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-ppw pin launch must be inbound';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-ppw' and status = 'inbound';
  if (select public.join_attack(v_id, 700, 'b3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-ppw B join must keep the attack inbound';
  end if;
end $$;

-- Only the pin is due; the throwaways stay inbound with future resolves_at.
set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-ppw' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res jsonb;
  v_a_ap numeric; v_b_ap numeric; v_a_wear numeric; v_b_wear numeric;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r
   where r->>'target_planet_name' = 't-ppw';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-ppw report missing';
  end if;
  -- A's own stack deflates only A: 432/1.44 = 300; B undiminished: 2100.
  if (v_res->>'combined_ap')::numeric <> 2400 then
    raise exception '8653 ASSERTION FAILED: per-player combined_ap expected 2400 (300 + 2100), got %', v_res->>'combined_ap';
  end if;
  select (m->>'ap')::numeric, (m->>'weariness')::numeric
    into v_a_ap, v_a_wear
    from jsonb_array_elements(v_res->'members') m
   where m->>'player_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select (m->>'ap')::numeric, (m->>'weariness')::numeric
    into v_b_ap, v_b_wear
    from jsonb_array_elements(v_res->'members') m
   where m->>'player_id' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_a_ap is distinct from 300 then
    raise exception '8653 ASSERTION FAILED: A ap expected 300 (432/1.44 — A''s own stack), got %', v_a_ap;
  end if;
  if v_a_wear is distinct from 1.44 then
    raise exception '8653 ASSERTION FAILED: A weariness expected 1.44 (2 prior), got %', v_a_wear;
  end if;
  if v_b_ap is distinct from 2100 then
    raise exception '8653 ASSERTION FAILED: B ap expected 2100 (0 prior — UNDIMINISHED), got %', v_b_ap;
  end if;
  if v_b_wear is distinct from 1.0 then
    raise exception '8653 ASSERTION FAILED: B weariness expected 1.0 (0 prior), got %', v_b_wear;
  end if;
  -- combined_ap sums the per-member deflated contributions.
  if (v_a_ap + v_b_ap) is distinct from 2400 then
    raise exception '8653 ASSERTION FAILED: member ap must sum to combined_ap 2400, got % + %', v_a_ap, v_b_ap;
  end if;
  if (v_res->>'ratio')::numeric <> 1.6 then
    raise exception '8653 ASSERTION FAILED: t-ppw expected ratio 1.6 (2400/1500), got %', v_res->>'ratio';
  end if;
  if (v_res->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-ppw expected decisive (per-player model), got %', v_res->>'outcome';
  end if;
  -- winner = highest single committer: B (700 > 144).
  if (v_res->>'winner_id') is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: t-ppw winner must be the highest committer (B)';
  end if;
  -- the launcher's own stack is still surfaced as the informational
  -- report-level weariness field (backward-compatible).
  if (v_res->>'war_weariness_multiplier')::numeric <> 1.44 then
    raise exception '8653 ASSERTION FAILED: t-ppw report weariness expected 1.44 (launcher A), got %', v_res->>'war_weariness_multiplier';
  end if;
end $$;

-- Postlude: expire the throwaways + the resolved pin out of the 24h window
-- so the repelled case below resolves at weariness 1.0.
set local role postgres;
update public.attacks set launched_at = now() - interval '2 days'
 where launcher_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
   and launched_at >= now() - interval '24 hours';

-- ---------------------------------------------------------------------
-- 6. Minimum join commitment (B4): 99 soldiers → 'minimum join commitment';
--    100 succeeds. (Guard fires before any state mutates.)
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-min', 200, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-min launch must be inbound';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-min' and status = 'inbound';
  begin
    perform public.join_attack(v_id, 99, 'b3');
    raise exception '8653 ASSERTION FAILED: 99-soldier join must be rejected';
  exception
    when others then
      if sqlerrm !~ 'minimum join commitment' then raise; end if;
  end;
  if (select public.join_attack(v_id, 100, 'b3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: 100-soldier join must be accepted';
  end if;
  if not exists (select 1 from public.attack_members where attack_id = v_id and player_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception '8653 ASSERTION FAILED: accepted join must create the membership row';
  end if;
end $$;

-- B4 edge: exactly-100.0 FLOAT passes the < 100 guard; NaN / ±Infinity are
-- rejected by the finite guard BEFORE any state mutates (no membership row).
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-min' and status = 'inbound';
  if (select public.join_attack(v_id, 100.0::float8, 'c3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: float 100.0 join must be accepted';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-min' and status = 'inbound';
  begin
    perform public.join_attack(v_id, 'NaN'::float8, 'd3');
    raise exception '8653 ASSERTION FAILED: NaN join must be rejected';
  exception
    when others then
      if sqlerrm !~ 'finite, positive' then raise; end if;
  end;
end $$;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-min' and status = 'inbound';
  begin
    perform public.join_attack(v_id, 'Infinity'::float8, 'e3');
    raise exception '8653 ASSERTION FAILED: Infinity join must be rejected';
  exception
    when others then
      if sqlerrm !~ 'finite, positive' then raise; end if;
  end;
end $$;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-min' and status = 'inbound';
  begin
    perform public.join_attack(v_id, '-Infinity'::float8, 'a3');
    raise exception '8653 ASSERTION FAILED: -Infinity join must be rejected';
  exception
    when others then
      if sqlerrm !~ 'finite, positive' then raise; end if;
  end;
end $$;
set local role postgres;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.attack_members
   where attack_id = (select id from public.attacks where target_planet_name = 't-min');
  if v_n <> 3 then
    raise exception '8653 ASSERTION FAILED: rejected NaN/±Infinity joins must not create memberships, got %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Loser casualties REPORT-ONLY (B6 carry, P3-T05): repelled band — A 300
--    × 3 + C 100 × 3 = 1200 AP vs F t3 turrets (DP 1500) → ratio 0.8 →
--    repelled. Every member's casualties appear in the report (A round(300
--    × 0.6) = 180, C round(100 × 0.6) = 60) but NO fleet/garrison deduction
--    happens server-side (loser deduction is deferred to P3-T05): the source
--    planets' fleet stays 0. Planet NOT taken; turrets fully survive (B4).
-- ---------------------------------------------------------------------
set local role postgres;
-- Weariness reset for the repelled resolve (t-min is still in-window).
update public.attacks set launched_at = now() - interval '2 days'
 where launched_at >= now() - interval '24 hours';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-rep', 300, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-rep launch must be inbound';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-rep' and status = 'inbound';
  if (select public.join_attack(v_id, 100, 'c3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-rep C join must keep the attack inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-rep' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res jsonb;
  v_a_los numeric; v_c_los numeric;
  v_owner uuid; v_fleet double precision; v_turret int;
  v_a3g double precision; v_a3f double precision;
  v_c3g double precision; v_c3f double precision;
begin
  -- P3-T05-B baseline: capture the sources' pre-resolve deployment state.
  select garrison, fleet into v_a3g, v_a3f from public.owned_planets where planet_name = 'a3';
  select garrison, fleet into v_c3g, v_c3f from public.owned_planets where planet_name = 'c3';

  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r
   where r->>'target_planet_name' = 't-rep';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-rep report missing';
  end if;
  if (v_res->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-rep expected repelled, got %', v_res->>'outcome';
  end if;
  if (v_res->>'ratio')::numeric <> 0.8 then
    raise exception '8653 ASSERTION FAILED: t-rep expected ratio 0.8 (1200/1500), got %', v_res->>'ratio';
  end if;
  if (v_res->>'planet_taken') <> 'false' then
    raise exception '8653 ASSERTION FAILED: t-rep must NOT take the planet';
  end if;
  -- casualties ARE reported (report flavour only).
  select (m->>'losses')::numeric into v_a_los
    from jsonb_array_elements(v_res->'members') m
   where m->>'player_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select (m->>'losses')::numeric into v_c_los
    from jsonb_array_elements(v_res->'members') m
   where m->>'player_id' = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if v_a_los is distinct from 180 then
    raise exception '8653 ASSERTION FAILED: t-rep A losses expected 180 (round(300×0.6)), got %', v_a_los;
  end if;
  if v_c_los is distinct from 60 then
    raise exception '8653 ASSERTION FAILED: t-rep C losses expected 60 (round(100×0.6)), got %', v_c_los;
  end if;

  -- P3-T05-B: the deployed pool DRAINS at resolve (fleet -= THIS attack's
  -- committed) and UNIFORM survivors return to the source garrison (a3 +120 =
  -- 300 − round(300×0.6); c3 +40 = 100 − round(100×0.6)), clamped to the
  -- barracks cap. The defender keeps the planet with turrets fully surviving (B4).
  select owner_id, fleet, coalesce((structure_levels->>'defenseTurret')::int, -1)
    into v_owner, v_fleet, v_turret
    from public.owned_planets where planet_name = 't-rep';
  if v_owner is distinct from 'ffffffff-ffff-4fff-8fff-ffffffffffff' then
    raise exception '8653 ASSERTION FAILED: t-rep owner must stay the defender (F)';
  end if;
  if v_turret <> 3 then
    raise exception '8653 ASSERTION FAILED: t-rep turrets must fully survive (B4), got %', v_turret;
  end if;
  select fleet into v_fleet from public.owned_planets where planet_name = 'a3';
  if v_fleet <> v_a3f - 300 then
    raise exception '8653 ASSERTION FAILED: loser A fleet must drain by 300 (committed) at resolve, got % (before %)', v_fleet, v_a3f;
  end if;
  select fleet into v_fleet from public.owned_planets where planet_name = 'c3';
  if v_fleet <> v_c3f - 100 then
    raise exception '8653 ASSERTION FAILED: loser C fleet must drain by 100 (committed) at resolve, got % (before %)', v_fleet, v_c3f;
  end if;
  select garrison into v_fleet from public.owned_planets where planet_name = 'a3';
  if v_fleet <> v_a3g + 120 then
    raise exception '8653 ASSERTION FAILED: loser A garrison must return 120 survivors, got % (before %)', v_fleet, v_a3g;
  end if;
  select garrison into v_fleet from public.owned_planets where planet_name = 'c3';
  if v_fleet <> v_c3g + 40 then
    raise exception '8653 ASSERTION FAILED: loser C garrison must return 40 survivors, got % (before %)', v_fleet, v_c3g;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Deep per-player weariness (A 3 prior → 1.728, B 1 prior → 1.2, C
--    fresh → 1.0) + winner allocation edge (B wins — the middle joiner and
--    highest COMMITTER, NOT the launcher A) + planet transfer/turret
--    destruction + economy survival + loser no-deduction + member-fan-out
--    join notifications (existing members get told, the joiner does not).
-- ---------------------------------------------------------------------
set local role postgres;
-- Weariness reset: backdate everything still in-window (t-rep resolved in
-- case 7, etc.) out so A's stack is exactly the 3 fresh throwaways below
-- and B's exactly the 1. A 720×3 = 2160 /1.728 = 1250; B 1000×3 = 3000 /1.2
-- = 2500; C 500×3 = 1500 → combined 5250 vs DP 1500 → ratio 3.5 decisive.
update public.attacks set launched_at = now() - interval '2 days'
 where launched_at >= now() - interval '24 hours';

-- A's 3 prior + B's 1 prior: RESOLVED in-window attacks on t1-turret
-- colonies (crushed/repelled → F keeps the targets). Resolving them (rather
-- than leaving them in-flight) pins that RESOLVED prior attacks count
-- toward a member's own stack.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-pw-a1', 100, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-pw-a1 throwaway launch must be inbound';
  end if;
  if (select public.launch_attack('t-pw-a2', 100, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-pw-a2 throwaway launch must be inbound';
  end if;
  if (select public.launch_attack('t-pw-a3', 100, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-pw-a3 throwaway launch must be inbound';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-pw-b1', 100, 'b3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-pw-b1 throwaway launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name in ('t-pw-a1','t-pw-a2','t-pw-a3','t-pw-b1')
   and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  -- resolve_due_attacks RESPONSE-GATES reports by caller (0005), so count
  -- only the side-effect (status flip) in the attacks table, not the array.
  perform public.resolve_due_attacks();
end $$;

-- All 4 prior attacks must have RESOLVED (t-pw-b1's report is B's — A never
-- sees it — but the resolution side-effect is status-scoped, not gated).
set local role postgres;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.attacks
   where target_planet_name in ('t-pw-a1','t-pw-a2','t-pw-a3','t-pw-b1')
     and status = 'resolved';
  if v_n <> 4 then
    raise exception '8653 ASSERTION FAILED: all 4 throwaway attacks must resolve, got %', v_n;
  end if;
end $$;

-- The throwaway colonies must survive their prior attacks (defensive pin).
set local role postgres;
do $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.owned_planets where planet_name = 't-pw-a1';
  if v_owner is distinct from 'ffffffff-ffff-4fff-8fff-ffffffffffff' then
    raise exception '8653 ASSERTION FAILED: crushed throwaway t-pw-a1 must stay with F';
  end if;
  select owner_id into v_owner from public.owned_planets where planet_name = 't-pw-b1';
  if v_owner is distinct from 'ffffffff-ffff-4fff-8fff-ffffffffffff' then
    raise exception '8653 ASSERTION FAILED: repelled throwaway t-pw-b1 must stay with F';
  end if;
end $$;

-- The pin: A (launcher, 720) + B (middle joiner, 1000) + C (last joiner, 500).
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-ppw3', 720, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-ppw3 launch must be inbound';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-ppw3' and status = 'inbound';
  if (select public.join_attack(v_id, 1000, 'b3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-ppw3 B join (1000) must be accepted';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-ppw3' and status = 'inbound';
  if (select public.join_attack(v_id, 500, 'c3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-ppw3 C join must be accepted';
  end if;
end $$;

-- B3 fan-out: launcher A is notified on B's join AND C's join (2 rows);
-- existing member B is notified on C's join (1 row); the joiner C is NEVER
-- self-notified (0 rows).
set local role postgres;
do $$
declare
  v_aid uuid;
  v_a_n int; v_b_n int; v_c_n int;
  v_ab int; v_ac int; v_bc int;
begin
  select id into v_aid from public.attacks where target_planet_name = 't-ppw3';
  select count(*) into v_a_n
    from public.notifications
   where player_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and kind = 'attack_joined' and payload->>'attack_id' = v_aid::text;
  select count(*) into v_b_n
    from public.notifications
   where player_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     and kind = 'attack_joined' and payload->>'attack_id' = v_aid::text;
  select count(*) into v_c_n
    from public.notifications
   where player_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     and kind = 'attack_joined' and payload->>'attack_id' = v_aid::text;
  select count(*) into v_ab
    from public.notifications
   where player_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and kind = 'attack_joined' and payload->>'attack_id' = v_aid::text
     and payload->>'actor_id' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  select count(*) into v_ac
    from public.notifications
   where player_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and kind = 'attack_joined' and payload->>'attack_id' = v_aid::text
     and payload->>'actor_id' = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  select count(*) into v_bc
    from public.notifications
   where player_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     and kind = 'attack_joined' and payload->>'attack_id' = v_aid::text
     and payload->>'actor_id' = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if v_a_n <> 2 then
    raise exception '8653 ASSERTION FAILED: launcher A must get 2 attack_joined (B + C), got %', v_a_n;
  end if;
  if v_b_n <> 1 then
    raise exception '8653 ASSERTION FAILED: existing member B must get 1 attack_joined (C), got %', v_b_n;
  end if;
  if v_c_n <> 0 then
    raise exception '8653 ASSERTION FAILED: joiner C must NOT self-notify, got %', v_c_n;
  end if;
  if v_ab <> 1 or v_ac <> 1 then
    raise exception '8653 ASSERTION FAILED: A must have one notification per actor (B, C), got %/%', v_ab, v_ac;
  end if;
  if v_bc <> 1 then
    raise exception '8653 ASSERTION FAILED: B must have one notification from actor C, got %', v_bc;
  end if;
end $$;

-- Resolve the pin and pin the per-member weariness tiers + the winner.
set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-ppw3' and status = 'inbound';

-- P3-T05-B baseline: capture the sources' pre-resolve deployment state so the
-- post-resolve assertions pin DELTAS (fleet −= committed, garrison +=
-- survivors) independent of the suite's in-flight history.
delete from t_source_base;
insert into t_source_base (planet, gar, fleet)
select planet_name, garrison, fleet from public.owned_planets
 where planet_name in ('a3','b3','c3');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_res jsonb;
  v_a_ap numeric; v_b_ap numeric; v_c_ap numeric;
  v_a_w numeric; v_b_w numeric; v_c_w numeric;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r
   where r->>'target_planet_name' = 't-ppw3';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-ppw3 report missing';
  end if;
  if (v_res->>'combined_ap')::numeric <> 5250 then
    raise exception '8653 ASSERTION FAILED: t-ppw3 combined_ap expected 5250 (1250+2500+1500), got %', v_res->>'combined_ap';
  end if;
  if (v_res->>'defense_power')::numeric <> 1500 then
    raise exception '8653 ASSERTION FAILED: t-ppw3 DP expected 1500, got %', v_res->>'defense_power';
  end if;
  if (v_res->>'ratio')::numeric <> 3.5 then
    raise exception '8653 ASSERTION FAILED: t-ppw3 ratio expected 3.5 (5250/1500), got %', v_res->>'ratio';
  end if;
  if (v_res->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: t-ppw3 expected decisive, got %', v_res->>'outcome';
  end if;
  -- winner = B (middle joiner, highest COMMITTER 1000 — NOT the launcher A,
  -- NOT the earliest joiner A; commit decides, tie-break irrelevant).
  if (v_res->>'winner_id') is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: t-ppw3 winner must be the highest committer B (not launcher A)';
  end if;
  -- report-level launcher weariness stays backward-compatible (A's own stack).
  if (v_res->>'war_weariness_multiplier')::numeric <> 1.728 then
    raise exception '8653 ASSERTION FAILED: t-ppw3 report weariness expected 1.728 (launcher A), got %', v_res->>'war_weariness_multiplier';
  end if;
  -- per-member weariness tiers — A 1.728 / B 1.2 / C 1.0 (no cross-player leak).
  select (m->>'ap')::numeric, (m->>'weariness')::numeric into v_a_ap, v_a_w
    from jsonb_array_elements(v_res->'members') m
   where m->>'player_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select (m->>'ap')::numeric, (m->>'weariness')::numeric into v_b_ap, v_b_w
    from jsonb_array_elements(v_res->'members') m
   where m->>'player_id' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  select (m->>'ap')::numeric, (m->>'weariness')::numeric into v_c_ap, v_c_w
    from jsonb_array_elements(v_res->'members') m
   where m->>'player_id' = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if v_a_ap is distinct from 1250 or v_a_w is distinct from 1.728 then
    raise exception '8653 ASSERTION FAILED: A expected ap 1250 / weariness 1.728, got %/%', v_a_ap, v_a_w;
  end if;
  if v_b_ap is distinct from 2500 or v_b_w is distinct from 1.2 then
    raise exception '8653 ASSERTION FAILED: B expected ap 2500 / weariness 1.2, got %/%', v_b_ap, v_b_w;
  end if;
  if v_c_ap is distinct from 1500 or v_c_w is distinct from 1.0 then
    raise exception '8653 ASSERTION FAILED: C expected ap 1500 / weariness 1.0, got %/%', v_c_ap, v_c_w;
  end if;
  if (v_a_ap + v_b_ap + v_c_ap) is distinct from 5250 then
    raise exception '8653 ASSERTION FAILED: member ap must sum to combined_ap 5250, got %+%+%', v_a_ap, v_b_ap, v_c_ap;
  end if;
end $$;

-- Conquest transfer + turret destruction + economy survival + loser no-rdn.
set local role postgres;
do $$
declare
  v_owner uuid; v_turret int; v_ship int; v_ore int;
  v_pop double precision; v_gar double precision; v_fleet double precision;
  v_a_fleet double precision; v_c_fleet double precision;
begin
  select owner_id, coalesce((structure_levels->>'defenseTurret')::int, -1),
         coalesce((structure_levels->>'shipyard')::int, -1),
         coalesce((structure_levels->>'oreMine')::int, -1),
         population, garrison, fleet
    into v_owner, v_turret, v_ship, v_ore, v_pop, v_gar, v_fleet
    from public.owned_planets where planet_name = 't-ppw3';
  if v_owner is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: t-ppw3 must transfer to the winner B';
  end if;
  if v_turret <> -1 then
    raise exception '8653 ASSERTION FAILED: t-ppw3 defenseTurret must be destroyed (key gone), got %', v_turret;
  end if;
  if v_ship <> 2 or v_ore <> 5 then
    raise exception '8653 ASSERTION FAILED: t-ppw3 economy must survive (shipyard 2, oreMine 5), got %/%', v_ship, v_ore;
  end if;
  if v_pop <> 0 or v_gar <> 0 or v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: t-ppw3 fresh settlement (0/0/0), got %/%/%', v_pop, v_gar, v_fleet;
  end if;
  -- P3-T05-B: loser committed soldiers DRAIN at resolve (fleet −= committed)
  -- and UNIFORM survivors return to the source garrisons (winner AND losers
  -- alike — B4), clamped to the barracks cap. Deltas vs the pre-resolve
  -- baseline: A 720 committed → a3 fleet −720, gar +432 (720−round(720×0.4));
  -- C 500 committed → c3 fleet −500, gar +300; the WINNER B 1000 committed →
  -- b3 fleet −1000, gar +600 (round(1000×0.4)=400 lost).
  select fleet into v_a_fleet from public.owned_planets where planet_name = 'a3';
  select fleet into v_c_fleet from public.owned_planets where planet_name = 'c3';
  if v_a_fleet <> (select fleet from t_source_base where planet = 'a3') - 720 then
    raise exception '8653 ASSERTION FAILED: loser A fleet must drain by 720 (committed) at resolve, got %', v_a_fleet;
  end if;
  if v_c_fleet <> (select fleet from t_source_base where planet = 'c3') - 500 then
    raise exception '8653 ASSERTION FAILED: loser C fleet must drain by 500 (committed) at resolve, got %', v_c_fleet;
  end if;
  select garrison into v_gar from public.owned_planets where planet_name = 'a3';
  if v_gar <> (select gar from t_source_base where planet = 'a3') + 432 then
    raise exception '8653 ASSERTION FAILED: loser A garrison must return 432 survivors, got %', v_gar;
  end if;
  select garrison into v_gar from public.owned_planets where planet_name = 'c3';
  if v_gar <> (select gar from t_source_base where planet = 'c3') + 300 then
    raise exception '8653 ASSERTION FAILED: loser C garrison must return 300 survivors, got %', v_gar;
  end if;
  select garrison into v_gar from public.owned_planets where planet_name = 'b3';
  if v_gar <> (select gar from t_source_base where planet = 'b3') + 600 then
    raise exception '8653 ASSERTION FAILED: winner B garrison must return 600 survivors, got %', v_gar;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. Join-window clamp boundaries (G1/B1, 0011 `now() >= close`):
--    (a) join 1s BEFORE the clamped close is accepted;
--    (b) join EXACTLY AT the clamped close (window term binds) is rejected;
--    (c) join EXACTLY AT resolves_at (the resolves term binds) is rejected;
--    (d) join_window_seconds = 0 is a schema guard (0004 CHECK > 0) — the
--        clamp-with-zero is unreachable by valid state.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-wedge', 200, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-wedge launch must be inbound';
  end if;
end $$;

-- (a) launched_at backdated 7199s (window 7200) → clamped close = now() + 1s
-- → now() < close → accepted.
set local role postgres;
update public.attacks set launched_at = now() - interval '7199 seconds'
 where target_planet_name = 't-wedge' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-wedge' and status = 'inbound';
  if (select public.join_attack(v_id, 100, 'b3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: join 1s before the clamped close must be accepted';
  end if;
end $$;

-- (b) launched_at backdated the FULL 7200s → clamped close = now() EXACTLY →
-- now() >= close → rejected at the boundary (the 0005 `>` check would have
-- accepted this exact instant).
set local role postgres;
update public.attacks set launched_at = now() - interval '7200 seconds'
 where target_planet_name = 't-wedge' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-wedge' and status = 'inbound';
  begin
    perform public.join_attack(v_id, 100, 'c3');
    raise exception '8653 ASSERTION FAILED: join exactly at the clamped close must be rejected';
  exception
    when others then
      if sqlerrm !~ 'join window closed' then raise; end if;
  end;
end $$;

-- (c) resolves_at-term exact boundary: fresh attack, resolves_at := now() →
-- clamp = least(launched + 7200, now()) = now() → rejected.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-wedge-r', 200, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-wedge-r launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set resolves_at = now()
 where target_planet_name = 't-wedge-r' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  select id into v_id from public.attacks where target_planet_name = 't-wedge-r' and status = 'inbound';
  begin
    perform public.join_attack(v_id, 100, 'd3');
    raise exception '8653 ASSERTION FAILED: join at resolves_at (exact) must be rejected';
  exception
    when others then
      if sqlerrm !~ 'join window closed' then raise; end if;
  end;
end $$;

-- Restore t-wedge-r's resolves_at to the future so it is NOT due for the
-- later lazy resolves (the exact-boundary probe is done).
set local role postgres;
update public.attacks set resolves_at = now() + interval '1 hour'
 where target_planet_name = 't-wedge-r' and status = 'inbound';

-- (d) zero window is unreachable: the 0004 CHECK join_window_seconds > 0
-- rejects 0. (If 0 were allowed the clamp would be least(launched+0,
-- resolves) = launched_at — the window term binding trivially — not
-- resolves_at; the schema guard is the honest edge pin.)
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-win0', 200, 'a3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-win0 launch must be inbound';
  end if;
end $$;

set local role postgres;
do $$
begin
  begin
    update public.attacks set join_window_seconds = 0
     where target_planet_name = 't-win0' and status = 'inbound';
    raise exception '8653 ASSERTION FAILED: join_window_seconds = 0 must violate the CHECK';
  exception
    when others then
      if sqlerrm !~ 'join_window_seconds' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 10. Weariness window expiry (24h): D's single prior RESOLVED attack is
--     backdated to 24h + 1s → it leaves the 24h window → D's next resolve
--     faces 1.0x (ap 1500 undiminished, NOT 1500/1.2 = 1250; ratio 1.0
--     pyrrhic, NOT 0.8333 repelled).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-pw-d1', 100, 'd3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-pw-d1 throwaway launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-pw-d1' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$ begin
  if (select count(*) from jsonb_array_elements(public.resolve_due_attacks())) <> 1 then
    raise exception '8653 ASSERTION FAILED: t-pw-d1 must resolve (and only it)';
  end if;
end $$;

-- expire it: 24h + 1s beyond the weariness window.
set local role postgres;
update public.attacks set launched_at = now() - interval '24 hours' - interval '1 second'
 where target_planet_name = 't-pw-d1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-exp', 500, 'd3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-exp launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-exp' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$
declare
  v_res jsonb;
  v_ap numeric; v_w numeric;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r
   where r->>'target_planet_name' = 't-exp';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-exp report missing';
  end if;
  select (m->>'ap')::numeric, (m->>'weariness')::numeric into v_ap, v_w
    from jsonb_array_elements(v_res->'members') m
   where m->>'player_id' = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  if v_w is distinct from 1.0 then
    raise exception '8653 ASSERTION FAILED: expired prior must leave weariness 1.0, got %', v_w;
  end if;
  if v_ap is distinct from 1500 then
    raise exception '8653 ASSERTION FAILED: expired prior must leave ap 1500 (undiminished), got %', v_ap;
  end if;
  if (v_res->>'ratio')::numeric <> 1.0 then
    raise exception '8653 ASSERTION FAILED: t-exp expected ratio 1.0 (1500/1500), got %', v_res->>'ratio';
  end if;
  if (v_res->>'outcome') <> 'pyrrhic' then
    raise exception '8653 ASSERTION FAILED: t-exp expected pyrrhic (weariness cleared), got %', v_res->>'outcome';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. In-flight weariness regression pin: an INBOUND in-window attack DOES
--     count toward the player's own stack. Live war_weariness_multiplier_for
--     (0008) has NO status filter — the existing case-5 t-w1/t-w2 in-flight
--     throwaways already rely on this. NOTE: this pins ACTUAL behaviour,
--     which differs from a "RESOLVED-only" reading of DESIGN §5b — flagged
--     in the P3-T04-C report, no code changed.
-- ---------------------------------------------------------------------
set local role postgres;
-- reset: D's t-exp (resolved in case 10) is still in-window → backdate it out.
update public.attacks set launched_at = now() - interval '2 days'
 where launched_at >= now() - interval '24 hours';

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('t-inf', 500, 'd3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-inf launch must be inbound';
  end if;
  -- second launch stays IN-FLIGHT (never resolved) but is in-window.
  if (select public.launch_attack('t-inf-th', 100, 'd3'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: t-inf-th launch must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 't-inf' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$
declare
  v_res jsonb;
  v_ap numeric; v_w numeric;
begin
  v_res := public.resolve_due_attacks();
  select r into v_res from jsonb_array_elements(v_res) r
   where r->>'target_planet_name' = 't-inf';
  if v_res is null then
    raise exception '8653 ASSERTION FAILED: t-inf report missing';
  end if;
  -- the in-flight t-inf-th counts → weariness 1.2 → ap 1500/1.2 = 1250.
  select (m->>'ap')::numeric, (m->>'weariness')::numeric into v_ap, v_w
    from jsonb_array_elements(v_res->'members') m
   where m->>'player_id' = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  if v_w is distinct from 1.2 then
    raise exception '8653 ASSERTION FAILED: in-flight prior must count (weariness 1.2), got %', v_w;
  end if;
  if v_ap is distinct from 1250 then
    raise exception '8653 ASSERTION FAILED: in-flight prior must deflate ap to 1250, got %', v_ap;
  end if;
  if (v_res->>'ratio')::numeric <> 0.8333 then
    raise exception '8653 ASSERTION FAILED: t-inf expected ratio 0.8333 (1250/1500), got %', v_res->>'ratio';
  end if;
  if (v_res->>'outcome') <> 'repelled' then
    raise exception '8653 ASSERTION FAILED: t-inf expected repelled, got %', v_res->>'outcome';
  end if;
end $$;

set local role postgres;

rollback;
