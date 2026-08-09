-- =====================================================================
-- 02_attack_rls
-- Purpose   : P3-T01-C attack-lifecycle contract tests against the
--             applied 0001-0005 migration set. Proves:
--               * launch requires a valid target, soldiers > 0 and an
--                 affordable launch cost (plus the unconquerable / own-
--                 planet / source-ownership guards).
--               * travel_seconds = distancePc x 1 min, floor 600, cap
--                 172800 (game_config, 0006): 1 pc -> 600, 100 pc ->
--                 6000, 4000 pc -> 172800.
--               * resolution is gated on resolves_at: not-due stays
--                 inbound; due resolves via the lazy path; the INTERNAL
--                 resolve_attack() is NOT client-callable (no EXECUTE
--                 grant -> 42501).
--               * attacks are visible to participants only once resolved;
--                 inbound attacks are open to all authenticated
--                 (band-together coordination IS the mechanic, audit
--                 §3.2). anon has no grant on attacks at all.
-- Run      : npx --no-install supabase db query --linked -f supabase/tests/02_attack_rls.sql
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK.
-- =====================================================================

begin;

-- Fake auth.users for the four actors (players.id FK -> auth.users.id).
insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@test.local', now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd@test.local', now(), now());

-- Claims (RPCs are SECURITY DEFINER; claims feed auth.uid()).
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('alpha', 2::smallint);
  perform public.claim_colony('alpha-colony', 3::smallint, 5);
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('beta', 2::smallint);
  perform public.claim_colony('t-floor', 1::smallint, 1);
  perform public.claim_colony('t-mid', 1::smallint, 100);
  perform public.claim_colony('t-cap', 1::smallint, 4000);
  perform public.claim_colony('beta-colony', 1::smallint, 100);
end $$;

set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('gamma', 1::smallint);
  perform public.claim_colony('gamma-colony', 2::smallint, 5);
end $$;

set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('delta', 1::smallint);
end $$;

-- Seed context: backdate defender/joiner shields (created_at + 3d > now()
-- would block every launch); fund A; snapshot real shipyard tiers.
update public.players set created_at = now() - interval '10 days'
 where id in ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
update public.players set credits = 1000000 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":3}' where planet_name = 'alpha-colony';
update public.owned_planets set structure_levels = structure_levels || '{"shipyard":2}' where planet_name = 'gamma-colony';

set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

-- a. launch requires a VALID target (unknown planet -> raise).
do $$ begin
  begin
    perform public.launch_attack('no-such-planet', 100, 'alpha-colony');
    raise exception '8653 ASSERTION FAILED: launch at unknown target must raise';
  exception
    when others then
      if sqlerrm !~ 'unknown planet' then raise; end if;
  end;
end $$;

-- b. launch requires soldiers > 0 (fleet committed must be positive).
do $$ begin
  begin
    perform public.launch_attack('t-floor', 0, 'alpha-colony');
    raise exception '8653 ASSERTION FAILED: launch with 0 soldiers must raise';
  exception
    when others then
      if sqlerrm !~ 'soldiers' then raise; end if;
  end;
end $$;

-- c. launch must be affordable (insufficient credits -> raise).
update public.players set credits = 10 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
  begin
    perform public.launch_attack('t-floor', 100, 'alpha-colony');
    raise exception '8653 ASSERTION FAILED: unaffordable launch must raise';
  exception
    when others then
      if sqlerrm !~ 'insufficient credits' then raise; end if;
  end;
end $$;
update public.players set credits = 1000000 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- d. anti-grief + source guards: unconquerable home, own planet, source
--    not owned by the caller.
do $$ begin
  begin
    perform public.launch_attack('beta', 100, 'alpha-colony');
    raise exception '8653 ASSERTION FAILED: launch at unconquerable home must raise';
  exception
    when others then
      if sqlerrm !~ 'unconquerable' then raise; end if;
  end;
end $$;
do $$ begin
  begin
    perform public.launch_attack('alpha-colony', 100, 'alpha-colony');
    raise exception '8653 ASSERTION FAILED: attacking your own planet must raise';
  exception
    when others then
      if sqlerrm !~ 'own planet' then raise; end if;
  end;
