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

-- Defender roster via get_attack: F (the CURRENT owner of t-clamp, i.e. the
-- defender while the attack is inbound) reads the full member roster + the
-- window state. window_closes_at must equal resolves_at (travel 600s is
-- SHORTER than the 7200s join window, so the clamp binds the close to the
-- arrival) and join_window_open must be true (still inbound + before close).
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
begin
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

  -- ...but NO deduction: source fleets are untouched (B2/P3-T05 carry) and
  -- the defender keeps the planet with turrets fully surviving (B4).
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
  if v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: loser A fleet must NOT be deducted (B2/P3-T05), got %', v_fleet;
  end if;
  select fleet into v_fleet from public.owned_planets where planet_name = 'c3';
  if v_fleet <> 0 then
    raise exception '8653 ASSERTION FAILED: loser C fleet must NOT be deducted (B2/P3-T05), got %', v_fleet;
  end if;
end $$;

set local role postgres;

rollback;
