-- =====================================================================
-- 09_ownership_audit (P2-T04-C)
-- Purpose   : Contract tests for 0015_ownership_audit against the applied
--             0001-0015 migration set. Proves the owned_planets audit
--             trigger (owned_planets_audit_logger) records every change of
--             hands:
--               * an owned_planets INSERT auto-creates one audit row with
--                 method 'home-assignment' and from_owner_id NULL — the
--                 trigger keys on the row transition (a first ownership IS
--                 the home-claim path in the claim RPCs; the pure model's
--                 'colonisation' tagging is an application-layer concern, a
--                 documented simplification of the trigger mapping);
--               * a conquerable owner_id UPDATE adds a second audit row
--                 (from OLD.owner_id, to NEW.owner_id, method 'conquest');
--               * a protected home transfer REJECTED by 0014's BEFORE guard
--                 writes NO audit row — BEFORE fires before AFTER, so the
--                 audit never records a transfer the protection guard blocked;
--               * a no-op owner self-transfer (owner_id = owner_id) writes
--                 NOTHING (IS DISTINCT FROM guard, mirroring 0014);
--               * a NON-ownership UPDATE (population) writes NOTHING (the
--                 trigger is declared UPDATE OF owner_id, a column-list
--                 trigger that only fires when owner_id is in the SET list);
--               * anon sees ZERO ownership_audit rows (permission-denied
--                 assertion, matching the 01/08 conventions);
--               * re-running the migration's idempotent constructs (CREATE
--                 OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE
--                 TRIGGER) does not error and the audit still records after
--                 (documented re-run contract).
-- Run      : executed via the project's linked database test workflow (see ROADMAP).
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK (auth.users rows,
-- claims, direct mutations, and the trigger re-creation all roll back).
-- NOTE     : now() is transaction-stable, so every audit row inside this
--            transaction shares one at_ms. Append order is therefore asserted
--            via the identity-sequence id, not at_ms.
-- =====================================================================

begin;

-- Two actors: A owns a protected home + a conquerable colony; B is the
-- would-be conqueror / transfer recipient.
insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now());

-- A: home (is_home = true, unconquerable = true per 0003) + a colony
-- (is_home = false, unconquerable = false). B: their own home.
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('alpha-09', 2::smallint);
  perform public.claim_colony('colony-09', 1::smallint);
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('beta-09', 2::smallint);
end $$;

-- ---------------------------------------------------------------------
-- 1. INSERT audit: every owned_planets insert wrote exactly one audit row
--    (method 'home-assignment', from NULL, to the new owner). at_ms is a
--    positive epoch-ms value within the current minute.
-- ---------------------------------------------------------------------
set local role postgres;
do $$
declare v_total bigint; v_at bigint; v_method text; v_from uuid; v_to uuid;
begin
  select count(*) into v_total from public.ownership_audit;
  if v_total <> 3 then
    raise exception '8653 ASSERTION FAILED: expected 3 audit rows after 3 claims, got %', v_total;
  end if;

  select method, at_ms into v_method, v_at
    from public.ownership_audit where body_id = 'alpha-09';
  if v_method <> 'home-assignment' then
    raise exception '8653 ASSERTION FAILED: home claim audit method %, expected home-assignment', v_method;
  end if;
  if v_at <= 0 or v_at > floor(extract(epoch from now()) * 1000) then
    raise exception '8653 ASSERTION FAILED: at_ms %, out of the transaction window', v_at;
  end if;

  select from_owner_id, to_owner_id into v_from, v_to
    from public.ownership_audit where body_id = 'alpha-09';
  if v_from is not null or v_to is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: home audit from/to wrong: %, %', v_from, v_to;
  end if;

  select from_owner_id, to_owner_id into v_from, v_to
    from public.ownership_audit where body_id = 'beta-09';
  if v_from is not null or v_to is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: B home audit from/to wrong: %, %', v_from, v_to;
  end if;

  select method, from_owner_id, to_owner_id into v_method, v_from, v_to
    from public.ownership_audit where body_id = 'colony-09';
  if v_method <> 'home-assignment' or v_from is not null
     or v_to is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: colony insert audit wrong: %, %, %', v_method, v_from, v_to;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. A conquerable owner transfer: colony-09 passes to B. One new audit row
