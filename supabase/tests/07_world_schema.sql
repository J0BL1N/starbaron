-- =====================================================================
-- 07_world_schema (P1-T06-C)
-- Purpose   : P1-T06 contract tests for the canonical world tables against
--             the applied 0001-0013 migration set. Proves:
--               * world_galaxies insert/select round-trip with the exact
--                 defaults (radius 600 = DEFAULT_GALAXY_RADIUS, position
--                 0/0/0, generation_version 1, real_data false, provenance
--                 'procedural'); the class CHECK, the radius > 0 CHECK and
--                 the generation_version > 0 CHECK reject violations.
--               * world_systems FK enforcement (an orphan insert with no
--                 parent galaxy row raises foreign_key_violation), the
--                 generation_version > 0 CHECK, and ON DELETE CASCADE from
--                 the galaxy (deleting a galaxy removes its systems).
--               * world_bodies: the type CHECK rejects anything outside
--                 star|planet|moon|asteroid; the ordinal >= 0 CHECK rejects
--                 negatives; the eccentricity < 1 CHECK rejects a parabola
--                 1.0; the radius > 0 CHECK rejects 0; the
--                 semi_major_axis >= 0 and period >= 0 CHECKs reject -1;
--                 the generation_version > 0 CHECK rejects 0; an orphan
--                 insert with no parent system row raises
--                 foreign_key_violation; the UNIQUE (system_id, ordinal)
--                 constraint rejects a second body with the same ordinal in
--                 the same system; the galaxy -> system -> body cascade
--                 removes bodies with their system.
--               * anon has NO privileges on the three tables (deny by
--                 default, 01_claim_rls.sql style) — SELECT and INSERT both
--                 raise insufficient_privilege, never return 0 rows; a
--                 has_table_privilege probe (02_attack_rls.sql belt-and-
--                 braces style) confirms anon AND authenticated hold no
--                 world-table privileges.
--             Idempotency (DOCUMENTED expectation, not asserted here —
--             the executable assertion needs a SECOND fresh stack, which is
--             out of scope for a psql suite): 0013 is CREATE TABLE/INDEX IF
--             NOT EXISTS + no-op REVOKEs/ALTERs, so re-running it is safe;
--             the migration's own guards are the contract (0013 header,
--             "Idempotent: YES").
-- Run      : plain psql script — run via the repo suite harness.
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK. No auth.users
-- seeding needed — world tables carry no player FK.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. ACL belt-and-braces probe (as the elevated runner): client roles must
--    hold no world-table privileges at all — the REVOKE set in 0013 is the
--    grant-level contract, independent of RLS (02_attack_rls.sql §g style).
-- ---------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.world_galaxies', 'SELECT')
     or has_table_privilege('anon', 'public.world_systems', 'SELECT')
     or has_table_privilege('anon', 'public.world_bodies', 'SELECT')
     or has_table_privilege('anon', 'public.world_galaxies', 'INSERT')
     or has_table_privilege('anon', 'public.world_systems', 'INSERT')
     or has_table_privilege('anon', 'public.world_bodies', 'INSERT')
     or has_table_privilege('authenticated', 'public.world_galaxies', 'SELECT')
     or has_table_privilege('authenticated', 'public.world_systems', 'SELECT')
     or has_table_privilege('authenticated', 'public.world_bodies', 'SELECT')
     or has_table_privilege('authenticated', 'public.world_bodies', 'INSERT') then
    raise exception '8653 ASSERTION FAILED: client roles must hold no world-table privileges';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. world_galaxies round-trip + defaults. Canonical id 'gal:<slug>' is
--    the PRIMARY KEY; every generator default is asserted exactly.
-- ---------------------------------------------------------------------
insert into public.world_galaxies (id, seed, name, class)
values ('gal:test-alpha', 'alpha-seed', 'Test Alpha', 'spiral');

do $$
declare
  v_class text;
  v_px double precision; v_py double precision; v_pz double precision;
  v_radius double precision;
  v_gen integer;
  v_real boolean;
  v_prov text;
