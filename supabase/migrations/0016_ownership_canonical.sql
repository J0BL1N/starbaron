-- =====================================================================
-- 0016_ownership_canonical (Phase 2 whole-phase audit — closes Phase 2)
-- Purpose   : The four canonical-ownership fixes from the phase audit,
--             applied as ONE append-only forward migration:
--               1. protection irreversibility (T03/T04/T07): a parity CHECK
--                  makes is_home = unconquerable a data-level invariant, and
--                  the 0014 guard is replaced so a protected row's
--                  is_home/unconquerable flags can never CHANGE — protection
--                  is irreversible, not just owner-transfer-blocked;
--               2. canonical body ids (T02-T08): owned_planets gains
--                  body_id -> world_bodies (ON DELETE RESTRICT), and the
--                  0015 audit logger writes COALESCE(body_id, planet_name);
--               3. acquisition-method parity (T04/T06): owned_planets gains
--                  acquisition_method (the AcquisitionMethod union of
--                  src/sim/player/ownership.ts), the claim RPCs tag home vs
--                  colony, and the audit logger copies the row's
--                  acquisition_method for first ownerships;
--               4. atomic reservation (T02/T08): a partial UNIQUE index on
--                  body_id makes a second claim of the same canonical body
--                  fail with unique_violation — the DB is the reservation,
--                  the sim's selectHomeWorld is the selector.
--             The claim RPCs adopt body_id (the canonical id, derived at the
--             app layer from the catalogue mapping) at the point the
--             canonical world layer is applied: this stack is write-only,
--             the mapping completes at apply time.
-- MIGRATION STRATEGY : append-only, forward-only. 0014/0015 are NOT edited;
--   every construct below is ALTER + CREATE OR REPLACE + CREATE, so the new
--   file layers on top of them.
-- Idempotent : YES — column adds use IF NOT EXISTS; the parity CHECK is
--   guarded by a pg_constraint probe (Postgres has no ADD CONSTRAINT IF NOT
--   EXISTS); the unique index uses CREATE UNIQUE INDEX IF NOT EXISTS; the
--   two trigger functions are CREATE OR REPLACE with DROP TRIGGER IF EXISTS
--   + CREATE TRIGGER; the claim RPCs DROP their old 5-arg overloads before
--   CREATE OR REPLACE on the 6-arg signatures and re-grant EXECUTE (the
--   0003 grants die with the dropped overloads).
-- Date      : 2026-08-13
-- Scope     : owned_planets columns + CHECK + index; both owned_planets
--             trigger functions replaced; claim_home_planet/claim_colony
--             replaced at their 6-arg signatures. No table drops. No new
--             client grants beyond the re-grants the overload replacement
--             requires.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Protection irreversibility — the parity CHECK (is_home =
--    unconquerable) binds the two flags at rest. Every write path that
--    constructs a row (0003 claim RPCs: home true/true, colony false/false;
--    0005 conquest: false/false) already writes agreeing flags, so the
--    constraint is satisfiable by existing data and future inserts; a flag
--    flip in isolation is rejected by the CHECK before the row commits.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'owned_planets_home_parity'
       and conrelid = 'public.owned_planets'::regclass
  ) then
    alter table public.owned_planets
      add constraint owned_planets_home_parity
      check (is_home = unconquerable);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Canonical body id — NULL until the canonical world layer is applied
--    (the claim RPCs accept p_body_id from the app layer; the FK validates
--    membership in world_bodies at insert time). ON DELETE RESTRICT keeps a
--    body row deletable only while no owned planet references it.
-- ---------------------------------------------------------------------
alter table public.owned_planets
  add column if not exists body_id text
  references public.world_bodies (id) on delete restrict;

-- ---------------------------------------------------------------------
-- 3. Acquisition-method parity — the row carries the AcquisitionMethod
--    union (mirror of src/sim/player/ownership.ts). Home claims default to
--    'home-assignment'; the colony RPC sets 'colonisation' explicitly.
-- ---------------------------------------------------------------------
alter table public.owned_planets
  add column if not exists acquisition_method text
  not null default 'home-assignment'
  check (acquisition_method in ('home-assignment','colonisation','conquest','trade'));

-- ---------------------------------------------------------------------
-- 4. Atomic reservation — the partial UNIQUE index on body_id is the
--    DB-level reservation: a second claim of the same canonical body raises
--    unique_violation no matter which claim path reaches it (the advisory
--    xact lock in the claim RPCs serialises same-NAME claims; this index
--    closes the same-BODY race).
-- ---------------------------------------------------------------------
create unique index if not exists owned_planets_body_id_key
  on public.owned_planets (body_id)
  where body_id is not null;