--    with from = A, to = B, method 'conquest', appended after the insert row.
-- ---------------------------------------------------------------------
do $$
declare v_n bigint; v_from uuid; v_to uuid; v_method text; v_last_method text;
begin
  update public.owned_planets
     set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
   where planet_name = 'colony-09';

  select count(*) into v_n from public.ownership_audit where body_id = 'colony-09';
  if v_n <> 2 then
    raise exception '8653 ASSERTION FAILED: expected 2 audit rows for the transferred colony, got %', v_n;
  end if;

  select from_owner_id, to_owner_id, method into v_from, v_to, v_method
    from public.ownership_audit where body_id = 'colony-09' and method = 'conquest';
  if v_from is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     or v_to is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     or v_method <> 'conquest' then
    raise exception '8653 ASSERTION FAILED: conquest audit from/to/method wrong: %, %, %', v_from, v_to, v_method;
  end if;

  select method into v_last_method from public.ownership_audit
   where body_id = 'colony-09' order by id desc limit 1;
  if v_last_method <> 'conquest' then
    raise exception '8653 ASSERTION FAILED: latest colony audit row must be the conquest, got %', v_last_method;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Protected home transfer blocked by 0014 -> NO audit row. 0014's BEFORE
--    trigger raises before this AFTER trigger can run, so the transfer the
--    protection guard rejected must leave the audit for alpha-09 untouched.
-- ---------------------------------------------------------------------
do $$
declare v_n bigint;
begin
  begin
    update public.owned_planets
       set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     where planet_name = 'alpha-09';
    raise exception '8653 ASSERTION FAILED: protected home transfer must raise';
  exception
    when others then
      if sqlerrm !~ 'unconquerable home world' then raise; end if;
  end;
  select count(*) into v_n from public.ownership_audit where body_id = 'alpha-09';
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: blocked transfer must not write an audit row, got %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. No-op owner self-transfer (owner_id = owner_id) writes NOTHING — the
--    IS DISTINCT FROM guard mirrors 0014's no-op rule.
-- ---------------------------------------------------------------------
do $$
declare v_n bigint;
begin
  update public.owned_planets
     set owner_id = owner_id
   where planet_name = 'colony-09';
  select count(*) into v_n from public.ownership_audit where body_id = 'colony-09';
  if v_n <> 2 then
    raise exception '8653 ASSERTION FAILED: no-op self-transfer must not write an audit row, got %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. A NON-ownership UPDATE (population) writes NOTHING — the trigger is
--    declared UPDATE OF owner_id, so accrual/build writes never reach it.
-- ---------------------------------------------------------------------
do $$
declare v_n bigint;
begin
  update public.owned_planets set population = 4321 where planet_name = 'colony-09';
  select count(*) into v_n from public.ownership_audit where body_id = 'colony-09';
  if v_n <> 2 then
    raise exception '8653 ASSERTION FAILED: population update must not write an audit row, got %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. anon sees ZERO ownership_audit rows (no anon grant, locked-down mirror
--    of the 0013 tables) — permission-denied is the enforcement.
-- ---------------------------------------------------------------------
set local role anon;
do $$ begin
  begin
    perform count(*) from public.ownership_audit;
    raise exception '8653 ASSERTION FAILED: anon must be denied SELECT on ownership_audit';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;
set local role postgres;

-- ---------------------------------------------------------------------
-- 7. Re-run contract: the migration's idempotent constructs (CREATE OR
--    REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER) re-run
--    cleanly and the recreated audit trigger still records transfers.
--    Identical to the 0015 statements, quoted for the re-run probe.
-- ---------------------------------------------------------------------
create or replace function public.owned_planets_audit_logger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ownership_audit (
      body_id, from_owner_id, to_owner_id, method, at_ms
    ) values (
      new.planet_name, null, new.owner_id, 'home-assignment',
      floor(extract(epoch from now()) * 1000)::bigint
    );
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into public.ownership_audit (
      body_id, from_owner_id, to_owner_id, method, at_ms
    ) values (
      new.planet_name, old.owner_id, new.owner_id, 'conquest',
      floor(extract(epoch from now()) * 1000)::bigint
    );
  end if;
  return new;
end;
$$;
drop trigger if exists owned_planets_ownership_audit on public.owned_planets;
create trigger owned_planets_ownership_audit
  after insert or update of owner_id on public.owned_planets
  for each row
  execute function public.owned_planets_audit_logger();

-- The recreated trigger still records a conquerable transfer: colony-09
-- passes back to A, appending a third audit row (from B, to A).
do $$
declare v_n bigint; v_from uuid; v_to uuid;
begin
  update public.owned_planets
     set owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   where planet_name = 'colony-09';
  select count(*) into v_n from public.ownership_audit where body_id = 'colony-09';
  if v_n <> 3 then
    raise exception '8653 ASSERTION FAILED: recreated audit must record the transfer, got %', v_n;
  end if;
  select from_owner_id, to_owner_id into v_from, v_to
    from public.ownership_audit where body_id = 'colony-09' order by id desc limit 1;
  if v_from is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     or v_to is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception '8653 ASSERTION FAILED: recreated audit from/to wrong: %, %', v_from, v_to;
  end if;
end $$;

set local role postgres;

rollback;