begin
  select class, position_x, position_y, position_z, radius,
         generation_version, real_data, provenance
    into v_class, v_px, v_py, v_pz, v_radius, v_gen, v_real, v_prov
    from public.world_galaxies
   where id = 'gal:test-alpha';
  if v_class is null then
    raise exception '8653 ASSERTION FAILED: galaxy round-trip must find the inserted row';
  end if;
  if v_class <> 'spiral' or v_px <> 0 or v_py <> 0 or v_pz <> 0
     or v_radius <> 600 or v_gen <> 1 or v_real <> false or v_prov <> 'procedural' then
    raise exception '8653 ASSERTION FAILED: galaxy defaults wrong (class % pos %/%/% radius % gen % real % prov %)',
      v_class, v_px, v_py, v_pz, v_radius, v_gen, v_real, v_prov;
  end if;
end $$;

-- class CHECK (outside the GalaxyClass union) + radius > 0 CHECK (0) +
-- generation_version > 0 CHECK (0): all must raise and none may persist.
do $$
declare v_n bigint;
begin
  begin
    insert into public.world_galaxies (id, seed, name, class)
    values ('gal:bad-class', 's', 'Bad', 'banana');
    raise exception '8653 ASSERTION FAILED: galaxy class outside the union must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.world_galaxies (id, seed, name, class, radius)
    values ('gal:bad-radius', 's', 'Bad', 'spiral', 0);
    raise exception '8653 ASSERTION FAILED: galaxy radius 0 must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.world_galaxies (id, seed, name, class, generation_version)
    values ('gal:bad-gen', 's', 'Bad', 'spiral', 0);
    raise exception '8653 ASSERTION FAILED: galaxy generation_version 0 must raise';
  exception
    when check_violation then null; -- expected
  end;
  select count(*) into v_n from public.world_galaxies;
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: rejected galaxy inserts must not persist, saw % rows', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. world_systems: valid insert + round-trip (FK satisfied), orphan insert
--    rejected (FK enforcement), galaxy -> system cascade (deferred to §4
--    with the body cascade).
-- ---------------------------------------------------------------------
insert into public.world_systems (id, galaxy_id, seed, name, star_name, star_type, star_color)
values ('sys:test-alpha|alpha-seed', 'gal:test-alpha', 'alpha-seed', 'Test Alpha', 'Test Alpha Prime', 'G', '#fff4e8');

do $$
declare
  v_galaxy text;
  v_star text; v_type text; v_color text;
  v_px double precision;
  v_gen integer;
begin
  select galaxy_id, star_name, star_type, star_color, position_x, generation_version
    into v_galaxy, v_star, v_type, v_color, v_px, v_gen
    from public.world_systems
   where id = 'sys:test-alpha|alpha-seed';
  if v_galaxy is null then
    raise exception '8653 ASSERTION FAILED: system round-trip must find the inserted row';
  end if;
  if v_galaxy <> 'gal:test-alpha' or v_star <> 'Test Alpha Prime' or v_type <> 'G'
     or v_color <> '#fff4e8' or v_px <> 0 or v_gen <> 1 then
    raise exception '8653 ASSERTION FAILED: system round-trip wrong (galaxy % star % type % color % pos % gen %)',
      v_galaxy, v_star, v_type, v_color, v_px, v_gen;
  end if;
end $$;

-- orphan insert (no parent galaxy row) -> FK violation; no row persists.
do $$
declare v_n bigint;
begin
  begin
    insert into public.world_systems (id, galaxy_id, seed, name, star_name, star_color)
    values ('sys:ghost|g', 'gal:no-such', 'g', 'Ghost', 'Ghost Prime', '#ffd27a');
    raise exception '8653 ASSERTION FAILED: orphan system insert must raise FK violation';
  exception
    when foreign_key_violation then null; -- expected
  end;
  select count(*) into v_n from public.world_systems;
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: orphan system must not persist, saw % rows', v_n;
  end if;
end $$;