-- ---------------------------------------------------------------------
-- 5. 0014 guard replacement — the owner-change and delete guards are
--    unchanged (they key on OLD.unconquerable, the pre-update flag, so a
--    conquest can never first clear the flag on the same statement). NEW:
--    a protected row's is_home/unconquerable flags can never CHANGE either,
--    so protection is irreversible — the parity CHECK (step 1) backstops the
--    same invariant for unprotected rows (they cannot flip is_home alone).
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
  if tg_op = 'UPDATE' and old.unconquerable
     and new.owner_id is distinct from old.owner_id then
    raise exception 'cannot transfer unconquerable home world: %', old.planet_name;
  end if;
  if tg_op = 'UPDATE' and old.unconquerable
     and (new.is_home is distinct from old.is_home
          or new.unconquerable is distinct from old.unconquerable) then
    raise exception 'cannot declassify unconquerable home world: %', old.planet_name;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.owned_planets_home_world_guard() from public, anon;

drop trigger if exists owned_planets_home_world_guard on public.owned_planets;
create trigger owned_planets_home_world_guard
  before update or delete on public.owned_planets
  for each row
  execute function public.owned_planets_home_world_guard();

-- ---------------------------------------------------------------------
-- 6. 0015 audit logger replacement — first-ownership rows now record the
--    canonical body id (COALESCE of body_id and the legacy planet_name key)
--    and the ROW'S acquisition_method: a home claim logs 'home-assignment',
--    a colony claim logs 'colonisation' (finding 3 removes the documented
--    0015 simplification). The owner-change branch keeps the generic
--    'conquest' change-of-hands method (0015's documented mapping: the row's
--    acquisition_method column is the ORIGINAL acquisition method and is
--    not rewritten by the 0005 conquest UPDATE, so copying it there would
--    mislabel a transfer). The AFTER + UPDATE OF owner_id declaration and
--    the BEFORE-then-AFTER ordering (0014 before 0015) are unchanged, so a
--    rejected home transfer still writes no audit row.
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
      coalesce(new.body_id, new.planet_name), null, new.owner_id, new.acquisition_method,
      floor(extract(epoch from now()) * 1000)::bigint
    );
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into public.ownership_audit (
      body_id, from_owner_id, to_owner_id, method, at_ms
    ) values (
      coalesce(new.body_id, new.planet_name), old.owner_id, new.owner_id, 'conquest',
      floor(extract(epoch from now()) * 1000)::bigint
    );
  end if;
  return new;
end;
$$;

revoke all on function public.owned_planets_audit_logger() from public, anon, authenticated;

drop trigger if exists owned_planets_ownership_audit on public.owned_planets;
create trigger owned_planets_ownership_audit
  after insert or update of owner_id on public.owned_planets
  for each row
  execute function public.owned_planets_audit_logger();

-- ---------------------------------------------------------------------
-- 7. Claim RPCs (0003 replacement at the 6-arg signatures) — the old 5-arg
--    overloads are dropped first so every existing call (SQL tests, backend
--    client) resolves to the new signatures; p_body_id carries the canonical
--    body id derived at the app layer. claim_home_planet sets
--    acquisition_method 'home-assignment' explicitly (the column default),
--    claim_colony sets 'colonisation'. The advisory xact lock, the
--    idempotent already-have-a-home check, the planet_taken check and the
--    FK-validated body_id insert are the claim contract.
-- ---------------------------------------------------------------------
drop function if exists public.claim_home_planet(text, smallint, double precision, boolean, boolean);
drop function if exists public.claim_colony(text, smallint, double precision, boolean, boolean);

