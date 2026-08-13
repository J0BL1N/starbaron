-- =====================================================================
-- 13_home_immunity (P7-T08-C)
-- Purpose   : Contract tests for 0019_home_immunity. WRITE-ONLY — the
--             0019 migration is never applied, so this suite is shipped for
--             review only and run against a throwaway scratch schema. It
--             proves the DESIGN §5 "unconquerable home planet" holds at the
--             ATTACK layer of the database, via the
--             attacks_home_immunity_guard trigger:
--               * a DIRECT attacks INSERT whose target is its owner's home
--                 world RAISES (and leaves no row) — the RPC layer already
--                 rejects these launches; this is the DB-level backstop;
--               * a direct attacks INSERT on a non-home world SUCCEEDS — the
--                 conquest mechanic is untouched;
--               * re-targeting an existing attack row onto a home world
--                 RAISES; re-targeting onto a colony is allowed;
--               * a non-target UPDATE (status) on an attack row passes — the
--                 column-restricted trigger does not fire;
--               * re-running the migration's idempotent constructs does not
--                 error and the recreated guard still enforces the same
--                 rules (re-run contract, matching 08).
-- Run      : write-only, mirrors the 08 workflow when the 0019 migration is
--            ever staged for review.
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK (world seeds,
-- auth.users rows, claims, the guard install, and attack rows all roll
-- back).
-- =====================================================================

begin;

-- Canonical world layer seeds (0016+): the claim RPCs' body_id FK validates
-- against world_bodies, so the referenced rows must exist.
insert into public.world_galaxies (id, seed, name, class) values
  ('gal:catalogue', 'catalogue', 'Catalogue', 'spiral');

insert into public.world_systems (id, galaxy_id, seed, name, star_name, star_color, star_type) values
  ('sys:catalogue|alpha', 'gal:catalogue', 'alpha', 'Alpha', 'Alpha', 'G', 'G'),
  ('sys:catalogue|beta',  'gal:catalogue', 'beta',  'Beta',  'Beta',  'G', 'G');

insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius, semi_major_axis, period) values
  ('body:catalogue|alpha|planet|0', 'sys:catalogue|alpha', 'planet', 'Alpha b', 'alpha-b', 0, 1.0, 8, 1),
  ('body:catalogue|alpha|planet|1', 'sys:catalogue|alpha', 'planet', 'Alpha c', 'alpha-c', 1, 1.0, 9, 1),
  ('body:catalogue|beta|planet|0',  'sys:catalogue|beta',  'planet', 'Beta b',  'beta-b',  0, 1.0, 10, 1),
  ('body:catalogue|beta|planet|1',  'sys:catalogue|beta',  'planet', 'Beta c',  'beta-c',  1, 1.0, 11, 1);

-- Two actors: A owns a protected home + a conquerable colony; B owns their
-- own home + colony (alternate source rows and targets).
insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now());

set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('alpha-13', 2::smallint, null, false, false, 'body:catalogue|alpha|planet|0');
  perform public.claim_colony('alpha-colony-13', 1::smallint, null, false, false, 'body:catalogue|alpha|planet|1');
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  perform public.claim_home_planet('beta-13', 2::smallint, null, false, false, 'body:catalogue|beta|planet|0');
  perform public.claim_colony('beta-colony-13', 1::smallint, null, false, false, 'body:catalogue|beta|planet|1');
end $$;

set local role postgres;

-- ---------------------------------------------------------------------
-- 0. Install the guard verbatim from 0019. The migration is never applied,
--    so the suite creates the construct locally to probe it — the 08
--    re-run pattern.
-- ---------------------------------------------------------------------
create or replace function public.attacks_home_immunity_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_unconquerable boolean;
begin
  select unconquerable
    into v_unconquerable
    from public.owned_planets
   where planet_name = new.target_planet_name;
  if found and v_unconquerable then
    raise exception 'cannot attack unconquerable home world: %', new.target_planet_name;
  end if;
  return new;
end;
$$;
drop trigger if exists attacks_home_immunity_guard on public.attacks;
create trigger attacks_home_immunity_guard
  before insert or update of target_planet_name on public.attacks
  for each row
  execute function public.attacks_home_immunity_guard();

