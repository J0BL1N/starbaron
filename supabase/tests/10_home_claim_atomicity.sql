-- =====================================================================
-- 10_home_claim_atomicity (P2 phase-2 audit — finding 4, round-3
-- completion of findings 1/2/3)
-- Purpose   : Contract tests for 0016_ownership_canonical's atomic
--             reservation against the applied 0001-0016 migration set.
--             The sim's selectHomeWorld is the pure SELECTOR (it derives
--             which home a player is assigned from a snapshot); the DATABASE
--             is the RESERVATION: the claim RPCs persist the canonical body
--             id (owned_planets.body_id) under a FULL UNIQUE index, so a
--             second claim of the SAME canonical body fails with
--             unique_violation no matter which name reached the claim.
--             Round-3 additions prove the completed findings:
--               * two claims of the same body_id -> the second raises
--                 unique_violation (23505) — the atomic reservation;
--               * claims of DIFFERENT body_ids succeed side by side;
--               * the audit rows record the canonical body_id (body_id
--                 ONLY — no planet_name fallback) and the acquisition
--                 method parity: home claim -> 'home-assignment', colony
--                 claim -> 'colonisation' (findings 2 + 3);
--               * p_body_id is REQUIRED: a NULL body_id raises a
--                 descriptive exception on both claim RPCs (finding 1);
--               * the starter-grid contract: the home claim row carries
--                 housing 1 (the FULL STARTER_STRUCTURES shape), the
--                 colony row carries housing 0 (finding 2);
--               * a fortification-resolution conquest tags the conquered
--                 row acquisition_method = 'conquest' and the audit row
--                 records method 'conquest' (finding 3).
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
--    FULL unique index on body_id and RAISES unique_violation: the DB is
--    the reservation.
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

-- ---------------------------------------------------------------------
-- 4. (finding 1) p_body_id is REQUIRED: a NULL body_id raises a descriptive
--    exception on BOTH claim RPCs. A already owns a home, so the idempotent
--    already-have-a-home return is a live alternative — the body_id check
--    must fire BEFORE it. Each call must raise (never silently return).
-- ---------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
begin
  begin
    perform public.claim_home_planet('home-null', 2::smallint, null, false, false, null);
    raise exception '8653 ASSERTION FAILED: claim_home_planet with NULL body_id must raise';
  exception
    when others then
      if sqlerrm !~ 'body_id' then raise; end if;
  end;
  begin
    perform public.claim_colony('colony-null', 1::smallint, null, false, false, null);
    raise exception '8653 ASSERTION FAILED: claim_colony with NULL body_id must raise';
  exception
    when others then
      if sqlerrm !~ 'body_id' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 5. (finding 2) Starter-grid parity: the HOME claim row carries housing 1
--    (the FULL STARTER_STRUCTURES shape of src/sim/player/grid.ts — every
--    structure key present, housing 1, all others 0); the COLONY row
--    carries housing 0 (colonies start with no starter structures).
-- ---------------------------------------------------------------------
set local role postgres;
do $$
declare
  v_home_grid   jsonb;
  v_home_housing int;
  v_colony_housing int;
begin
  select structure_levels into v_home_grid
    from public.owned_planets where planet_name = 'alpha-10';
  v_home_housing := coalesce((v_home_grid->>'housing')::int, -1);
  if v_home_housing <> 1 then
    raise exception '8653 ASSERTION FAILED: home claim housing %, expected 1 (STARTER_STRUCTURES)', v_home_housing;
  end if;
  if coalesce((v_home_grid->>'oreMine')::int, -1) <> 0
     or coalesce((v_home_grid->>'tradeHub')::int, -1) <> 0
     or coalesce((v_home_grid->>'hydroponics')::int, -1) <> 0
     or coalesce((v_home_grid->>'barracks')::int, -1) <> 0
     or coalesce((v_home_grid->>'shipyard')::int, -1) <> 0
     or coalesce((v_home_grid->>'defenseTurret')::int, -1) <> 0 then
    raise exception '8653 ASSERTION FAILED: home claim grid must be full STARTER_STRUCTURES (housing 1, all else 0): %', v_home_grid;
  end if;

  select coalesce((structure_levels->>'housing')::int, -1) into v_colony_housing
    from public.owned_planets where planet_name = 'colony-10';
  if v_colony_housing <> 0 then
    raise exception '8653 ASSERTION FAILED: colony claim housing %, expected 0 (no starter structures)', v_colony_housing;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. (finding 3) Fortification resolution tags conquest: B launches on A's