end $$;
do $$ begin
  begin
    perform public.launch_attack('t-floor', 100, 'delta');
    raise exception '8653 ASSERTION FAILED: launch from an unowned source must raise';
  exception
    when others then
      if sqlerrm !~ 'not owned' then raise; end if;
  end;
end $$;

-- e. travel time = distancePc x 1 min, floor 600 / cap 172800 (0006).
do $$ begin
  if (select public.launch_attack('t-floor', 100, 'alpha-colony'))->>'travel_seconds' <> '600' then
    raise exception '8653 ASSERTION FAILED: 1 pc must floor travel to 600s';
  end if;
  update public.attacks set launched_at = launched_at - interval '2 days'
   where target_planet_name = 't-floor'; -- keep out of the weariness window
end $$;
do $$ begin
  if (select public.launch_attack('t-mid', 100, 'alpha-colony'))->>'travel_seconds' <> '6000' then
    raise exception '8653 ASSERTION FAILED: 100 pc must travel 6000s';
  end if;
  update public.attacks set launched_at = launched_at - interval '2 days'
   where target_planet_name = 't-mid';
end $$;
do $$ begin
  if (select public.launch_attack('t-cap', 100, 'alpha-colony'))->>'travel_seconds' <> '172800' then
    raise exception '8653 ASSERTION FAILED: 4000 pc must cap travel at 172800s';
  end if;
  update public.attacks set launched_at = launched_at - interval '2 days'
   where target_planet_name = 't-cap';
end $$;

