-- =====================================================================
-- 08_home_world_protection (P2-T03-C)
-- Purpose   : Contract tests for 0014_home_world_protection against the
--             applied 0001-0014 migration set. Proves the DESIGN §5
--             "unconquerable home planet" is enforced at the DB level by
--             the owned_planets_home_world_guard trigger:
--               * an owner transfer (owner_id UPDATE) on a row with
--                 unconquerable = true RAISES — the conquest RPCs could
--                 never land on a home anyway (launch rejects upstream),
--                 this is the backstop that makes the transfer impossible;
--               * a NON-ownership UPDATE on the same row (population) is
--                 ALLOWED — the guard only blocks owner_id changes/deletes;
--               * a DELETE on an unconquerable row RAISES (home worlds
--                 persist forever, DESIGN §6);
--               * a conquerable row (unconquerable = false) still changes
--                 owner freely — the conquest mechanic is untouched;
--               * the trigger does not fire on a no-op owner self-transfer;
--               * anon sees ZERO owned_planets rows (permission-denied
--                 assertion, matching the 01_claim_rls convention);
--               * re-running the migration's idempotent constructs
--                 (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS +
--                 CREATE TRIGGER) does not error, and the guard still works
--                 afterwards (documented re-run contract).
-- Run      : executed via the project's linked database test workflow (see ROADMAP).
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK (claims, direct
-- mutations, and the trigger re-creation all roll back).
-- =====================================================================

begin;

-- Two actors: A owns the protected home + the conquerable colony; B is the
-- would-be conqueror / transfer recipient.
insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now());

-- A: home (is_home = true, unconquerable = true per 0003) + a colony
-- (is_home = false, unconquerable = false). B: their own home.
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('alpha-08', 2::smallint);
  perform public.claim_colony('colony-08', 1::smallint);
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('beta-08', 2::smallint);
end $$;

-- ---------------------------------------------------------------------
-- 1. Owner transfer of an unconquerable home row must RAISE, and the row
--    must be left untouched (the raise aborts the statement).
-- ---------------------------------------------------------------------
set local role postgres;
do $$
declare v_owner uuid; v_pop double precision;
begin
  begin
    update public.owned_planets
       set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     where planet_name = 'alpha-08';
    raise exception '8653 ASSERTION FAILED: owner transfer of an unconquerable home must raise';
  exception
    when others then
      if sqlerrm !~ 'unconquerable home world' then raise; end if;
  end;
  select owner_id into v_owner from public.owned_planets where planet_name = 'alpha-08';
  if v_owner is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: failed transfer must not change the home owner';
  end if;
end $$;

-- A no-op owner self-transfer (owner_id = owner_id) must NOT raise — the
-- guard uses IS DISTINCT FROM, so non-ownership statements stay legal.
do $$ begin
  update public.owned_planets
     set owner_id = owner_id
   where planet_name = 'alpha-08';
end $$;

-- ---------------------------------------------------------------------
-- 2. Non-ownership updates on the unconquerable row are ALLOWED: population
--    accrual (and by extension garrison/fleet/structure_levels) is not the
--    trigger's scope.
-- ---------------------------------------------------------------------
do $$
declare v_pop double precision;
begin
  update public.owned_planets set population = 4321 where planet_name = 'alpha-08';
  select population into v_pop from public.owned_planets where planet_name = 'alpha-08';
  if v_pop <> 4321 then
    raise exception '8653 ASSERTION FAILED: population update on a home must be allowed';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. DELETE of an unconquerable row must RAISE (home worlds persist forever).
-- ---------------------------------------------------------------------
do $$ begin
  begin
    delete from public.owned_planets where planet_name = 'alpha-08';
    raise exception '8653 ASSERTION FAILED: deleting an unconquerable home must raise';
  exception
    when others then
      if sqlerrm !~ 'unconquerable home world' then raise; end if;
  end;
end $$;
do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.owned_planets where planet_name = 'alpha-08';
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: home row must survive the rejected delete';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. A conquerable row (unconquerable = false) STILL changes owner freely —
--    the conquest mechanic is untouched by the guard.
-- ---------------------------------------------------------------------
do $$
declare v_owner uuid;
begin
  update public.owned_planets
     set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
   where planet_name = 'colony-08';
  select owner_id into v_owner from public.owned_planets where planet_name = 'colony-08';
  if v_owner is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: conquerable colony transfer must succeed';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. anon sees ZERO owned_planets rows (no anon grant, audit §3.1) — the
--    schema keeps denying anon even with the new trigger on the table.
-- ---------------------------------------------------------------------
set local role anon;
do $$ begin
  begin
    perform count(*) from public.owned_planets;
    raise exception '8653 ASSERTION FAILED: anon must be denied SELECT on owned_planets';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;
set local role postgres;

-- ---------------------------------------------------------------------
-- 6. Re-run contract: the migration's idempotent constructs (CREATE OR
--    REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER) re-run
--    cleanly and the recreated guard still enforces the same rules.
--    Identical to the 0014 statements, quoted for the re-run probe.
-- ---------------------------------------------------------------------
create or replace function public.owned_planets_home_world_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and old.unconquerable then
    raise exception 'cannot delete unconquerable home world: %', old.planet_name;
  end if;
  if tg_op = 'UPDATE'
     and old.unconquerable
     and new.owner_id is distinct from old.owner_id then
    raise exception 'cannot transfer unconquerable home world: %', old.planet_name;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists owned_planets_home_world_guard on public.owned_planets;
create trigger owned_planets_home_world_guard
  before update or delete on public.owned_planets
  for each row
  execute function public.owned_planets_home_world_guard();

-- The recreated trigger still blocks a home-world transfer and still allows
-- a conquerable transfer.
do $$ begin
  begin
    update public.owned_planets
       set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     where planet_name = 'alpha-08';
    raise exception '8653 ASSERTION FAILED: recreated guard must still block a home transfer';
  exception
    when others then
      if sqlerrm !~ 'unconquerable home world' then raise; end if;
  end;
end $$;
do $$
declare v_owner uuid;
begin
  update public.owned_planets
     set owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   where planet_name = 'colony-08';
  select owner_id into v_owner from public.owned_planets where planet_name = 'colony-08';
  if v_owner is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: recreated guard must still allow conquerable transfers';
  end if;
end $$;

set local role postgres;

rollback;