-- generation_version > 0 CHECK (0): must raise; no row persists.
do $$
declare v_n bigint;
begin
  begin
    insert into public.world_systems (id, galaxy_id, seed, name, star_name, star_color, generation_version)
    values ('sys:bad-gen|g', 'gal:test-alpha', 'g', 'Bad', 'Bad Prime', '#fff4e8', 0);
    raise exception '8653 ASSERTION FAILED: system generation_version 0 must raise';
  exception
    when check_violation then null; -- expected
  end;
  select count(*) into v_n from public.world_systems;
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: rejected system generation_version must not persist, saw % rows', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. world_bodies: round-trip + defaults (star ZERO orbit: semi_major_axis
--    0, eccentricity 0, period 0, mass NULL), type CHECK, ordinal >= 0
--    CHECK, eccentricity < 1 CHECK, UNIQUE (system_id, ordinal).
-- ---------------------------------------------------------------------
insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius)
values ('body:test-alpha|alpha-seed|star|0',    'sys:test-alpha|alpha-seed', 'star',   'Test Alpha Prime', 'star-seed', 0, 4.0),
       ('body:test-alpha|alpha-seed|planet|1',  'sys:test-alpha|alpha-seed', 'planet', 'Verdant',          'p1',        1, 1.5),
       ('body:test-alpha|alpha-seed|planet|2',  'sys:test-alpha|alpha-seed', 'planet', 'Mara',             'p2',        2, 1.2);

do $$
declare
  v_type text;
  v_ord int;
  v_sma double precision; v_ecc double precision; v_period double precision;
  v_mass double precision;
  v_n bigint;
begin
  -- planet round-trip: orbit defaults are all 0, mass NULL (BodyRecord.mass?).
  select type, ordinal, semi_major_axis, eccentricity, period, mass
    into v_type, v_ord, v_sma, v_ecc, v_period, v_mass
    from public.world_bodies
   where id = 'body:test-alpha|alpha-seed|planet|1';
  if v_type is null then
    raise exception '8653 ASSERTION FAILED: body round-trip must find the inserted row';
  end if;
  if v_type <> 'planet' or v_ord <> 1 or v_sma <> 0 or v_ecc <> 0
     or v_period <> 0 or v_mass is not null then
    raise exception '8653 ASSERTION FAILED: body defaults wrong (type % ord % sma % ecc % period % mass %)',
      v_type, v_ord, v_sma, v_ecc, v_period, v_mass;
  end if;

  -- type CHECK: not in star|planet|moon|asteroid.
  begin
    insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius)
    values ('body:test-alpha|alpha-seed|comet|9', 'sys:test-alpha|alpha-seed', 'comet', 'Bad', 'b', 9, 1.0);
    raise exception '8653 ASSERTION FAILED: body type outside star|planet|moon|asteroid must raise';
  exception
    when check_violation then null; -- expected
  end;

  -- ordinal >= 0 CHECK: negative ordinal (identity.ts assertOrdinal).
  begin
    insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius)
    values ('body:test-alpha|alpha-seed|planet|255', 'sys:test-alpha|alpha-seed', 'planet', 'Neg', 'b', -1, 1.0);
    raise exception '8653 ASSERTION FAILED: negative body ordinal must raise';
  exception
    when check_violation then null; -- expected
  end;

  -- eccentricity [0,1) CHECK: 1.0 is a parabola, body.ts:234 rejects it.
  begin
    insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius, eccentricity)
    values ('body:test-alpha|alpha-seed|planet|254', 'sys:test-alpha|alpha-seed', 'planet', 'Par', 'b', 254, 1.0, 1.0);
    raise exception '8653 ASSERTION FAILED: eccentricity 1.0 must raise';
  exception
    when check_violation then null; -- expected
  end;

  -- UNIQUE (system_id, ordinal): body 2 re-uses ordinal 1 in the same system.
  begin
    insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius)
    values ('body:test-alpha|alpha-seed|planet|253', 'sys:test-alpha|alpha-seed', 'planet', 'Dup', 'b', 1, 1.0);
    raise exception '8653 ASSERTION FAILED: duplicate (system_id, ordinal) must raise unique violation';
  exception
    when unique_violation then null; -- expected
  end;

  -- generation_version > 0 CHECK: 0 is invalid.
  begin
    insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius, generation_version)
    values ('body:test-alpha|alpha-seed|planet|252', 'sys:test-alpha|alpha-seed', 'planet', 'Gen', 'b', 252, 1.0, 0);
    raise exception '8653 ASSERTION FAILED: body generation_version 0 must raise';
  exception
    when check_violation then null; -- expected
  end;

  -- radius > 0 CHECK: 0 is invalid.
  begin
    insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius)
    values ('body:test-alpha|alpha-seed|planet|251', 'sys:test-alpha|alpha-seed', 'planet', 'Rad', 'b', 251, 0);
    raise exception '8653 ASSERTION FAILED: body radius 0 must raise';
  exception
    when check_violation then null; -- expected
  end;

  -- semi_major_axis >= 0 CHECK: -1 is invalid.
  begin
    insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius, semi_major_axis)
    values ('body:test-alpha|alpha-seed|planet|250', 'sys:test-alpha|alpha-seed', 'planet', 'Sma', 'b', 250, 1.0, -1);
    raise exception '8653 ASSERTION FAILED: body semi_major_axis -1 must raise';
  exception
    when check_violation then null; -- expected
  end;

  -- period >= 0 CHECK: -1 is invalid.
  begin
    insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius, period)
    values ('body:test-alpha|alpha-seed|planet|249', 'sys:test-alpha|alpha-seed', 'planet', 'Per', 'b', 249, 1.0, -1);
    raise exception '8653 ASSERTION FAILED: body period -1 must raise';
  exception
    when check_violation then null; -- expected
  end;

  select count(*) into v_n from public.world_bodies;
  if v_n <> 3 then
    raise exception '8653 ASSERTION FAILED: rejected body inserts must not persist, saw % rows', v_n;
  end if;
