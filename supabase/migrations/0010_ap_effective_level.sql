-- =====================================================================
-- 0010_ap_effective_level (P3-T03-B, D1)
-- Purpose   : Align the ATTACKER POWER (AP) computation to effectiveLevel,
--             matching the defender-side turret DP exactly (audit D1 ruling).
--             resolve_attack() previously computed
--               AP = sum(soldiers_committed × shipyard_tier)      [RAW tier]
--             while DP already applied effectiveLevel to the turret level
--             server-side (0008:182, `least(level,cap) + greatest(0,level−cap)
--             × diminishing`). With the half-after-10 convention, a tier-15
--             shipyard contributed 15× to AP while a level-15 turret only
--             defended as 12.5 effective levels — the ratio silently inflated
--             past level 10. D1 ruling (authorised default, applied here):
--             AP = sum(soldiers_committed × effectiveLevel(shipyard_tier)),
--             so both sides of the ratio diminish past level 10
--             (tier 15 → effective 12.5; tier 3 → effective 3, unchanged).
--             DESIGN §5a is literal ("× Shipyard tier"); effectiveLevel is
--             the P2 whole-phase convention for structure levels and the
--             audit's D1 found the raw tier inconsistent with the turret
--             side — the client estimator mirrors this change in the same
--             task (src/sim/player/estimator.ts).
-- DECISION — where to apply it (audit task step 1): the shipyard tier is
--             SNAPSHOTTED at launch/join from the source planet's grid
--             (0005:143/305, raw `smallint` 0..100 CHECK on attack_members,
--             launch-time snapshot — an in-flight upgrade does not raise AP).
--             The snapshot STAYS the raw grid value; effectiveLevel is
--             applied at COMPUTATION time inside resolve_attack (both the
--             combined AP sum and each per-member report `ap`), exactly as
--             the turret DP applies effectiveLevel from the raw level at
--             resolve. No schema change, no snapshot-column change — the
--             table CHECK and the launch/join guards are untouched.
-- MECHANISM : CREATE OR REPLACE of public.resolve_attack(uuid) — same
--             signature and return type (jsonb), so resolve_due_attacks()
--             (which invokes it by name as the function owner) is untouched
--             and no ACL breaks. The authenticated/anon EXECUTE revokes
--             from 0007/0008 persist through a CREATE OR REPLACE; the
--             internal-execute revoke is re-stated below (belt-and-braces,
--             0008 precedent). 0005/0008 are APPLIED and NOT edited.
--             Body identical to 0008's resolve_attack except the TWO AP
--             sites (combined sum + member report `ap`) which now apply
--             least(tier,cap) + greatest(0,tier−cap) × diminishing using the
--             SAME game_config-sourced v_eff_cap / v_diminishing the turret
--             DP already reads — a missing key RAISES loudly as before.
-- Idempotent: NO for the migration (forward-only; the CREATE OR REPLACE
--             runs once on staging). The FUNCTION is idempotent per call
--             (already-resolved → no-op, unchanged).
-- Date      : 2026-08-09
-- Scope     : ONE recreated function body (public.resolve_attack(uuid)).
--             No tables, no schema, no new grants. Tied to the D1 AP
--             alignment; the estimator + 04_conquest_math suite + parity
--             pins in tests/backend-estimator.test.ts ship with it.
-- =====================================================================

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
  -- does NOT contribute (B5, LOCKED §5a formula).
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

  -- War-weariness at resolve-time (D11, §5.2, B1 FIX): each PRIOR launch in
  -- the window inflates the REQUIRED force by war_weariness_multiplier
  -- (committed force unchanged). The attack being resolved is EXCLUDED so
  -- the first conquest costs 1.0x (§5a "4th conquest needs 1.8x" = 1.2^3).
  v_weariness := public.war_weariness_multiplier_for(v_attack.launcher_id, p_attack_id);

  -- Band-together: combined AP vs the defender's FIXED, unchanged DP (§5a
  -- LOCKED). P3-T03-B D1: each member's shipyard tier contributes as its
  -- EFFECTIVE level (half-after-10) — the same effectiveLevel the turret
  -- side applies — so AP and DP both diminish past the cap. The snapshot
  -- column keeps the RAW grid tier (launch-time); the effect is applied
  -- here at computation time.
  select coalesce(sum(
           m.soldiers_committed *
           (least(m.shipyard_tier, v_eff_cap) + greatest(0, m.shipyard_tier - v_eff_cap) * v_diminishing)
         ), 0)
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

  -- Per-member casualty record (AP + losses) for the report. Member `ap`
  -- mirrors the combined AP: effectiveLevel of the member's snapshotted
  -- shipyard tier (P3-T03-B D1).
  for v_row in
    select m.player_id, m.soldiers_committed, m.shipyard_tier,
           (m.soldiers_committed *
             (least(m.shipyard_tier, v_eff_cap) + greatest(0, m.shipyard_tier - v_eff_cap) * v_diminishing)) as ap,
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
    -- DESIGN §5a + audit B4: repelled → defender loses
    -- defender_pop_loss_repelled of population (0005 behaviour UNCHANGED).
    -- "some turrets" stays unspecified for v1 — turrets fully survive a
    -- repelled attack (repairs/re-fortification are the defender loop).
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

-- Belt-and-braces (0008 precedent): CREATE OR REPLACE preserves the 0007/0008
-- revokes, but the internal-execute status is re-stated so a re-grant via
-- default privileges can never silently re-expose the internal resolver.
revoke execute on function public.resolve_attack(uuid) from authenticated;