create or replace function public.claim_home_planet(
  p_planet_name   text,
  p_tier          smallint,
  p_distance_pc   double precision default null,
  p_massive_world boolean default false,
  p_dense_core    boolean default false,
  p_body_id       text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me               uuid := auth.uid();
  v_baseline       double precision;
  v_pop_cap_mult   double precision;
  v_planet         public.owned_planets%rowtype;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501';
  end if;

  if p_tier not between 1 and 5 then
    raise exception 'tier must be between 1 and 5, got %', p_tier;
  end if;

  if p_distance_pc is not null and (p_distance_pc = 'NaN'::float8 or p_distance_pc = 'Infinity'::float8 or p_distance_pc = '-Infinity'::float8 or p_distance_pc < 0) then
    raise exception 'distance_pc must be null or a finite, non-negative number, got %', p_distance_pc;
  end if;

  -- Idempotent: already own a home -> return it (0003 step 2).
  select * into v_planet
    from public.owned_planets
   where owner_id = me and is_home
   limit 1;
  if found then
    return to_jsonb(v_planet);
  end if;

  -- Serialise same-NAME claimants (0003 layer 2); the partial unique index
  -- on body_id (step 4 above) is the atomic same-BODY backstop.
  perform pg_advisory_xact_lock(hashtextextended(p_planet_name, 0));

  -- Re-check after acquiring the lock: second claimant sees it taken.
  if exists (
    select 1 from public.owned_planets where planet_name = p_planet_name
  ) then
    return jsonb_build_object('claimed', false, 'reason', 'planet_taken');
  end if;

  -- Player row is created on first claim (FK owner_id -> players requires it).
  insert into public.players (id)
  values (me)
  on conflict (id) do nothing;

  v_baseline     := 10 * p_tier;
  v_pop_cap_mult := case p_tier
                      when 1 then 1.0
                      when 2 then 1.2
                      when 3 then 1.4
                      when 4 then 1.7
                      when 5 then 2.0
                    end;

  insert into public.owned_planets (
    owner_id,
    planet_name,
    body_id,
    tier,
    baseline_income_per_sec,
    population_cap_multiplier,
    distance_pc,
    is_home,
    unconquerable,
    acquisition_method,
    massive_world,
    dense_core,
    population,
    garrison,
    fleet,
    structure_levels
  )
  values (
    me,
    p_planet_name,
    p_body_id,
    p_tier,
    v_baseline,
    v_pop_cap_mult,
    p_distance_pc,
    true,
    true,
    'home-assignment',
    p_massive_world,
    p_dense_core,
    1000,
    0,
    0,
    '{"oreMine":0,"tradeHub":0,"housing":0,"hydroponics":0,"barracks":0,"shipyard":0,"defenseTurret":0}'::jsonb
  )
  returning * into v_planet;

  return to_jsonb(v_planet);
end;
$$;

create or replace function public.claim_colony(
  p_planet_name   text,
  p_tier          smallint,
  p_distance_pc   double precision default null,
  p_massive_world boolean default false,
  p_dense_core    boolean default false,
  p_body_id       text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me               uuid := auth.uid();
  v_baseline       double precision;
  v_pop_cap_mult   double precision;
  v_planet         public.owned_planets%rowtype;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501';
  end if;

  if p_tier not between 1 and 5 then
    raise exception 'tier must be between 1 and 5, got %', p_tier;
  end if;

  if p_distance_pc is not null and (p_distance_pc = 'NaN'::float8 or p_distance_pc = 'Infinity'::float8 or p_distance_pc = '-Infinity'::float8 or p_distance_pc < 0) then
    raise exception 'distance_pc must be null or a finite, non-negative number, got %', p_distance_pc;
  end if;

  -- Colonise requires a claimed home planet (0003 audit).
  if not exists (
    select 1 from public.owned_planets where owner_id = me and is_home
  ) then
    raise exception 'no home planet — colonise requires a claimed home';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_planet_name, 0));

  if exists (
    select 1 from public.owned_planets where planet_name = p_planet_name
  ) then
    return jsonb_build_object('claimed', false, 'reason', 'planet_taken');
  end if;

  v_baseline     := 10 * p_tier;
  v_pop_cap_mult := case p_tier
                      when 1 then 1.0
                      when 2 then 1.2
                      when 3 then 1.4
                      when 4 then 1.7
                      when 5 then 2.0
                    end;

  insert into public.owned_planets (
    owner_id,
    planet_name,
    body_id,
    tier,
    baseline_income_per_sec,
    population_cap_multiplier,
    distance_pc,
    is_home,
    unconquerable,
    acquisition_method,
    massive_world,
    dense_core,
    population,
    garrison,
    fleet,
    structure_levels
  )
  values (
    me,
    p_planet_name,
    p_body_id,
    p_tier,
    v_baseline,
    v_pop_cap_mult,
    p_distance_pc,
    false,
    false,
    'colonisation',
    p_massive_world,
    p_dense_core,
    0,
    0,
    0,
    '{"oreMine":0,"tradeHub":0,"housing":0,"hydroponics":0,"barracks":0,"shipyard":0,"defenseTurret":0}'::jsonb
  )
  returning * into v_planet;

  return to_jsonb(v_planet);
end;
$$;

revoke all on function public.claim_home_planet(text, smallint, double precision, boolean, boolean, text) from public, anon;
revoke all on function public.claim_colony(text, smallint, double precision, boolean, boolean, text)     from public, anon;
grant execute on function public.claim_home_planet(text, smallint, double precision, boolean, boolean, text) to authenticated, service_role;
grant execute on function public.claim_colony(text, smallint, double precision, boolean, boolean, text)     to authenticated, service_role;

