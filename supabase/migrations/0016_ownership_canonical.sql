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