-- ---------------------------------------------------------------------
-- 1. A DIRECT INSERT on a home world must RAISE, and the aborted insert must
--    leave no attack row behind.
-- ---------------------------------------------------------------------
do $$
declare v_n bigint;
begin
  begin
    insert into public.attacks (target_planet_name, launcher_id, travel_seconds, resolves_at)
    values ('alpha-13', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 600, now() + interval '1 hour');
    raise exception '8653 ASSERTION FAILED: insert of an attack on a home world must raise';
  exception
    when others then
      if sqlerrm !~ 'unconquerable home world' then raise; end if;
  end;
  select count(*) into v_n from public.attacks where target_planet_name = 'alpha-13';
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: rejected insert must leave no attack row';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. A DIRECT INSERT on a non-home world SUCCEEDS — the conquest mechanic is
--    untouched by the guard.
-- ---------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  insert into public.attacks (target_planet_name, launcher_id, travel_seconds, resolves_at)
  values ('alpha-colony-13', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 600, now() + interval '1 hour')
  returning id into v_id;
  if v_id is null then
    raise exception '8653 ASSERTION FAILED: insert of an attack on a colony must succeed';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Re-targeting an existing attack row onto a home world RAISES (and the
--    failed statement leaves the original target intact)...
-- ---------------------------------------------------------------------
do $$
declare v_target text;
begin
  begin
    update public.attacks set target_planet_name = 'beta-13'
     where target_planet_name = 'alpha-colony-13';
    raise exception '8653 ASSERTION FAILED: retargeting onto a home world must raise';
  exception
    when others then
      if sqlerrm !~ 'unconquerable home world' then raise; end if;
  end;
  select target_planet_name into v_target
    from public.attacks where target_planet_name = 'alpha-colony-13';
  if v_target is distinct from 'alpha-colony-13' then
    raise exception '8653 ASSERTION FAILED: rejected retarget must leave the original target';
  end if;
end $$;

-- ...while re-targeting onto a colony is allowed.
do $$
declare v_target text;
begin
  update public.attacks set target_planet_name = 'beta-colony-13'
   where target_planet_name = 'alpha-colony-13';
  select target_planet_name into v_target
    from public.attacks where target_planet_name = 'beta-colony-13';
  if v_target is distinct from 'beta-colony-13' then
    raise exception '8653 ASSERTION FAILED: retargeting onto a colony must succeed';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. A NON-TARGET update on an attack row passes untouched — the
--    column-restricted trigger (UPDATE OF target_planet_name) does not fire
--    for the resolve transition or status writes.
-- ---------------------------------------------------------------------
do $$
declare v_status text;
begin
  update public.attacks set status = 'resolved' where target_planet_name = 'beta-colony-13';
  select status into v_status from public.attacks where target_planet_name = 'beta-colony-13';
  if v_status is distinct from 'resolved' then
    raise exception '8653 ASSERTION FAILED: status update on an attack row must pass';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Re-run contract: the migration's idempotent constructs (CREATE OR
--    REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER) re-run
--    cleanly and the recreated guard still enforces the same rules.
-- ---------------------------------------------------------------------
create or replace function public.attacks_home_immunity_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_unconquerable boolean;
begin
  select unconquerable
    into v_unconquerable
    from public.owned_planets
   where planet_name = new.target_planet_name;
  if found and v_unconquerable then
    raise exception 'cannot attack unconquerable home world: %', new.target_planet_name;
  end if;
  return new;
end;
$$;
drop trigger if exists attacks_home_immunity_guard on public.attacks;
create trigger attacks_home_immunity_guard
  before insert or update of target_planet_name on public.attacks
  for each row
  execute function public.attacks_home_immunity_guard();

do $$ begin
  begin
    insert into public.attacks (target_planet_name, launcher_id, travel_seconds, resolves_at)
    values ('beta-13', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 600, now() + interval '1 hour');
    raise exception '8653 ASSERTION FAILED: recreated guard must still block a home-world insert';
  exception
    when others then
      if sqlerrm !~ 'unconquerable home world' then raise; end if;
  end;
end $$;
do $$
declare v_id uuid;
begin
  insert into public.attacks (target_planet_name, launcher_id, travel_seconds, resolves_at)
  values ('alpha-colony-13', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 600, now() + interval '1 hour')
  returning id into v_id;
  if v_id is null then
    raise exception '8653 ASSERTION FAILED: recreated guard must still allow colony inserts';
  end if;
end $$;

set local role postgres;

rollback;