--    conquerable colony 'colony-10' (shipyard 1 + garrison on B's home
--    'gamma-10', A's player shield backdated), the attack resolves
--    decisive (DP 0, AP > 0 → ratio 9999), and the resolver's conquest
--    transfer must set acquisition_method = 'conquest' on the row AND the
--    audit trigger must record method 'conquest' for the change of hands.
-- ---------------------------------------------------------------------
set local role postgres;
update public.players set created_at = now() - interval '10 days'
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.owned_planets
   set structure_levels = structure_levels || '{"shipyard":1}'::jsonb,
       garrison = 1000
 where planet_name = 'gamma-10';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$ begin
  if (select public.launch_attack('colony-10', 100, 'gamma-10'))->>'status' <> 'inbound' then
    raise exception '8653 ASSERTION FAILED: B launch on colony-10 must be inbound';
  end if;
end $$;

set local role postgres;
update public.attacks set launched_at = launched_at - interval '2 days'
 where target_planet_name = 'colony-10' and status = 'inbound';
update public.attacks set resolves_at = now() - interval '1 second'
 where target_planet_name = 'colony-10' and status = 'inbound';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.resolve_due_attacks();
  if (v_res->0->>'outcome') <> 'decisive' then
    raise exception '8653 ASSERTION FAILED: colony-10 expected decisive, got %', v_res->0->>'outcome';
  end if;
  if (v_res->0->>'planet_taken') <> 'true' then
    raise exception '8653 ASSERTION FAILED: colony-10 must be taken';
  end if;
end $$;

set local role postgres;
do $$
declare
  v_owner    uuid;
  v_method   text;
  v_from     uuid;
  v_to       uuid;
begin
  select owner_id, acquisition_method into v_owner, v_method
    from public.owned_planets where planet_name = 'colony-10';
  if v_owner is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: colony-10 owner must be the conqueror (B)';
  end if;
  if v_method is distinct from 'conquest' then
    raise exception '8653 ASSERTION FAILED: conquered row acquisition_method %, expected conquest', v_method;
  end if;

  select from_owner_id, to_owner_id into v_from, v_to
    from public.ownership_audit
   where body_id = 'body:catalogue|alpha|planet|1'
     and method = 'conquest';
  if v_from is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     or v_to is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception '8653 ASSERTION FAILED: conquest audit from/to wrong: %, %', v_from, v_to;
  end if;
end $$;

set local role postgres;

-- ---------------------------------------------------------------------
-- 7. (finding 2, round 4) owned_planets.body_id is NOT NULL — static
--    contract. The SET NOT NULL itself is verified at APPLY time (the 0016
--    round-4 ALTER fails loudly on any NULL row); at test time the schema is
--    already in its canonical state, so this section STATICALLY reads the
--    column contract back from the catalog: body_id must be NOT NULL, and
--    the full unique index owned_planets_body_id_key must be present and
--    UNIQUE — with the column NOT NULL it admits no NULL escape.
-- ---------------------------------------------------------------------
do $$
declare
  v_is_nullable text;
  v_indexdef    text;
begin
  select is_nullable into v_is_nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'owned_planets'
     and column_name = 'body_id';
  if v_is_nullable is distinct from 'NO' then
    raise exception '8653 ASSERTION FAILED: owned_planets.body_id must be NOT NULL, catalog says %', v_is_nullable;
  end if;

  select indexdef into v_indexdef
    from pg_indexes
   where schemaname = 'public'
     and tablename = 'owned_planets'
     and indexname = 'owned_planets_body_id_key';
  if v_indexdef is null then
    raise exception '8653 ASSERTION FAILED: owned_planets_body_id_key unique index is missing';
  end if;
  if v_indexdef !~ 'UNIQUE' then
    raise exception '8653 ASSERTION FAILED: owned_planets_body_id_key must be a UNIQUE index: %', v_indexdef;
  end if;
end $$;

rollback;
