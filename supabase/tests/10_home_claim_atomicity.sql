-- =====================================================================
-- 10_home_claim_atomicity (P2 phase-2 audit — finding 4)
-- Purpose   : Contract tests for 0016_ownership_canonical's atomic
--             reservation against the applied 0001-0016 migration set.
--             The sim's selectHomeWorld is the pure SELECTOR (it derives
--             which home a player is assigned from a snapshot); the DATABASE
--             is the RESERVATION: the claim RPCs persist the canonical body
--             id (owned_planets.body_id) under a partial UNIQUE index, so a
--             second claim of the SAME canonical body fails with
--             unique_violation no matter which name reached the claim.
--             Proves:
--               * two claims of the same body_id -> the second raises
--                 unique_violation (23505) — the atomic reservation;
--               * claims of DIFFERENT body_ids succeed side by side;
--               * the audit rows record the canonical body_id (COALESCE of
--                 body_id over the legacy planet_name) and the acquisition
--                 method parity: home claim -> 'home-assignment', colony
--                 claim -> 'colonisation' (findings 2 + 3).
-- Run      : executed via the project's linked database test workflow
--             (see ROADMAP).
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK (world seeds,
-- auth.users rows, claims and audit rows all roll back).
-- =====================================================================

begin;

-- Canonical world layer seeds: the claim RPCs' body_id FK validates against
-- world_bodies, so the referenced rows must exist (0016 ships write-only;
-- the world layer is applied at claim time in production).
insert into public.world_galaxies (id, seed, name, class) values
  ('gal:catalogue', 'catalogue', 'Catalogue', 'spiral');

insert into public.world_systems (id, galaxy_id, seed, name, star_name, star_color, star_type) values
  ('sys:catalogue|alpha', 'gal:catalogue', 'alpha', 'Alpha', 'Alpha', 'G', 'G'),
  ('sys:catalogue|beta',  'gal:catalogue', 'beta',  'Beta',  'Beta',  'G', 'G');

insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius, semi_major_axis, period) values
  ('body:catalogue|alpha|planet|0', 'sys:catalogue|alpha', 'planet', 'Alpha b', 'alpha-b', 0, 1.0, 8, 1),
  ('body:catalogue|alpha|planet|1', 'sys:catalogue|alpha', 'planet', 'Alpha c', 'alpha-c', 1, 1.0, 9, 1),
  ('body:catalogue|beta|planet|0',  'sys:catalogue|beta',  'planet', 'Beta b',  'beta-b',  0, 1.0, 10, 1);

insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now());

-- ---------------------------------------------------------------------
-- 1. Atomic reservation: A claims the home 'alpha-10' reserving the body
--    'body:catalogue|alpha|planet|0'. B's snapshot still showed that body
--    free, so B claims a DIFFERENT planet name ('beta-10') with the SAME
--    body id — the planet-name check passes, the INSERT then violates the
--    partial unique index and RAISES unique_violation: the DB is the
--    reservation.
-- ---------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare r jsonb;
begin
  select public.claim_home_planet('alpha-10', 2::smallint, null, false, false, 'body:catalogue|alpha|planet|0') into r;
  if r->>'planet_name' <> 'alpha-10' then
    raise exception '8653 ASSERTION FAILED: A home claim failed: %', r;
  end if;
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
begin
  begin
    perform public.claim_home_planet('beta-10', 2::smallint, null, false, false, 'body:catalogue|alpha|planet|0');
    raise exception '8653 ASSERTION FAILED: second claim of the same body_id must raise unique_violation';
  exception
    when unique_violation then null; -- expected: the atomic reservation
  end;
end $$;

-- ---------------------------------------------------------------------
-- 2. Different body_ids succeed side by side: A colonises with one body id,
--    B claims a home with another.
-- ---------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare r jsonb;
begin
  select public.claim_colony('colony-10', 1::smallint, null, false, false, 'body:catalogue|alpha|planet|1') into r;
  if r->>'planet_name' <> 'colony-10' or r->>'is_home' <> 'false' then
    raise exception '8653 ASSERTION FAILED: A colony claim failed: %', r;
  end if;
end $$;

set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare r jsonb;
begin
  select public.claim_home_planet('gamma-10', 2::smallint, null, false, false, 'body:catalogue|beta|planet|0') into r;
  if r->>'planet_name' <> 'gamma-10' then
    raise exception '8653 ASSERTION FAILED: B home claim failed: %', r;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Audit parity + canonical body id (findings 2 + 3): the home claim's
--    audit row records the canonical body id (not the planet name) with
--    method 'home-assignment'; the colony claim records 'colonisation'; no
--    audit row is keyed by the legacy planet_name.
-- ---------------------------------------------------------------------
set local role postgres;
do $$
declare
  v_home_method   text;
  v_colony_method text;
  v_legacy        bigint;
begin
  select method into v_home_method
    from public.ownership_audit
   where body_id = 'body:catalogue|alpha|planet|0';
  if v_home_method is distinct from 'home-assignment' then
    raise exception '8653 ASSERTION FAILED: home audit method %, expected home-assignment', v_home_method;
  end if;

  select method into v_colony_method
    from public.ownership_audit
   where body_id = 'body:catalogue|alpha|planet|1';
  if v_colony_method is distinct from 'colonisation' then
    raise exception '8653 ASSERTION FAILED: colony audit method %, expected colonisation', v_colony_method;
  end if;

  select count(*) into v_legacy
    from public.ownership_audit
   where body_id in ('alpha-10', 'colony-10');
  if v_legacy <> 0 then
    raise exception '8653 ASSERTION FAILED: audit must record body_id, not planet_name, found % legacy-keyed rows', v_legacy;
  end if;
end $$;

set local role postgres;

rollback;