end $$;

-- orphan insert (no parent system row) -> FK violation; no row persists.
do $$
declare v_n bigint;
begin
  begin
    insert into public.world_bodies (id, system_id, type, name, seed, ordinal, radius)
    values ('body:ghost|g|planet|9', 'sys:no-such', 'planet', 'Ghost', 'g', 9, 1.0);
    raise exception '8653 ASSERTION FAILED: orphan body insert must raise FK violation';
  exception
    when foreign_key_violation then null; -- expected
  end;
  select count(*) into v_n from public.world_bodies;
  if v_n <> 3 then
    raise exception '8653 ASSERTION FAILED: orphan body must not persist, saw % rows', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. ON DELETE CASCADE: deleting the galaxy removes its systems AND their
--    bodies — the FK chain world_galaxies -> world_systems -> world_bodies.
-- ---------------------------------------------------------------------
do $$
declare v_g bigint; v_s bigint; v_b bigint;
begin
  delete from public.world_galaxies where id = 'gal:test-alpha';
  select count(*) into v_g from public.world_galaxies where id = 'gal:test-alpha';
  select count(*) into v_s from public.world_systems   where id = 'sys:test-alpha|alpha-seed';
  select count(*) into v_b from public.world_bodies    where system_id = 'sys:test-alpha|alpha-seed';
  if v_g <> 0 or v_s <> 0 or v_b <> 0 then
    raise exception '8653 ASSERTION FAILED: galaxy cascade must remove systems and bodies, saw g % s % b %',
      v_g, v_s, v_b;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. anon has NO privileges on the three tables (deny by default) — SELECT
--    and INSERT both raise insufficient_privilege (42501), the same
--    assertion shape as 01_claim_rls.sql §4.
-- ---------------------------------------------------------------------
set local role anon;
do $$
begin
  begin
    perform count(*) from public.world_galaxies;
    raise exception '8653 ASSERTION FAILED: anon must be denied SELECT on world_galaxies';
  exception
    when insufficient_privilege then null; -- expected
  end;
  begin
    perform count(*) from public.world_systems;
    raise exception '8653 ASSERTION FAILED: anon must be denied SELECT on world_systems';
  exception
    when insufficient_privilege then null; -- expected
  end;
  begin
    perform count(*) from public.world_bodies;
    raise exception '8653 ASSERTION FAILED: anon must be denied SELECT on world_bodies';
  exception
    when insufficient_privilege then null; -- expected
  end;
  begin
    insert into public.world_galaxies (id, seed, name, class)
    values ('gal:anon', 'a', 'Anon', 'spiral');
    raise exception '8653 ASSERTION FAILED: anon must be denied INSERT on world_galaxies';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;
set local role postgres;

rollback;