-- =====================================================================
-- ROUND-3 COMPLETION (whole-phase audit round 3 — closes Phase 2)
-- Purpose   : The round-2 statements above did NOT fully land. These
--             appended sections COMPLETE the three outstanding findings
--             by REPLACING the constructs above (CREATE OR REPLACE / DROP
--             INDEX + CREATE) so the file, read top-to-bottom, ends in the
--             correct canonical state:
--               * (finding 1) p_body_id is REQUIRED on both claim RPCs —
--                 the default is dropped and a null argument raises; the
--                 reservation is a FULL unique index on body_id (not
--                 partial); the audit logger writes NEW.body_id ONLY (no
--                 planet_name fallback).
--               * (finding 2) claim_home_planet inserts the FULL
--                 STARTER_STRUCTURES grid ({housing:1, all else 0} — the
--                 src/sim/player/grid.ts shape); claim_colony keeps
--                 housing:0 (colonies start with no starter structures;
--                 starter resources apply to the home world only).
--               * (finding 3) the fortification resolver resolve_attack
--                 (the 0012 CREATE OR REPLACE) tags EVERY owner_id change
--                 with acquisition_method = 'conquest', consistent with
--                 transferOwnership/conquestTransfer in
--                 src/sim/player/ownership.ts.
-- Idempotent : YES — DROP INDEX IF EXISTS + CREATE UNIQUE INDEX, CREATE OR
--             REPLACE functions, DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 8. (finding 1) FULL unique index on owned_planets (body_id). The
--    round-2 partial index (step 4 above) reserved only non-null body_ids;
--    the claim RPCs now REQUIRE body_id, so every row carries one and the
--    reservation is the full unique index. A second claim of the same
--    canonical body raises unique_violation at the index, not the partial
--    WHERE clause. Guarded note: this stack is write-only (no data applied,
--    so every row is a required-body_id row at apply time); an already-
--    applied stack with legacy null-body_id rows MUST backfill body_id on
--    every owned_planets row (and de-duplicate body_ids) before this
--    CREATE runs, else the CREATE fails loudly.
-- ---------------------------------------------------------------------
drop index if exists public.owned_planets_body_id_key;
create unique index if not exists owned_planets_body_id_key
  on public.owned_planets (body_id);

-- ---------------------------------------------------------------------
-- 9. (finding 1) Audit logger replacement — NEW.body_id ONLY. The 0015
--    COALESCE fallback (and the round-2 COALESCE) are removed entirely:
--    first-ownership rows record new.body_id, owner-change rows record
--    new.body_id, method 'conquest'. A legacy planet-name key never
--    reaches the audit row. INSERT method = the row's acquisition_method
--    (home 'home-assignment', colony 'colonisation').
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
      new.body_id, null, new.owner_id, new.acquisition_method,
      floor(extract(epoch from now()) * 1000)::bigint
    );
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into public.ownership_audit (
      body_id, from_owner_id, to_owner_id, method, at_ms
    ) values (
      new.body_id, old.owner_id, new.owner_id, 'conquest',
      floor(extract(epoch from now()) * 1000)::bigint
    );
  end if;
  return new;
end;
$$;

revoke all on function public.owned_planets_audit_logger() from public, anon, authenticated;

drop trigger if exists owned_planets_ownership_audit on public.owned_planets;
create trigger owned_planets_ownership_audit
  after insert or update of owner_id on public.owned_planets
  for each row
  execute function public.owned_planets_audit_logger();

