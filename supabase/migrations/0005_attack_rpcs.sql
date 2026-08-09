-- =====================================================================
-- 0005_attack_rpcs
-- Purpose   : P3-T01-B attack lifecycle RPCs — launch_attack(), join_attack()
--             and the lazy resolve engine resolve_due_attacks() /
--             resolve_attack() (DB function + lazy on-read, §5.3 D5).
--             Implements the §5.2 server checks (travel time, launch cost),
--             the DESIGN §5a outcome table + casualties, band-together
--             (combined AP vs the defender's FIXED, unchanged DP), war-
--             weariness at resolve-time (D11), conquest transfer (turrets
--             destroyed, §5 line 129 LOCKED) and §5b notifications.
--             All draft tunables (travel, cost, join window, shield,
--             weariness, DP coefficients, effectiveLevel, outcome table,
--             quirk multipliers) are read from game_config (D9/D4) — a
--             missing key RAISES so drift against the 0006 seed is loud.
--             Garrison validation/deployment is DEFERRED to P3-T05 (the
--             schema stores garrison; this migration does NOT enforce it).
--             Source-planet semantics: launch/join validate that the source
--             planet belongs to the caller and snapshot the REAL shipyard
--             tier from its grid (the soldier source is fleet-deployed at
--             P3-T05); an invalid source planet is rejected, never 0.
--             Concurrent-launch semantics (§3.3): a launch takes FOR UPDATE
--             on the target planet row, serialising competing launches; if an
--             inbound attack on that target already exists after the lock,
--             the launcher is REJECTED with attack_in_flight and must JOIN the
--             existing attack (band-together IS the mechanic, DESIGN §5).
-- Idempotent: NO for the migration (forward-only, runs once); resolve
--             functions are idempotent per call (already-resolved → no-op).
-- Date      : 2026-08-09
-- Scope     : SECURITY DEFINER + VOLATILE + SET search_path = public, pg_temp;
--             REVOKE ALL FROM PUBLIC, anon. GRANT EXECUTE TO authenticated,
--             service_role for the three client-facing entry points
--             (launch_attack / join_attack / resolve_due_attacks) ONLY —
--             resolve_attack is INTERNAL (invoked by resolve_due_attacks as
--             the function owner); it is not granted to any client role, has
--             no auth guard and must never resolve an inbound attack on
--             demand (TradieHubAU precedent + audit finding).
--             Response gating (audit finding): resolve_due_attacks RESOLVES
--             every due attack regardless of the caller — the resolution
--             side-effects are never skipped — but appends an attack's
--             report to its jsonb response ONLY when the invoking user is
--             that attack's launcher, its ORIGINAL target owner, or one of
--             its attack members; service_role (no uid, reads every result)
--             always receives the full report list. An authenticated caller
--             therefore cannot read another player's resolve report through
--             the lazy-resolve path; the resolved-attack RLS policy on
--             attacks remains the only visible window.
-- =====================================================================

-- ---------------------------------------------------------------------
-- game_config accessors (SECURITY DEFINER; not client-exposed).
--   game_config_value(key)  → the jsonb value or NULL when missing.
--   game_config_number(key) → validated double precision; RAISES on a
--                             missing or non-numeric key so a deleted seed
--                             breaks loudly instead of silently drifting.
-- ---------------------------------------------------------------------
create or replace function public.game_config_value(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select value from public.game_config where key = p_key
$$;

create or replace function public.game_config_number(p_key text)
returns double precision
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
begin
  v_value := public.game_config_value(p_key);
  if v_value is null then
    raise exception 'game_config key % is missing', p_key;
  end if;
  if jsonb_typeof(v_value) <> 'number' then
    raise exception 'game_config key % is not numeric: %', p_key, v_value;
  end if;
  return (v_value)::text::double precision;
end;
$$;

revoke all on function public.game_config_value(text)   from public, anon, authenticated;
revoke all on function public.game_config_number(text)  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- launch_attack(p_target_planet_name, p_soldiers, p_source_planet_name)
--   - rejects unconquerable (home) and new-player-shielded targets (anti-grief §6)
--   - serialises concurrent launches at one target: FOR UPDATE on the target
--     row, then join-first semantics — an existing inbound attack on the same
--     target is returned as attack_in_flight and MUST be joined (§5 band-together)
--   - computes travel_seconds from game_config (travel_minutes_per_pc,
--     travel_floor_seconds, travel_cap_seconds) (§5.2 / D9)
--   - deducts the launch cost from game_config (launch_cost_base_credits,
--     launch_cost_per_fleet_credits, launch_cost_per_pc_credits) (§5.2 / D9)
--   - validates the source planet belongs to the caller and snapshots its
--     REAL shipyard tier from the grid (§5a) — no silent tier-0 fallback
--   - notifies the target owner ('under_attack', §5b)
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
  v_credits        double precision;
  v_distance_pc    double precision;
  v_travel         int;
  v_cost           double precision;
  v_shipyard       smallint;
  v_attack_id      uuid;
  v_travel_minutes double precision;
  v_floor_seconds  double precision;
  v_cap_seconds    double precision;
  v_cost_base      double precision;
  v_cost_per_fleet double precision;
  v_cost_per_pc    double precision;
  v_join_window    int;
  v_shield_days    double precision;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  if p_soldiers is null or p_soldiers = 'NaN'::float8 or p_soldiers = 'Infinity'::float8 or p_soldiers = '-Infinity'::float8 or p_soldiers <= 0 then
    raise exception 'soldiers must be a finite, positive number, got %', p_soldiers;
  end if;

  -- Source planet must exist and belong to the caller; snapshot the REAL
  -- shipyard tier from its grid (§5a). Fleet-pool deduction is P3-T05.
  select coalesce((structure_levels->>'shipyard')::smallint, 0)
    into v_shipyard
    from public.owned_planets
   where planet_name = p_source_planet_name
     and owner_id = me;
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

  insert into public.attack_members (attack_id, player_id, soldiers_committed, shipyard_tier)
  values (v_attack_id, me, p_soldiers, v_shipyard);

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
-- join_attack(p_attack_id, p_soldiers, p_source_planet_name)
--   - band-together (DESIGN §5): joins a forming attack within the launch
--     window (2h from launched_at, regardless of travel — D11)
--   - rejects the target owner (cannot attack your own planet)
--   - validates the source planet belongs to the caller and snapshots its
--     REAL shipyard tier from the grid (§5a) — no silent tier-0 fallback
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
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  if p_soldiers is null or p_soldiers = 'NaN'::float8 or p_soldiers = 'Infinity'::float8 or p_soldiers = '-Infinity'::float8 or p_soldiers <= 0 then
    raise exception 'soldiers must be a finite, positive number, got %', p_soldiers;
  end if;

  -- Source planet must exist and belong to the caller; snapshot the REAL
  -- shipyard tier from its grid (§5a). Fleet-pool deduction is P3-T05.
  select coalesce((structure_levels->>'shipyard')::smallint, 0)
    into v_shipyard
    from public.owned_planets
   where planet_name = p_source_planet_name
     and owner_id = me;
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

  -- Join window: 2h from launched_at regardless of travel (D11).
  v_window := v_attack.join_window_seconds;
  if now() > v_attack.launched_at + (v_window * interval '1 second') then
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

  insert into public.attack_members (attack_id, player_id, soldiers_committed, shipyard_tier)
  values (p_attack_id, me, p_soldiers, v_shipyard);

  return to_jsonb(
    (select a from public.attacks a where a.id = p_attack_id)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- resolve_attack(p_attack_id)  — internal, idempotent, lock-safe (§3.3, §5.3)
--   One transaction: outcome → casualties → planet transfer → notifications
--   → report → status='resolved'. A racing resolver re-reads 'resolved' and
--   applies no changes.
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
  v_recent          bigint;
  v_weariness       double precision;
  v_required_dp     double precision;
  v_ap              double precision;
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
  -- game_config-sourced constants (D9/D4) — see header; missing keys RAISE.
  v_turret_per_level double precision;
  v_militia_per_pop  double precision;
  v_eff_cap          double precision;
  v_diminishing      double precision;
  v_pop_loss_repelled double precision;
  v_window_hours     double precision;
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
  -- the massive_world quirk (D4, stored flag on owned_planets).
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

  -- War-weariness at resolve-time (D11, §5.2): each launch within the
  -- configurable window (war_weariness_window_hours) inflates the REQUIRED
  -- force by war_weariness_multiplier (committed force unchanged).
  v_window_hours := public.game_config_number('war_weariness_window_hours');
  select count(*)
    into v_recent
    from public.attacks
   where launcher_id = v_attack.launcher_id
     and launched_at >= now() - (v_window_hours * interval '1 hour');
  v_weariness := power(public.game_config_number('war_weariness_multiplier'), v_recent);

  -- Band-together: combined AP vs the defender's FIXED, unchanged DP (§5a LOCKED).
  select coalesce(sum(m.soldiers_committed * m.shipyard_tier), 0)
    into v_ap
    from public.attack_members m
   where m.attack_id = p_attack_id;

  v_required_dp := greatest(v_dp, 0) * v_weariness;
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

  -- Per-member casualty record (AP + losses) for the report.
  for v_row in
    select m.player_id, m.soldiers_committed, m.shipyard_tier,
           (m.soldiers_committed * m.shipyard_tier) as ap,
           (m.soldiers_committed * v_loss_pct) as losses
      from public.attack_members m
     where m.attack_id = p_attack_id
     order by m.joined_at, m.player_id
  loop
    v_members := v_members || jsonb_build_object(
      'player_id', v_row.player_id,
      'soldiers_committed', v_row.soldiers_committed,
      'shipyard_tier', v_row.shipyard_tier,
      'ap', v_row.ap,
      'losses', round(v_row.losses)
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
    -- DESIGN §5a: repelled → defender loses defender_pop_loss_repelled of
    -- population (game_config, D9).
    v_pop_loss_repelled := public.game_config_number('defender_pop_loss_repelled');
    update public.owned_planets
       set population = population * (1 - v_pop_loss_repelled)
     where id = v_target.id;
  end if;

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
    'combined_ap', v_ap,
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
-- resolve_due_attacks() — lazy on-read (§5.3 D5): resolves every inbound
--   attack past resolves_at. Invoked at the top of read RPCs / login sync.
--   Resolves ALL due attacks (resolution side-effects are never skipped),
--   but response-gates each report to the launcher / the ORIGINAL target
--   owner / an attack member; service_role receives every report (see the
--   header for the audit-finding rationale).
-- ---------------------------------------------------------------------
create or replace function public.resolve_due_attacks()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me           uuid := auth.uid();
  v_row        record;
  v_prev_owner uuid;
  v_include    boolean;
  v_result     jsonb;
  v_results    jsonb := '[]'::jsonb;
begin
  for v_row in
    select a.id, a.launcher_id, a.target_planet_name
      from public.attacks a
     where a.status = 'inbound'
       and a.resolves_at <= now()
     order by a.resolves_at
     for update
  loop
    -- Capture the ORIGINAL target owner BEFORE resolution — conquest
    -- transfers the row to the winner, so gating on the post-resolve owner
    -- would leak the report to the conqueror and hide it from the defender.
    select owner_id
      into v_prev_owner
      from public.owned_planets
     where planet_name = v_row.target_planet_name;

    v_result := public.resolve_attack(v_row.id);
    if v_result is not null then
      -- Response gating: only the launcher, the original target owner, an
      -- attack member, or service_role (no uid, receives everything) sees
      -- this report. Resolution ALWAYS runs — only the RESPONSE is filtered.
      v_include := auth.role() = 'service_role'
                   or v_row.launcher_id = me
                   or v_prev_owner = me
                   or exists (
                     select 1
                       from public.attack_members m
                      where m.attack_id = v_row.id
                        and m.player_id = me
                   );
      if v_include then
        v_results := v_results || jsonb_build_array(v_result);
      end if;
    end if;
  end loop;
  return v_results;
end;
$$;

revoke all on function public.launch_attack(text, double precision, text)            from public, anon;
revoke all on function public.join_attack(uuid, double precision, text)               from public, anon;
revoke all on function public.resolve_attack(uuid)                                    from public, anon;
revoke all on function public.resolve_due_attacks()                                   from public, anon;
grant execute on function public.launch_attack(text, double precision, text)          to authenticated, service_role;
grant execute on function public.join_attack(uuid, double precision, text)             to authenticated, service_role;
-- resolve_attack is INTERNAL: no EXECUTE grant to authenticated or service_role —
-- only resolve_due_attacks() (which passes due attacks, resolves_at <= now()) may
-- invoke it, as the function owner. A client can never resolve an inbound attack
-- on demand (audit finding).
grant execute on function public.resolve_due_attacks()                                 to authenticated, service_role;
-- The authenticated EXECUTE grant above resolves every due attack (side-effects
-- always run), but the function's internal response gating returns reports only
-- to the launcher / original target owner / attack member (see the header) —
-- service_role receives the full list.
