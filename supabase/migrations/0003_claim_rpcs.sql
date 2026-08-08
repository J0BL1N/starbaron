-- =====================================================================
-- 0003_claim_rpcs
-- Purpose   : P3-T01-B claim/colonise RPCs — claim_home_planet() and
--             claim_colony(), the server-side arbiters of ownership.
--             Uniqueness enforced inside a transaction (advisory xact lock
--             keyed on the planet name, §3.3) + the unique index backstop.
--             Quirk trust model (D4): p_massive_world / p_dense_core are
--             client-provided from the deterministic quirk generator (D3);
--             the multiplier VALUES are enforced server-side from game_config
--             (massive_world in resolve, dense_core in P3-T05 accrual) — a
--             spoofed flag only mislabels a planet, it cannot inject a value.
--             Per-planet garrison validation/deployment is P3-T05 (deferred).
--             Caller-supplied p_distance_pc is validated BEFORE insertion
--             (null or finite + non-negative); the owned_planets CHECK in
--             0001 backstops the same rule at the table level, so a NaN/±∞
--             value can never persist into travel/cost math (audit finding).
-- Idempotent: NO for the migration itself (forward-only, runs once); the
--             FUNCTIONS are idempotent per call (re-claim returns the same
--             home planet, §4.1 step 2).
-- Date      : 2026-08-09
-- Scope     : SECURITY DEFINER + VOLATILE + SET search_path = public, pg_temp;
--             REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated,
--             service_role (TradieHubAU precedent).
-- =====================================================================

-- Empty structure grids mirror src/sim/player/grid.ts emptyStructureLevels()
-- over the LOCKED 7-structure roster (src/sim/structures/data.ts).

create or replace function public.claim_home_planet(
  p_planet_name   text,
  p_tier          smallint,
  p_distance_pc   double precision default null,
  p_massive_world boolean default false,
  p_dense_core    boolean default false
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
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  if p_tier not between 1 and 5 then
    raise exception 'tier must be between 1 and 5, got %', p_tier;
  end if;

  if p_distance_pc is not null and (not isfinite(p_distance_pc) or p_distance_pc < 0) then
    raise exception 'distance_pc must be null or a finite, non-negative number, got %', p_distance_pc;
  end if;

  -- Idempotent: already own a home → return it (§4.1 step 2).
  select *
    into v_planet
    from public.owned_planets
   where owner_id = me
     and is_home
   limit 1;
  if found then
    return to_jsonb(v_planet);
  end if;

  -- Serialise claimants of the same planet (§3.3 layer 2).
  perform pg_advisory_xact_lock(hashtextextended(p_planet_name, 0));

  -- Re-check after acquiring the lock: second claimant sees it taken (§3.3).
  if exists (
    select 1 from public.owned_planets where planet_name = p_planet_name
  ) then
    return jsonb_build_object('claimed', false, 'reason', 'planet_taken');
  end if;

  -- Player row is created on first claim (FK owner_id → players requires it).
  insert into public.players (id)
  values (me)
  on conflict (id) do nothing;

  -- Derived values re-computed server-side from tier + small constant map
  -- (audit §4.1 step 5): baselineIncomePerSec = 10 × tier (DESIGN §4d),
  -- populationCapMultiplier = tier table (DESIGN §4d).
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
    tier,
    baseline_income_per_sec,
    population_cap_multiplier,
    distance_pc,
    is_home,
    unconquerable,
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
    p_tier,
    v_baseline,
    v_pop_cap_mult,
    p_distance_pc,
    true,   -- is_home
    true,   -- unconquerable (DESIGN §5 "unconquerable home")
    p_massive_world,
    p_dense_core,
    1000,   -- STARTER_POPULATION (src/sim/player/wallet.ts)
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
  p_dense_core    boolean default false
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
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  if p_tier not between 1 and 5 then
    raise exception 'tier must be between 1 and 5, got %', p_tier;
  end if;

  if p_distance_pc is not null and (not isfinite(p_distance_pc) or p_distance_pc < 0) then
    raise exception 'distance_pc must be null or a finite, non-negative number, got %', p_distance_pc;
  end if;

  -- Colonise requires a claimed home planet (audit §4.2).
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
    tier,
    baseline_income_per_sec,
    population_cap_multiplier,
    distance_pc,
    is_home,
    unconquerable,
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
    p_tier,
    v_baseline,
    v_pop_cap_mult,
    p_distance_pc,
    false,  -- is_home
    false,  -- unconquerable (DESIGN §5 "any planet except your home planet can be taken")
    p_massive_world,
    p_dense_core,
    0,      -- fresh colony = empty, grows at base rate (P2-T04 D6)
    0,
    0,
    '{"oreMine":0,"tradeHub":0,"housing":0,"hydroponics":0,"barracks":0,"shipyard":0,"defenseTurret":0}'::jsonb
  )
  returning * into v_planet;

  return to_jsonb(v_planet);
end;
$$;

revoke all on function public.claim_home_planet(text, smallint, double precision, boolean, boolean) from public, anon;
revoke all on function public.claim_colony(text, smallint, double precision, boolean, boolean)     from public, anon;
grant execute on function public.claim_home_planet(text, smallint, double precision, boolean, boolean) to authenticated, service_role;
grant execute on function public.claim_colony(text, smallint, double precision, boolean, boolean)     to authenticated, service_role;