-- ---------------------------------------------------------------------
-- 10. (findings 1 + 2) claim_home_planet — p_body_id REQUIRED + the FULL
--     STARTER_STRUCTURES grid. p_body_id drops its default (a null
--     argument raises a descriptive exception before any state is read).
--     structure_levels mirrors STARTER_STRUCTURES in
--     src/sim/player/grid.ts exactly: every StructureId present, housing 1,
--     all other structures 0 — the same grid onboarding grants a new
--     player and player.createPlayer writes. The reservation index (step 8)
--     is the atomic same-BODY backstop; the advisory lock serialises
--     same-NAME claimants (unchanged).
-- ---------------------------------------------------------------------
create or replace function public.claim_home_planet(
  p_planet_name   text,
  p_tier          smallint,
  p_distance_pc   double precision default null,
  p_massive_world boolean default false,
  p_dense_core    boolean default false,
  p_body_id       text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me               uuid := auth.uid();
  v_baseline       double precision;
  v_pop_cap_mult   double precision;
  v_planet         public.owned_planets%rowtype;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501';
  end if;

  if p_body_id is null or p_body_id = '' then
    raise exception 'body_id is required: a home claim must reference a canonical world body';
  end if;

  if p_tier not between 1 and 5 then
    raise exception 'tier must be between 1 and 5, got %', p_tier;
  end if;

  if p_distance_pc is not null and (p_distance_pc = 'NaN'::float8 or p_distance_pc = 'Infinity'::float8 or p_distance_pc = '-Infinity'::float8 or p_distance_pc < 0) then
    raise exception 'distance_pc must be null or a finite, non-negative number, got %', p_distance_pc;
  end if;

  -- Idempotent: already own a home -> return it (0003 step 2).
  select * into v_planet
    from public.owned_planets
   where owner_id = me and is_home
   limit 1;
  if found then
    return to_jsonb(v_planet);
  end if;

  -- Serialise same-NAME claimants (0003 layer 2); the full unique index
  -- on body_id (step 8) is the atomic same-BODY backstop.
  perform pg_advisory_xact_lock(hashtextextended(p_planet_name, 0));

  -- Re-check after acquiring the lock: second claimant sees it taken.
  if exists (
    select 1 from public.owned_planets where planet_name = p_planet_name
  ) then
    return jsonb_build_object('claimed', false, 'reason', 'planet_taken');
  end if;

  -- Player row is created on first claim (FK owner_id -> players requires it).
  insert into public.players (id)
  values (me)
  on conflict (id) do nothing;

  v_baseline     := 10 * p_tier;
  v_pop_cap_mult := case p_tier
                      when 1 then 1.0
                      when 2 then 1.2
                      when 3 then 1.4
                      when 4 then 1.7
                      when 5 then 2.0
                    end;

  insert into public.owned_planets (
    owner_id,
    planet_name,
    body_id,
    tier,
    baseline_income_per_sec,
    population_cap_multiplier,
    distance_pc,
    is_home,
    unconquerable,
    acquisition_method,
    massive_world,
    dense_core,
    population,
    garrison,
    fleet,
    structure_levels
  )
  values (
    me,
    p_planet_name,
    p_body_id,
    p_tier,
    v_baseline,
    v_pop_cap_mult,
    p_distance_pc,
    true,
    true,
    'home-assignment',
    p_massive_world,
    p_dense_core,
    1000,
    0,
    0,
    '{"oreMine":0,"tradeHub":0,"housing":1,"hydroponics":0,"barracks":0,"shipyard":0,"defenseTurret":0}'::jsonb
  )
  returning * into v_planet;

  return to_jsonb(v_planet);
end;
$$;

-- ---------------------------------------------------------------------
-- 11. (findings 1 + 2) claim_colony — p_body_id REQUIRED; starter grid
--     stays housing:0. Colonies start with NO starter structures — the
--     STARTER_STRUCTURES grant applies to the home world only (intended
--     distinction: starter resources are a home-assignment benefit, not a
--     colonisation benefit). structure_levels is the full zero grid, the
--     same shape player.createPlayer writes for a colony.
-- ---------------------------------------------------------------------
create or replace function public.claim_colony(
  p_planet_name   text,
  p_tier          smallint,
  p_distance_pc   double precision default null,
  p_massive_world boolean default false,
  p_dense_core    boolean default false,
  p_body_id       text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me               uuid := auth.uid();
  v_baseline       double precision;
  v_pop_cap_mult   double precision;
  v_planet         public.owned_planets%rowtype;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501';
  end if;

  if p_body_id is null or p_body_id = '' then
    raise exception 'body_id is required: a colony claim must reference a canonical world body';
  end if;

  if p_tier not between 1 and 5 then
    raise exception 'tier must be between 1 and 5, got %', p_tier;
  end if;

  if p_distance_pc is not null and (p_distance_pc = 'NaN'::float8 or p_distance_pc = 'Infinity'::float8 or p_distance_pc = '-Infinity'::float8 or p_distance_pc < 0) then
    raise exception 'distance_pc must be null or a finite, non-negative number, got %', p_distance_pc;
  end if;

  -- Colonise requires a claimed home planet (0003 audit).
  if not exists (
    select 1 from public.owned_planets where owner_id = me and is_home
  ) then
    raise exception 'no home planet — colonise requires a claimed home';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_planet_name, 0));

  if exists (
    select 1 from public.owned_planets where planet_name = p_planet_name
  ) then
    return jsonb_build_object('claimed', false, 'reason', 'planet_taken');
  end if;

  v_baseline     := 10 * p_tier;
  v_pop_cap_mult := case p_tier
                      when 1 then 1.0
                      when 2 then 1.2
                      when 3 then 1.4
                      when 4 then 1.7
                      when 5 then 2.0
                    end;

  insert into public.owned_planets (
    owner_id,
    planet_name,
    body_id,
    tier,
    baseline_income_per_sec,
    population_cap_multiplier,
    distance_pc,
    is_home,
    unconquerable,
    acquisition_method,
    massive_world,
    dense_core,
    population,
    garrison,
    fleet,
    structure_levels
  )
  values (
    me,
    p_planet_name,
    p_body_id,
    p_tier,
    v_baseline,
    v_pop_cap_mult,
    p_distance_pc,
    false,
    false,
    'colonisation',
    p_massive_world,
    p_dense_core,
    0,
    0,
    0,
    '{"oreMine":0,"tradeHub":0,"housing":0,"hydroponics":0,"barracks":0,"shipyard":0,"defenseTurret":0}'::jsonb
  )
  returning * into v_planet;

  return to_jsonb(v_planet);
end;
$$;

