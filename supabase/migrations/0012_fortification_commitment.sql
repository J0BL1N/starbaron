-- =====================================================================
-- 0012_fortification_commitment (P3-T05-B)
-- Purpose   : Close the P3-T05-A audit's B1/B4/B5/B6/B7 surface
--             (docs/P3_T05_A_AUDIT.md §5.2) with the Jay-authorised
--             decisions (B1-B7 LOCKED — do not revisit):
--               * B1 — a server build/upgrade RPC chain. build_structure()
--                 writes structure_levels into owned_planets.structure_levels
--                 under FOR UPDATE (structure grids were previously frozen at
--                 claim — the fortify loop was client-only), charges the
--                 cost curve (credits base × 1.15^level + FLAT alloy, B6),
--                 and applies the barracks garrison conversion (accrual
--                 semantics, garrison cap 5,000 × effectiveLevel) so garrison
--                 can actually grow server-side — the soldier-commitment
--                 guards are dead otherwise.
--               * B2 — garrison stays OUT of DP (LOCKED §5a formula
--                 untouched; the exposed window is flavour + launch gate).
--                 NO change to the resolver DP path or the estimator.
--               * B4 — UNIFORM casualty reading: per-member loss_pct applies
--                 to every member (winner included). At resolve, survivors =
--                 committed − round(committed × loss_pct) return to the
--                 member's source garrison; fleet −= committed. The report
--                 `losses` field is unchanged.
--               * B5 — survivor return is clamped to the garrison cap
--                 (5,000 × effectiveLevel(barracks)) and returns to the
--                 source planet UNCONDITIONALLY even if it changed owner
--                 mid-flight (planet_name is the same row through conquest).
--               * B6 — alloy cost stays FLAT (1,000/level for defenseTurret);
--                 documented in structure_alloy_costs, not escalated.
--               * B7 — get_attack's roster gains per-member `weariness`
--                 (each member's own 1.2^n stack, NULL-exclude semantics =
--                 what a NEXT launch faces, matching get_galaxy.my_weariness).
--             At LAUNCH/JOIN (B1 carry from the audit §3.a): under a source
--             FOR UPDATE (0005/0011 only SELECT the source — no lock — and
--             never mutate it), garrison -= p_soldiers, fleet += p_soldiers
--             with two guards — p_soldiers <= garrison ('insufficient
--             garrison') and fleet + p_soldiers <= fleetCap ('fleet cap
--             exceeded'), fleetCap = shipyard_fleet_cap_per_level (1,000) ×
--             effectiveLevel(shipyard) (DESIGN §4d).
-- MECHANISM : ONE new column + THREE new/replaced game_config keys + five
--             function bodies:
--               * attack_members.source_planet_name (NEW, nullable — backfill
--                 impossible since 0004 applied) so the resolver can return
--                 survivors; stored in BOTH launch_attack and join_attack
--                 inserts going forward.
--               * build_structure(text, text) — NEW client-facing RPC.
--               * launch_attack(text, double precision, text) — CREATE OR
--                 REPLACE (0005 body + source lock + garrison/fleet guards +
--                 deduction + source_planet_name in the INSERT).
--               * join_attack(uuid, double precision, text) — CREATE OR
--                 REPLACE (0011 body + the same source-side guards).
--               * resolve_attack(uuid) — CREATE OR REPLACE (0011 body +
--                 survivor-return/fleet-drain loop on fresh source FOR UPDATE
--                 rows, after the conquest transfer which resets the TARGET
--                 only).
--               * get_attack(uuid) — CREATE OR REPLACE (0011 body + per-member
--                 roster `weariness`).
--             READ RPCs resolve_due_attacks / get_player_state / get_galaxy
--             are NOT recreated (resolve_attack keeps its signature; the
--             report shape only gains no top-level fields).
-- RLS       : adding the column does NOT widen visibility — attack_members
--             stays owner-scoped (auth.uid() = player_id, 0004:96-99) and the
--             resolver stays SECURITY DEFINER. Rows the client can read are
--             still only its own membership rows (which carry its own source
--             planet). No policy change needed; stated as belt-and-braces.
-- Idempotent: NO for the migration (forward-only; the ADD COLUMN runs once on
--             staging). The FUNCTIONS are idempotent per call (resolve no-ops
--             on already-resolved; launches/joins are validated; build_structure
--             is a per-call costed write).
-- Date      : 2026-08-09
-- Scope     : 1 column, 3 config keys, 5 recreated/created function bodies.
--             No tables dropped, no signatures changed. Tied to P3-T05-B; the
--             estimator canDeploy/survivor mirrors + the 06_fortification
--             suite + re-seeded 02/04/05 ship with it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. game_config seeds (B1/B6): the structure cost curve. Tunables-as-data
--    (D9) — values mirror src/sim/core/economy.ts (COST_GROWTH_PER_LEVEL
--    1.15) + src/sim/structures/data.ts (base costs; alloyCost 1,000 FLAT on
--    defenseTurret only — B6 documented, not escalated). build_structure
--    reads these so a missing key RAISES loudly (drift is loud by design).
-- ---------------------------------------------------------------------
insert into public.game_config (key, value) values
  ('structure_cost_growth_per_level', '1.15'::jsonb),
  ('structure_base_costs',
   '{"oreMine":500,"tradeHub":2000,"housing":300,"hydroponics":800,"barracks":1500,"shipyard":5000,"defenseTurret":2000}'::jsonb),
  ('structure_alloy_costs',
   '{"oreMine":0,"tradeHub":0,"housing":0,"hydroponics":0,"barracks":0,"shipyard":0,"defenseTurret":1000}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. attack_members.source_planet_name — NEW column (audit §3.d). The
--    resolver needs each member's source planet to return survivors.
--    NULLABLE: 0004 applied, backfill is impossible — launch_attack /
--    join_attack store p_source_planet_name forward; the resolver skips
--    NULL source rows (legacy members predate the model and never left a
--    tracked garrison). FK on the UNIQUE planet_name (0001:55); the name
--    stays the same row through conquest transfers (B5 unconditional
--    return). RLS untouched (owner-scoped rows — see header).
-- ---------------------------------------------------------------------
alter table public.attack_members
  add column source_planet_name text references public.owned_planets (planet_name);

-- ---------------------------------------------------------------------
-- 2. build_structure(p_planet_name, p_structure_id) — NEW (B1).
--    Server build/upgrade RPC: validates ownership, computes the next-level
--    cost (credits base × 1.15^level + FLAT alloy cost, B6), checks the
--    shared wallet (credits + alloys), deducts, and writes the grid under
--    FOR UPDATE. For 'barracks' it applies the accrual.ts garrison
--    conversion (one-second semantics; garrison cap 5,000 × effectiveLevel)
--    so garrison can grow server-side — a full server accrual loop is a
--    follow-up, this is the v1 bridge that makes the commitment guards live.
-- ---------------------------------------------------------------------
create or replace function public.build_structure(
  p_planet_name  text,
  p_structure_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me            uuid := auth.uid();
  v_planet      public.owned_planets%rowtype;
  v_level       int;
  v_roster      text[];
  v_base_costs  jsonb;
  v_alloy_costs jsonb;
  v_growth      double precision;
  v_cost        double precision;
  v_alloy_cost  double precision;
  v_credits     double precision;
  v_alloys      double precision;
  v_eff_cap     double precision;
  v_diminishing double precision;
  v_eff         double precision;
  v_gar_cap     double precision;
  v_conversion  double precision;
  v_converted   double precision;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  v_roster := array['oreMine','tradeHub','housing','hydroponics','barracks','shipyard','defenseTurret'];
  if not (p_structure_id = any(v_roster)) then
    raise exception 'unknown structure id: %', p_structure_id;
  end if;

  -- Lock the planet row and validate ownership (source of truth for the grid).
  select *
    into v_planet
    from public.owned_planets
   where planet_name = p_planet_name
     and owner_id = me
   for update;
  if not found then
    raise exception 'planet % does not exist or is not owned by the caller', p_planet_name;
  end if;

  v_level   := coalesce((v_planet.structure_levels->>p_structure_id)::int, 0);
  v_growth  := public.game_config_number('structure_cost_growth_per_level');
  v_base_costs  := public.game_config_value('structure_base_costs');
  v_alloy_costs := public.game_config_value('structure_alloy_costs');
  if v_base_costs is null or (v_base_costs->>p_structure_id) is null then
    raise exception 'game_config key structure_base_costs is missing %', p_structure_id;
  end if;
  v_cost       := (v_base_costs->>p_structure_id)::double precision * power(v_growth, v_level);
  v_alloy_cost := coalesce((v_alloy_costs->>p_structure_id)::double precision, 0);

  -- Shared empire wallet (credits + alloys) under lock.
  select credits, alloys
    into v_credits, v_alloys
    from public.players
   where id = me
   for update;
  if not found then
    raise exception 'player row missing — claim a home planet first';
  end if;
  if v_credits < v_cost or v_alloys < v_alloy_cost then
    raise exception 'insufficient funds: need % cr and % alloys, have % cr and % alloys', v_cost, v_alloy_cost, v_credits, v_alloys;
  end if;
  update public.players set credits = credits - v_cost, alloys = alloys - v_alloy_cost where id = me;

  -- Write the grid (the fortify loop is now server-authoritative).
  update public.owned_planets
     set structure_levels = jsonb_set(structure_levels, array[p_structure_id], to_jsonb(v_level + 1))
   where id = v_planet.id;

  -- Barracks garrison conversion (B1, accrual.ts semantics): one accrual tick
  -- converting population -> garrison up to the NEW cap (5,000 ×
  -- effectiveLevel(barracks)), the same min(rate, cap−garrison, population)
  -- shape accruePlanet uses (accrual.ts:129-136). This is the v1 server-side
  -- garrison growth path; a full accrual loop is the follow-up.
  if p_structure_id = 'barracks' then
    v_eff_cap     := public.game_config_number('effective_level_cap');
    v_diminishing := public.game_config_number('diminishing_returns_factor');
    v_eff         := least(v_level + 1, v_eff_cap) + greatest(0, v_level + 1 - v_eff_cap) * v_diminishing;
    v_gar_cap     := public.game_config_number('barracks_garrison_cap_per_level') * v_eff;
    v_conversion  := public.game_config_number('barracks_conversion_per_sec') * v_eff;
    v_converted   := least(v_conversion, greatest(0, v_gar_cap - v_planet.garrison), v_planet.population);
    update public.owned_planets
       set garrison   = garrison + v_converted,
           population = population - v_converted
     where id = v_planet.id;
  end if;

  return to_jsonb((select p from public.owned_planets p where p.id = v_planet.id));
end;
$$;

-- ---------------------------------------------------------------------
-- 3. launch_attack — CREATE OR REPLACE (0005 body + B1 commitment). Source
--    planet is now SELECTed FOR UPDATE (0005:143-150 only read it), its
--    garrison/fleet are read under the lock, and after the credits check the
--    two guards fire and the deployment is recorded (garrison −= soldiers,
--    fleet += soldiers). Guards run AFTER the credits check so a paid launch
--    is never half-done; a raised guard aborts the whole transaction (the
--    credits deduction rolls back with it).
-- ---------------------------------------------------------------------
create or replace function public.launch_attack(
  p_target_planet_name text,
  p_soldiers           double precision,
  p_source_planet_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me               uuid := auth.uid();
  v_target         public.owned_planets%rowtype;
  v_source_id      bigint;
  v_credits        double precision;
  v_distance_pc    double precision;
  v_travel         int;
  v_cost           double precision;
  v_shipyard       smallint;
  v_garrison       double precision;
  v_fleet          double precision;
  v_fleet_cap      double precision;
  v_attack_id      uuid;
  v_travel_minutes double precision;
  v_floor_seconds  double precision;
  v_cap_seconds    double precision;
  v_cost_base      double precision;
  v_cost_per_fleet double precision;
  v_cost_per_pc    double precision;
  v_join_window    int;
  v_shield_days    double precision;
  v_eff_cap        double precision;
  v_diminishing    double precision;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  if p_soldiers is null or p_soldiers = 'NaN'::float8 or p_soldiers = 'Infinity'::float8 or p_soldiers = '-Infinity'::float8 or p_soldiers <= 0 then
    raise exception 'soldiers must be a finite, positive number, got %', p_soldiers;
  end if;

  -- Source planet must exist and belong to the caller; snapshot the REAL
  -- shipyard tier from its grid (§5a) and lock the row for the P3-T05
  -- garrison/fleet deployment (the source was only SELECTed before).
  select id, coalesce((structure_levels->>'shipyard')::smallint, 0), garrison, fleet
    into v_source_id, v_shipyard, v_garrison, v_fleet
    from public.owned_planets
   where planet_name = p_source_planet_name
     and owner_id = me
   for update;
  if not found then
    raise exception 'source planet % does not exist or is not owned by the caller', p_source_planet_name;
  end if;

  -- FOR UPDATE on the target row (§3.3): serialize concurrent launches at one planet.
  select *
    into v_target
    from public.owned_planets
   where planet_name = p_target_planet_name
   for update;
  if not found then
    raise exception 'unknown planet: %', p_target_planet_name;
  end if;

  -- Anti-grief (DESIGN §6): unconquerable home planets cannot be attacked.
  if v_target.unconquerable then
    raise exception 'target planet is unconquerable: %', p_target_planet_name;
  end if;
  if v_target.owner_id = me then
    raise exception 'cannot attack your own planet: %', p_target_planet_name;
  end if;

  -- New-player shield: derived from players.created_at + N days (D10, §5.2),
  -- N from game_config (new_player_shield_days).
  v_shield_days := public.game_config_number('new_player_shield_days');
  if exists (
    select 1
      from public.players p
     where p.id = v_target.owner_id
       and p.created_at + (v_shield_days * interval '1 day') > now()
  ) then
    raise exception 'target is protected by the new-player shield (%)', v_shield_days;
  end if;

  -- Join-first semantics (documented in the header): after the lock, an
  -- existing inbound attack on this target must be JOINED, not re-launched.
  if exists (
    select 1
      from public.attacks
     where target_planet_name = p_target_planet_name
       and status = 'inbound'
  ) then
    return jsonb_build_object(
      'launched', false,
      'reason', 'attack_in_flight',
      'join_attack_id', (select id
                           from public.attacks
                          where target_planet_name = p_target_planet_name
                            and status = 'inbound'
                          order by launched_at
                          limit 1)
    );
  end if;

  -- Travel time (§5.2): distancePc × travel_minutes_per_pc × 60s, floor
  -- travel_floor_seconds, cap travel_cap_seconds — all from game_config (D9).
  v_distance_pc     := coalesce(v_target.distance_pc, 0);
  v_travel_minutes  := public.game_config_number('travel_minutes_per_pc');
  v_floor_seconds   := public.game_config_number('travel_floor_seconds');
  v_cap_seconds     := public.game_config_number('travel_cap_seconds');
  v_travel          := least(greatest(round(v_distance_pc * v_travel_minutes * 60), v_floor_seconds), v_cap_seconds)::int;

  -- Launch cost (§5.2): base + soldiers × per-fleet + distancePc × per-pc,
  -- all from game_config (D9). Alloy cost = 0.
  v_cost_base      := public.game_config_number('launch_cost_base_credits');
  v_cost_per_fleet := public.game_config_number('launch_cost_per_fleet_credits');
  v_cost_per_pc    := public.game_config_number('launch_cost_per_pc_credits');
  v_cost           := v_cost_base + p_soldiers * v_cost_per_fleet + v_distance_pc * v_cost_per_pc;

  -- Fleet-pool deployment guards (P3-T05-B §3.a, B1): the committed soldiers
  -- LEAVE the source garrison and DEPLOY into its fleet (fleet = the deployed
  -- pool, DESIGN §4a/§4d). Guards run BEFORE the credits deduction so a paid
  -- launch is never half-done; a raised guard aborts the whole transaction.
  if p_soldiers > v_garrison then
    raise exception 'insufficient garrison: need %, have %', p_soldiers, v_garrison;
  end if;
  v_eff_cap     := public.game_config_number('effective_level_cap');
  v_diminishing := public.game_config_number('diminishing_returns_factor');
  v_fleet_cap   := public.game_config_number('shipyard_fleet_cap_per_level')
                   * (least(v_shipyard, v_eff_cap) + greatest(0, v_shipyard - v_eff_cap) * v_diminishing);
  if v_fleet + p_soldiers > v_fleet_cap then
    raise exception 'fleet cap exceeded: need %, cap %', v_fleet + p_soldiers, v_fleet_cap;
  end if;

  select credits
    into v_credits
    from public.players
   where id = me
   for update;
  if not found then
    raise exception 'player row missing — claim a home planet first';
  end if;
  if v_credits < v_cost then
    raise exception 'insufficient credits: need %, have %', v_cost, v_credits;
  end if;
  update public.players set credits = credits - v_cost where id = me;

  -- Deployment: garrison → fleet (the exposed window is flavour + this gate).
  update public.owned_planets
     set garrison = garrison - p_soldiers,
         fleet    = fleet + p_soldiers
   where id = v_source_id;

  -- Join window from game_config (D9 / D11): the launcher's own window.
  v_join_window := public.game_config_number('join_window_seconds')::int;

  insert into public.attacks (
    target_planet_name,
    launcher_id,
    travel_seconds,
    resolves_at,
    join_window_seconds
  )
  values (
    p_target_planet_name,
    me,
    v_travel,
    now() + (v_travel * interval '1 second'),
    v_join_window  -- DESIGN §5 "launch window (e.g. 2h)"; the launcher's own window (D11)
  )
  returning id into v_attack_id;

  insert into public.attack_members (attack_id, player_id, soldiers_committed, shipyard_tier, source_planet_name)
  values (v_attack_id, me, p_soldiers, v_shipyard, p_source_planet_name);

  insert into public.notifications (player_id, kind, payload)
  values (
    v_target.owner_id,
    'under_attack',
    jsonb_build_object(
      'attack_id', v_attack_id,
      'planet_name', p_target_planet_name,
      'actor_id', me,
      'resolves_at', now() + (v_travel * interval '1 second')
    )
  );

  return to_jsonb(
    (select a from public.attacks a where a.id = v_attack_id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 4. join_attack — CREATE OR REPLACE (0011 body + the same B1 source-side
--    deployment). Source planet locked FOR UPDATE (0011:123-130 only read
--    it); guards + deduction run after the membership/window checks, before
--    the member INSERT. The join notification fan-out (B3/G4) is unchanged.
-- ---------------------------------------------------------------------
create or replace function public.join_attack(
  p_attack_id          uuid,
  p_soldiers           double precision,
  p_source_planet_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me          uuid := auth.uid();
  v_attack    public.attacks%rowtype;
  v_window    int;
  v_shipyard  smallint;
  v_source_id bigint;
  v_garrison  double precision;
  v_fleet     double precision;
  v_fleet_cap double precision;
  v_eff_cap   double precision;
  v_diminishing double precision;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  if p_soldiers is null or p_soldiers = 'NaN'::float8 or p_soldiers = 'Infinity'::float8 or p_soldiers = '-Infinity'::float8 or p_soldiers <= 0 then
    raise exception 'soldiers must be a finite, positive number, got %', p_soldiers;
  end if;

  -- B4 minimum join commitment (implementation policy, tunable later): a
  -- free 1-soldier join bought the member-gate read (full roster/report via
  -- get_attack) at zero cost. DESIGN §5b/§6 is silent; Jay authorised a
  -- 100-soldier floor. Launch (the launcher's own commitment) is unchanged.
  if p_soldiers < 100 then
    raise exception 'minimum join commitment is 100 soldiers, got %', p_soldiers;
  end if;

  -- Source planet must exist and belong to the caller; snapshot the REAL
  -- shipyard tier from its grid (§5a) and lock the row for the P3-T05
  -- garrison/fleet deployment (the source was only SELECTed before).
  select id, coalesce((structure_levels->>'shipyard')::smallint, 0), garrison, fleet
    into v_source_id, v_shipyard, v_garrison, v_fleet
    from public.owned_planets
   where planet_name = p_source_planet_name
     and owner_id = me
   for update;
  if not found then
    raise exception 'source planet % does not exist or is not owned by the caller', p_source_planet_name;
  end if;

  select *
    into v_attack
    from public.attacks
   where id = p_attack_id
   for update;
  if not found then
    raise exception 'unknown attack: %', p_attack_id;
  end if;

  if v_attack.status <> 'inbound' then
    raise exception 'attack is not open for joining (status: %)', v_attack.status;
  end if;

  -- B1/G1 window clamp: the effective join window ends at the EARLIER of
  -- (launched_at + join_window_seconds) and resolves_at. least() =
  -- min(launch + window, launch + travel) because resolves_at =
  -- launched_at + travel_seconds. A join lands only while the attack is
  -- BOTH inbound AND before its clamped close — once resolves_at is
  -- reached (the lazy resolver may not have run yet) no join is accepted,
  -- so late joiners can never change a due attack's outcome. `>=` closes
  -- the window exactly AT the boundary (the previous check used `>` and
  -- could accept a join landing exactly on the close).
  v_window := v_attack.join_window_seconds;
  if now() >= least(v_attack.launched_at + (v_window * interval '1 second'), v_attack.resolves_at) then
    raise exception 'join window closed';
  end if;

  -- The target owner cannot join an attack on their own planet.
  if exists (
    select 1 from public.owned_planets
     where planet_name = v_attack.target_planet_name and owner_id = me
  ) then
    raise exception 'cannot join an attack on your own planet';
  end if;

  if exists (
    select 1 from public.attack_members where attack_id = p_attack_id and player_id = me
  ) then
    raise exception 'already a member of this attack';
  end if;

  -- Fleet-pool deployment guards (P3-T05-B §3.a): same two gates as launch.
  if p_soldiers > v_garrison then
    raise exception 'insufficient garrison: need %, have %', p_soldiers, v_garrison;
  end if;
  v_eff_cap     := public.game_config_number('effective_level_cap');
  v_diminishing := public.game_config_number('diminishing_returns_factor');
  v_fleet_cap   := public.game_config_number('shipyard_fleet_cap_per_level')
                   * (least(v_shipyard, v_eff_cap) + greatest(0, v_shipyard - v_eff_cap) * v_diminishing);
  if v_fleet + p_soldiers > v_fleet_cap then
    raise exception 'fleet cap exceeded: need %, cap %', v_fleet + p_soldiers, v_fleet_cap;
  end if;

  -- Deployment: garrison → fleet.
  update public.owned_planets
     set garrison = garrison - p_soldiers,
         fleet    = fleet + p_soldiers
   where id = v_source_id;

  insert into public.attack_members (attack_id, player_id, soldiers_committed, shipyard_tier, source_planet_name)
  values (p_attack_id, me, p_soldiers, v_shipyard, p_source_planet_name);

  -- B3/G4 join notification: the launcher + every existing member (not the
  -- joiner — they know) are told who committed and how much. Kind added to
  -- the 0002 CHECK by 0011. SECURITY DEFINER bypasses the owner- scoped
  -- notifications RLS (rows are read via get_player_state).
  insert into public.notifications (player_id, kind, payload)
  select n.player_id,
         'attack_joined',
         jsonb_build_object(
           'attack_id', p_attack_id,
           'planet_name', v_attack.target_planet_name,
           'actor_id', me,
           'soldiers', p_soldiers
         )
    from public.attack_members n
   where n.attack_id = p_attack_id
     and n.player_id <> me;

  return to_jsonb(
    (select a from public.attacks a where a.id = p_attack_id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 5. resolve_attack — CREATE OR REPLACE (0011 body + B4 survivor return /
--    fleet drain). Body identical to 0011 EXCEPT a new survivor-return loop
--    placed AFTER the conquest transfer / repelled population update:
--      * per member, UNIFORM casualty reading (B4): the one v_loss_pct the
--        whole attacker side applied (DESIGN §5a table) applies to EVERY
--        member — winner included. survivors = committed − round(committed ×
--        loss_pct) return to the member's SOURCE planet garrison, clamped to
--        the barracks garrison cap (5,000 × effectiveLevel(barracks), B5);
--        fleet −= committed (the deployed pool drains: lost + returned).
--      * fresh FOR UPDATE on the SOURCE rows — the conquest reset above
--        touches the TARGET row only (garrison/fleet/pop = 0, 0011:388-389),
--        so there is no ordering conflict.
--      * B5 unconditional return: the source planet may have changed owner
--        mid-flight; survivors still land on that planet_name row.
--      * legacy members with NULL source_planet_name are skipped (they never
--        left a tracked garrison).
--    The report `losses` field (round(committed × loss_pct)) is UNCHANGED —
--    the deduction is a state effect, not a report-field change.
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
  -- winner, grid minus defenseTurret, fresh-settlement population (P2-T04 D6),
  -- claimed_at := now(). planet_name stays the same row (unique index intact).
  if v_taken then
    update public.owned_planets
       set owner_id                  = v_winner,
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

-- ---------------------------------------------------------------------
-- 6. get_attack — CREATE OR REPLACE (0011 body + B7 per-member roster
--    weariness). The roster JSON gains each member's OWN current
--    war_weariness_multiplier_for(player_id, NULL) — the 1.2^n stack a NEXT
--    launch of theirs would face (NULL exclude = all current launches,
--    matching get_galaxy.my_weariness semantics), so a joiner can preview
--    how a weary gang-mate drags the combined AP down. Full-gate only, like
--    the rest of the roster.
-- ---------------------------------------------------------------------
create or replace function public.get_attack(p_attack_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me              uuid := auth.uid();
  v_attack        public.attacks%rowtype;
  v_members       jsonb;
  v_report        jsonb;
  v_current_owner uuid;
  v_original_owner uuid;
  v_gate          boolean;
  v_full_gate     boolean;
  v_window_closes_at timestamptz;
  v_join_open     boolean;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  -- Lazy on-read resolve (§5.3 D5): a due attack resolves before it is read.
  perform public.resolve_due_attacks();

  select *
    into v_attack
    from public.attacks
   where id = p_attack_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Original defender: recorded on the attack row at resolution
  -- (attacks.defender_id). Belt-and-braces: for a row without the column
  -- value (inbound, or a legacy resolved row) fall back to the report's
  -- defender.player_id, then — inbound only — the current owner (the
  -- defender while an attack is in flight; join-first blocks any handover).
  select owner_id
    into v_current_owner
    from public.owned_planets
   where planet_name = v_attack.target_planet_name;
  v_original_owner := v_attack.defender_id;
  if v_original_owner is null and v_attack.attack_report is not null then
    v_original_owner := (v_attack.attack_report->'defender'->>'player_id')::uuid;
  end if;
  if v_original_owner is null then
    v_original_owner := v_current_owner;
  end if;

  -- Clamped join close (G1): least(launched_at + window, resolves_at) —
  -- the exact boundary join_attack enforces. join_window_open = inbound AND
  -- still before the close.
  v_window_closes_at := least(
    v_attack.launched_at + (v_attack.join_window_seconds * interval '1 second'),
    v_attack.resolves_at
  );
  v_join_open := v_attack.status = 'inbound' and now() < v_window_closes_at;

  -- Visibility gate: launcher, original defender, member, or any
  -- authenticated when the attack is still inbound (band-together).
  v_gate := v_attack.launcher_id = me
            or v_original_owner = me
            or v_attack.status = 'inbound'
            or exists (select 1 from public.attack_members m
                        where m.attack_id = p_attack_id and m.player_id = me);
  if not v_gate then
    return jsonb_build_object('found', false);
  end if;

  -- Full detail (roster + report) is restricted to launcher / ORIGINAL
  -- defender / member — the same set resolve_due_attacks gates on. A
  -- current owner who is not the original defender stays outside.
  v_full_gate := v_attack.launcher_id = me
                 or v_original_owner = me
                 or exists (select 1 from public.attack_members m
                             where m.attack_id = p_attack_id and m.player_id = me);
  if v_full_gate then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'player_id', m.player_id,
               'soldiers_committed', m.soldiers_committed,
               'shipyard_tier', m.shipyard_tier,
               'weariness', round(public.war_weariness_multiplier_for(m.player_id, null)::numeric, 4),
               'joined_at', m.joined_at
             ) order by m.joined_at, m.player_id),
           '[]'::jsonb)
      into v_members
      from public.attack_members m
     where m.attack_id = p_attack_id;
    v_report := v_attack.attack_report;
  else
    v_members := '[]'::jsonb;
    v_report := null;
  end if;

  -- 'attack' mirrors the row; the embedded attack_report is stripped for
  -- non-full-gated callers (belt-and-braces — the report travels only via
  -- the gated 'report' field).
  return jsonb_build_object(
    'found', true,
    'attack', case when v_full_gate then to_jsonb(v_attack)
                   else (to_jsonb(v_attack) - 'attack_report') end,
    'members', v_members,
    'report', v_report,
    'join_window_open', v_join_open,
    'window_closes_at', v_window_closes_at
  );
end;
$$;

-- =====================================================================
-- ACL hygiene (TradieHubAU pattern). build_structure is a NEW client-facing
-- RPC -> authenticated + service_role. launch/join/get_attack keep their
-- grants through CREATE OR REPLACE (0005/0008/0011); resolve_attack stays
-- INTERNAL — its authenticated revoke is re-stated in case a re-grant via
-- default privileges could silently re-expose it (0007/0010 precedent). The
-- config accessors stay non-client-executable.
-- =====================================================================
revoke all on function public.build_structure(text, text)                 from public, anon;
revoke execute on function public.resolve_attack(uuid)                    from authenticated;
revoke execute on function public.game_config_value(text)                 from authenticated;
revoke execute on function public.game_config_number(text)                from authenticated;

grant execute on function public.build_structure(text, text)              to authenticated, service_role;
grant execute on function public.launch_attack(text, double precision, text) to authenticated, service_role;
grant execute on function public.join_attack(uuid, double precision, text)   to authenticated, service_role;
grant execute on function public.get_attack(uuid)                         to authenticated, service_role;