-- f. main attack on 'beta-colony'; C band-together joins it.
do $$ begin
  if (select public.launch_attack('beta-colony', 1000, 'alpha-colony'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: main launch must be inbound';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.attacks
   where target_planet_name = 'beta-colony' and status = 'inbound';
  if (select public.join_attack(v_id, 500, 'gamma-colony'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: join_attack failed';
  end if;
  begin
    perform public.join_attack(v_id, 500, 'gamma-colony');
    raise exception '8653 ASSERTION FAILED: double join must raise';
  exception
    when others then
      if sqlerrm !~ 'already a member' then raise; end if;
  end;
end $$;

-- Defender strength for a deterministic resolve: pop 1000 -> DP 150;
-- combined AP = 1000*3 + 500*2 = 4000 -> decisive, winner A.
update public.owned_planets set population = 1000 where planet_name = 'beta-colony';

-- g. resolve is gated on resolves_at. Run the client-side checks as
--    authenticated A (the granted path).
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  v_id     uuid;
  v_res    jsonb;
  v_status text;
begin
  select id into v_id from public.attacks
   where target_planet_name = 'beta-colony' and status = 'inbound';

  -- not due yet -> lazy resolve must be a no-op.
  v_res := public.resolve_due_attacks();
  if v_res <> '[]'::jsonb then
    raise exception '8653 ASSERTION FAILED: nothing due yet, resolve returned %', v_res;
  end if;
  select status into v_status from public.attacks where id = v_id;
  if v_status <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: attack resolved before resolves_at';
  end if;

  -- the INTERNAL resolve_attack is not client-callable (no EXECUTE grant ->
  -- 42501). Runs as authenticated so the grant gap is what's tested.
  begin
    perform public.resolve_attack(v_id);
    raise exception '8653 ASSERTION FAILED: authenticated must not call resolve_attack directly';
  exception
    when insufficient_privilege then null; -- expected
  end;

  -- belt-and-braces (0007): probe the ACL directly too — authenticated must
  -- hold NO EXECUTE on the internal resolver, not just fail at call time.
  if has_function_privilege('authenticated', 'public.resolve_attack(uuid)', 'EXECUTE') then
    raise exception '8653 ASSERTION FAILED: authenticated holds EXECUTE on resolve_attack (0007 gap)';
  end if;
end $$;
set local role postgres;

-- Make it due (direct mutation needs the elevated context, then lazy-resolve
-- as authenticated A: resolution always runs; the report is gated to A).
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 'beta-colony' and status = 'inbound';

set local role authenticated;
do $$
declare
  v_id     uuid;
  v_res    jsonb;
  v_status text;
  v_winner uuid;
  v_owner  uuid;
begin
  select id into v_id from public.attacks
   where target_planet_name = 'beta-colony' and status = 'inbound';
  v_res := public.resolve_due_attacks();
  if v_res = '[]'::jsonb then
    raise exception '8653 ASSERTION FAILED: due attack must resolve';
  end if;
  select status into v_status from public.attacks where id = v_id;
  if v_status <> 'resolved' then
    raise exception '8653 ASSERTION FAILED: attack must be resolved, got %', v_status;
  end if;
  select winner_id into v_winner from public.attacks where id = v_id;
  if v_winner is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: winner must be the highest-committing member';
  end if;
  select owner_id into v_owner from public.owned_planets where planet_name = 'beta-colony';
  if v_owner is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: conquered planet must transfer to the winner';
  end if;
end $$;
set local role postgres;

-- h. RLS visibility. Inbound attacks are open to ALL authenticated
--    (band-together); RESOLVED attacks are participants-only. The defender
--    (B) loses the table-level window once the planet transfers (its report
--    is delivered through resolve_due_attacks' original-owner gating, not
--    the attacks SELECT policy, audit §3.2/§5.3). Probes run as
--    authenticated so RLS actually gates the rows.
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}';
do $$
declare v_resolved bigint; v_inbound bigint; v_members bigint;
begin
  select count(*) into v_resolved from public.attacks where status = 'resolved';
  if v_resolved <> 0 then
    raise exception '8653 ASSERTION FAILED: outsider sees % resolved attacks', v_resolved;
  end if;
  select count(*) into v_inbound from public.attacks where status = 'inbound';
  if v_inbound < 1 then
    raise exception '8653 ASSERTION FAILED: outsider should see inbound attacks (band-together)';
  end if;
  select count(*) into v_members from public.attack_members;
  if v_members <> 0 then
    raise exception '8653 ASSERTION FAILED: outsider sees attack_members rows';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare v_resolved bigint; v_members bigint;
begin
  select count(*) into v_resolved from public.attacks where status = 'resolved';
  if v_resolved <> 1 then
    raise exception '8653 ASSERTION FAILED: launcher must see the resolved attack, saw %', v_resolved;
  end if;
  -- scoped to the resolved attack: A also holds membership on the 3 inbound
  -- throwaway attacks, so a bare attack_members count is NOT 1.
  select count(*) into v_members
    from public.attack_members m
    join public.attacks a on a.id = m.attack_id
   where a.status = 'resolved';
  if v_members <> 1 then
    raise exception '8653 ASSERTION FAILED: launcher must hold 1 membership on the resolved attack, saw %', v_members;
  end if;
end $$;

set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';
do $$
declare v_resolved bigint; v_members bigint;
begin
  select count(*) into v_resolved from public.attacks where status = 'resolved';
  if v_resolved <> 1 then
    raise exception '8653 ASSERTION FAILED: member must see the resolved attack, saw %', v_resolved;
  end if;
  select count(*) into v_members from public.attack_members;
  if v_members <> 1 then
    raise exception '8653 ASSERTION FAILED: member must see only their own membership row, saw %', v_members;
  end if;
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_resolved bigint; v_notified bigint;
begin
  -- post-conquest the current owner is A, so B no longer matches the
  -- attacks SELECT policy (see h header note).
  select count(*) into v_resolved from public.attacks where status = 'resolved';
  if v_resolved <> 0 then
    raise exception '8653 ASSERTION FAILED: defender must not see resolved attack post-conquest, saw %', v_resolved;
  end if;
  -- B still owns its notifications (under_attack at launch + resolve kinds).
  select count(*) into v_notified from public.notifications where kind = 'under_attack';
  if v_notified < 1 then
    raise exception '8653 ASSERTION FAILED: defender must hold under_attack notification';
  end if;
end $$;

-- i. anon has no grant on attacks at all (deny by default, audit §3.1).
set local role anon;
do $$ begin
  begin
    perform count(*) from public.attacks;
    raise exception '8653 ASSERTION FAILED: anon must be denied SELECT on attacks';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;
set local role postgres;

rollback;