-- ---------------------------------------------------------------------
-- 12. (finding 3) Fortification resolver — resolve_attack, recreated from
--     the 0012 CREATE OR REPLACE (0005/0010/0011 layers beneath) with ONE
--     change: the conquest transfer now sets acquisition_method =
--     'conquest' alongside owner_id := v_winner. Every owner_id change in
--     the resolver is therefore tagged 'conquest', consistent with
--     transferOwnership/conquestTransfer (src/sim/player/ownership.ts +
--     src/sim/player/transfer.ts). The 0015/step-9 audit logger then
--     records body_id + method 'conquest' for the change of hands. ACLs
--     unchanged: resolve_attack stays INTERNAL (no client grant — invoked
--     only by resolve_due_attacks as function owner).
-- ---------------------------------------------------------------------
create or replace function public.resolve_attack(p_attack_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_attack          public.attacks%rowtype;
  v_target          public.owned_planets%rowtype;
  v_turret_level    int;
  v_eff_turret      double precision;
  v_dp              double precision;
  v_weariness       double precision;
  v_required_dp     double precision;
  v_ap              double precision;
  v_eff             double precision;
  v_member_ap       double precision;
  v_ratio           double precision;
  v_outcome         text;
  v_loss_pct        double precision;
  v_winner          uuid;
  v_taken           boolean := false;
  v_prev_owner      uuid;
  v_prev_pop        double precision;
  v_defender        jsonb;
  v_members         jsonb := '[]'::jsonb;
  v_row             record;
  v_report          jsonb;
  v_gar_cap_per_level double precision;
  v_garrison        double precision;
  v_fleet           double precision;
  v_grid            jsonb;
  v_survivors       double precision;
  v_barracks        int;
  v_gar_cap         double precision;
  -- game_config-sourced constants (D9/D4) — see header; missing keys RAISE.
  v_turret_per_level double precision;
  v_militia_per_pop  double precision;
  v_eff_cap          double precision;
  v_diminishing      double precision;
  v_pop_loss_repelled double precision;
  v_outcome_cfg      jsonb;
begin
  select *
    into v_attack
    from public.attacks
   where id = p_attack_id
   for update;
  if not found or v_attack.status <> 'inbound' then
    return null;  -- already resolved (or unknown) — idempotent no-op
  end if;

  select *
    into v_target
    from public.owned_planets
   where planet_name = v_attack.target_planet_name
   for update;

  v_prev_owner := v_target.owner_id;
  v_prev_pop   := v_target.population;

  -- Defense power (§5a): DP = turret_defense_power_per_level × effective
  -- turret levels + militia_defense_per_population × population, all from
  -- game_config (D4), then × massive_world_multiplier when the target has
  -- the massive_world quirk (D4, stored flag on owned_planets). Garrison
  -- does NOT contribute (B5/B2 LOCKED §5a formula — Option 1, garrison out
  -- of DP; the exposed window is flavour + the launch gate). DP stays FIXED
  -- vs attacker count (band-together §5b — more attackers never buffs the
  -- defender).
  v_turret_per_level := public.game_config_number('turret_defense_power_per_level');
  v_militia_per_pop  := public.game_config_number('militia_defense_per_population');
  v_eff_cap          := public.game_config_number('effective_level_cap');
  v_diminishing      := public.game_config_number('diminishing_returns_factor');
  v_turret_level     := coalesce((v_target.structure_levels->>'defenseTurret')::int, 0);
  v_eff_turret       := least(v_turret_level, v_eff_cap) + greatest(0, v_turret_level - v_eff_cap) * v_diminishing; -- effectiveLevel (half-after-10)
  v_dp               := v_turret_per_level * v_eff_turret + v_militia_per_pop * v_target.population;
  if v_target.massive_world then
    v_dp := v_dp * public.game_config_number('massive_world_multiplier');
  end if;

  -- Band-together combined AP vs the defender's FIXED, unchanged DP (§5a
  -- LOCKED), with PER-PLAYER war-weariness (B2/G3): each member's own
  -- 1.2^count(their prior in-window launches) deflates THEIR OWN
  -- contribution — soldiers × effectiveLevel(tier) / their weariness. A
  -- fresh joiner (0 own launches) contributes at full strength; a weary
  -- attacker (own conquests in the window) contributes at reduced strength.
  -- The launcher's stack no longer taxes the whole gang. The attack being
  -- resolved is excluded from each member's own count (first conquest of a
  -- window costs 1.0x — B1 semantics preserved per member).
  select coalesce(sum(
           m.soldiers_committed *
           (least(m.shipyard_tier, v_eff_cap) + greatest(0, m.shipyard_tier - v_eff_cap) * v_diminishing)
           / public.war_weariness_multiplier_for(m.player_id, p_attack_id)
         ), 0)
    into v_ap
    from public.attack_members m
   where m.attack_id = p_attack_id;

  -- Launcher's own stack — informational report field only. The ratio no
  -- longer multiplies required DP by it (that divisor moved into the
  -- per-member numerator above); kept for backward-compatible value with
  -- the applied 04 suite's solo weariness pins.
  v_weariness := public.war_weariness_multiplier_for(v_attack.launcher_id, p_attack_id);

  v_required_dp := greatest(v_dp, 0);
  if v_required_dp > 0 then
    v_ratio := v_ap / v_required_dp;
  elsif v_ap > 0 then
    v_ratio := 9999;
  else
    v_ratio := 0;
  end if;

  -- DESIGN §5a outcome table + attacker casualty %, read from game_config
  -- (outcome_ratios_and_losses — D9/D4), buckets in descending min_ratio.
  v_outcome_cfg := public.game_config_value('outcome_ratios_and_losses');
  if v_outcome_cfg is null then
    raise exception 'game_config key outcome_ratios_and_losses is missing';
  end if;
  if v_ratio >= (v_outcome_cfg->'decisive'->>'min_ratio')::double precision then
    v_outcome := 'decisive'; v_loss_pct := (v_outcome_cfg->'decisive'->>'attacker_loss')::double precision;
  elsif v_ratio >= (v_outcome_cfg->'pyrrhic'->>'min_ratio')::double precision then
    v_outcome := 'pyrrhic';  v_loss_pct := (v_outcome_cfg->'pyrrhic'->>'attacker_loss')::double precision;
  elsif v_ratio >= (v_outcome_cfg->'repelled'->>'min_ratio')::double precision then
    v_outcome := 'repelled'; v_loss_pct := (v_outcome_cfg->'repelled'->>'attacker_loss')::double precision;
  else
    v_outcome := 'crushed';  v_loss_pct := (v_outcome_cfg->'crushed'->>'attacker_loss')::double precision;
  end if;

  -- Winner = highest-committing member (§5 band-together: "cooperation with one winner").
  if v_outcome in ('decisive','pyrrhic') then
    select player_id
      into v_winner
      from public.attack_members
     where attack_id = p_attack_id
     order by soldiers_committed desc, joined_at asc, player_id asc
     limit 1;
    v_taken := true;
  end if;

  -- Per-member casualty record for the report. Member `ap` is the DEFLATED
  -- contribution (soldiers × effectiveLevel(tier) / the member's OWN
  -- weariness), so Σ members[].ap == combined_ap; `weariness` exposes each
  -- attacker's own stack (per-player model, B2/G3). `losses` = round
  -- (committed × loss_pct) is UNCHANGED — the casualty DEDUCTION is a state
  -- effect below, not a report-field change.
  for v_row in
    select m.player_id, m.soldiers_committed, m.shipyard_tier,
           public.war_weariness_multiplier_for(m.player_id, p_attack_id) as weariness
      from public.attack_members m
     where m.attack_id = p_attack_id
     order by m.joined_at, m.player_id
  loop
    v_eff       := least(v_row.shipyard_tier, v_eff_cap) + greatest(0, v_row.shipyard_tier - v_eff_cap) * v_diminishing;
    v_member_ap := v_row.soldiers_committed * v_eff / v_row.weariness;
    v_members := v_members || jsonb_build_object(
      'player_id', v_row.player_id,
      'soldiers_committed', v_row.soldiers_committed,
      'shipyard_tier', v_row.shipyard_tier,
      'weariness', round(v_row.weariness::numeric, 4),
      'ap', round(v_member_ap::numeric, 4),
      'losses', round(v_row.soldiers_committed * v_loss_pct)
    );
  end loop;

  -- Conquest transfer (DESIGN §5, §5a LOCKED): decisive/pyrrhic → owner_id :=
  -- winner, acquisition_method := 'conquest' (finding 3), grid minus
  -- defenseTurret, fresh-settlement population (P2-T04 D6), claimed_at :=
  -- now(). planet_name stays the same row (unique index intact).
  if v_taken then
    update public.owned_planets
       set owner_id                  = v_winner,
           acquisition_method        = 'conquest',
           is_home                   = false,
           unconquerable             = false,
           structure_levels          = structure_levels - 'defenseTurret',
           population                = 0,
           garrison                  = 0,
           fleet                     = 0,
           claimed_at                = now()
     where id = v_target.id;
  elsif v_outcome = 'repelled' then
    -- DESIGN §5a + audit B4: repelled → defender loses
    -- defender_pop_loss_repelled of population (0005 behaviour UNCHANGED).
    -- "some turrets" stays unspecified for v1 — turrets fully survive a
    -- repelled attack (repairs/re-fortification are the defender loop).
    v_pop_loss_repelled := public.game_config_number('defender_pop_loss_repelled');
    update public.owned_planets
       set population = population * (1 - v_pop_loss_repelled)
     where id = v_target.id;
  end if;

  -- Survivor return + fleet drain (P3-T05-B, B4/B5). See the header block.
  v_gar_cap_per_level := public.game_config_number('barracks_garrison_cap_per_level');
  for v_row in
    select m.player_id, m.soldiers_committed, m.source_planet_name
      from public.attack_members m
     where m.attack_id = p_attack_id
       and m.source_planet_name is not null
     order by m.player_id
  loop
    select garrison, fleet, structure_levels
      into v_garrison, v_fleet, v_grid
      from public.owned_planets
     where planet_name = v_row.source_planet_name
     for update;
    if found then
      v_survivors := v_row.soldiers_committed - round(v_row.soldiers_committed * v_loss_pct);
      v_barracks  := coalesce((v_grid->>'barracks')::int, 0);
      v_eff       := least(v_barracks, v_eff_cap) + greatest(0, v_barracks - v_eff_cap) * v_diminishing;
      v_gar_cap   := v_gar_cap_per_level * v_eff;
      update public.owned_planets
         set garrison = least(garrison + v_survivors, v_gar_cap),
             fleet    = greatest(fleet - v_row.soldiers_committed, 0)
       where planet_name = v_row.source_planet_name;
    end if;
  end loop;

  -- Defender summary (before/after) for the report.
  v_defender := jsonb_build_object(
    'player_id', v_prev_owner,
    'population_before', v_prev_pop,
    'population_after', case
      when v_taken then 0
      when v_outcome = 'repelled' then round(v_prev_pop * (1 - v_pop_loss_repelled))
      else round(v_prev_pop)
    end
  );

  v_report := jsonb_build_object(
    'attack_id', v_attack.id,
    'target_planet_name', v_attack.target_planet_name,
    'launched_at', v_attack.launched_at,
    'resolved_at', now(),
    'ratio', round(v_ratio::numeric, 4),
    'outcome', v_outcome,
    'combined_ap', round(v_ap::numeric, 4),
    'defense_power', round(v_dp::numeric, 2),
    'war_weariness_multiplier', round(v_weariness::numeric, 4),
    'planet_taken', v_taken,
    'winner_id', v_winner,
    'members', v_members,
    'defender', v_defender
  );

  update public.attacks
     set status       = 'resolved',
         outcome      = v_outcome,
         winner_id    = v_winner,
         resolved_at  = now(),
         defender_id  = v_prev_owner,
         attack_report = v_report
   where id = p_attack_id;

  -- Notifications (§5b v1 kinds).
  insert into public.notifications (player_id, kind, payload)
  values (
    v_prev_owner,
    'invasion_landed',
    jsonb_build_object('attack_id', v_attack.id, 'planet_name', v_attack.target_planet_name, 'actor_id', v_attack.launcher_id, 'outcome', v_outcome)
  );

  if v_taken then
    insert into public.notifications (player_id, kind, payload)
    values (
      v_prev_owner,
      'planet_fell',
      jsonb_build_object('attack_id', v_attack.id, 'planet_name', v_attack.target_planet_name, 'actor_id', v_winner, 'outcome', v_outcome)
    );
  end if;

  for v_row in
    select distinct m.player_id
      from public.attack_members m
     where m.attack_id = p_attack_id
  loop
    insert into public.notifications (player_id, kind, payload)
    values (
      v_row.player_id,
      'attack_result',
      jsonb_build_object('attack_id', v_attack.id, 'planet_name', v_attack.target_planet_name, 'outcome', v_outcome, 'planet_taken', v_taken)
    );
  end loop;

  return v_report;
end;
$$;

revoke all on function public.resolve_attack(uuid) from public, anon;
revoke execute on function public.resolve_attack(uuid) from authenticated;

-- =====================================================================
-- ROUND-4 COMPLETION (whole-phase audit round 4 — closes Phase 2)
-- Purpose   : (finding 2) owned_planets.body_id is now NOT NULL. The
--             round-2 column add (step 2 above) left body_id nullable and
--             the round-3 RPC replacements only enforce it per-call; a
--             nullable column lets a Postgres unique index admit multiple
--             NULL rows, and the audit table (ownership_audit.body_id) is
--             already NOT NULL. This section closes the gap AFTER the RPC
--             changes: every claim path now writes body_id, so the column
--             can be required at rest.
-- Backfill guard: this stack is WRITE-ONLY (no rows applied), so the ALTER
--             is a no-op on empty tables. An ALREADY-APPLIED stack with
--             legacy rows MUST backfill a canonical body id on every
--             owned_planets row (and de-duplicate body_ids) before this
--             ALTER runs, else SET NOT NULL fails loudly on the first NULL
--             row.
-- The full unique index on body_id (round-3 step 8) is UNCHANGED — it stays
--             the atomic reservation and, once the column is NOT NULL, it
--             becomes a true full-uniqueness constraint with no NULL escape.
-- Idempotent : YES — ALTER COLUMN ... SET NOT NULL is re-runnable (a second
--             run is a no-op once the column is already NOT NULL).
-- =====================================================================

alter table public.owned_planets
  alter column body_id set not null;
