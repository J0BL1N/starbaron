-- =====================================================================
-- 0008_attack_read_rpcs
-- Purpose   : P3-T02-B attack-flow READ side + the locked resolve fixes.
--             1. B1 — war-weariness off-by-one fix. VERIFIED: weariness is
--                applied at RESOLVE (0005:432-441 counts the launcher's
--                launches in the window INCLUDING the attack being resolved
--                -> first conquest already costs 1.2x). DESIGN §5a says the
--                "4th conquest in a day needs 1.8x" (= 1.2^3), so the 1st
--                must be 1.0x. Fix is forward-only: a NEW internal helper
--                war_weariness_multiplier_for(launcher, exclude_attack_id)
--                computes 1.2^count(PRIOR launches in window) and resolve_
--                attack is RE-CREATED to call it (exclude_attack_id = the
--                attack being resolved). CREATE OR REPLACE preserves the
--                ACLs from 0007 (resolve_attack stays non-client-executable)
--                and 0005 is NOT edited (applied). The same helper surfaces
--                the caller's CURRENT weariness to the read RPCs so the
--                client scout preview mirrors the server.
--             2. B4 — "some turrets" (§5a) is NOT implemented for v1. The
--                audit's B4 recommendation keeps the defence turrets fully
--                surviving a repelled attack because "some" is unspecified
--                in DESIGN; only population x 0.7 is applied (0005
--                behaviour). This migration makes no turret change on a
--                repelled outcome.
--             3. Read RPC set (B6): get_player_state(), get_galaxy(),
--                get_attack(uuid) — each calls resolve_due_attacks() lazily
--                on-read (§5.3 D5) then returns the gated rows. These are
--                the only client-facing additions; the resolve engine itself
--                is unchanged (D8 — server authoritative).
--             4. Correction round (Codex FAIL, data-leak + scope-creep):
--                a NEW attacks.defender_id column records the defender at
--                resolution time (0005's attacker rows have no defender
--                column). get_attack / get_player_state gate report access
--                on launcher / ORIGINAL defender / member ONLY — a
--                conqueror who took the planet AFTER an attack resolved is
--                neither and must NOT see that attack's report or row.
--                Conquerors of prior attacks are blocked; inbound attacks
--                keep the open band-together window.
--             B2 (garrison commitment deduction) is NOT enforced here: the
--             bounded migration scope covers the weariness fix + read RPCs,
--             and a garrison deduction would break the pinned 02_attack_rls
--             contract suite (launches seed garrison=0). Deferred to P3-T05
--             per the audit; the read RPCs return garrison/fleet + the
--             exposed-window data the client needs to RENDER the estimate.
--             B3 (everything survives except turrets) and B5 (garrison does
--             NOT add to DP) are already true in the applied 0005 resolve —
--             no code change needed, confirmed by inspection.
-- Idempotent: NO for the migration (forward-only: the ADD COLUMN runs once
--             on an empty-of-attacks schema); the read RPCs and the
--             weariness helper are idempotent per call (resolve_due_attacks
--             no-ops on already-resolved attacks).
-- Date      : 2026-08-09
-- Scope     : attacks.defender_id column + one internal helper + CREATE
--             OR REPLACE of resolve_attack (same signature, ACLs preserved)
--             + three client read RPCs.
--             EXECUTE grants: read RPCs -> authenticated, service_role;
--             internal helper -> revoked from public/anon/authenticated.
-- =====================================================================

-- ---------------------------------------------------------------------
-- war_weariness_multiplier_for(p_launcher_id, p_exclude_attack_id)  [B1]
--   INTERNAL. Returns 1.2^count(launches in the window), EXCLUDING
--   p_exclude_attack_id (the attack being resolved) so the FIRST conquest
--   of a 24h window costs 1.0x and the 4th costs 1.2^3 = 1.728x (§5a).
--   Called by resolve_attack with the attack id to exclude; called by the
--   read RPCs with NULL (all current launches) to show what a NEXT launch
--   would face. Mirrors the corrected count from 0005:436-441.
-- ---------------------------------------------------------------------
create or replace function public.war_weariness_multiplier_for(
  p_launcher_id      uuid,
  p_exclude_attack_id uuid default null
)
returns double precision
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_hours double precision;
  v_recent       bigint;
begin
  v_window_hours := public.game_config_number('war_weariness_window_hours');
  select count(*)
    into v_recent
    from public.attacks
   where launcher_id = p_launcher_id
     and (p_exclude_attack_id is null or id <> p_exclude_attack_id)
     and launched_at >= now() - (v_window_hours * interval '1 hour');
  return power(public.game_config_number('war_weariness_multiplier'), v_recent);
end;
$$;

-- ---------------------------------------------------------------------
-- attacks.defender_id — NEW column (correction round). Records the planet
--   owner at the moment an attack is RESOLVED (v_prev_owner), so the read
--   RPCs can gate on the ORIGINAL defender without parsing the report and
--   without leaking a prior attack to a later conqueror of the same planet.
--   Inbound attacks have NULL here until resolved; get_attack falls back to
--   the CURRENT owner for inbound (the defender is the current owner while
--   an attack is in flight — join-first blocks any handover mid-flight).
--   Column added here (forward-only) because 0004/0005 are applied.
-- ---------------------------------------------------------------------
alter table public.attacks
  add column defender_id uuid references public.players (id);

-- ---------------------------------------------------------------------
-- resolve_attack(p_attack_id)  — RE-CREATED (B1), same signature.
--   Body identical to 0005 except:
--     * weariness count now excludes the attack being resolved (B1) via
--       war_weariness_multiplier_for(launcher_id, p_attack_id);
--     * defender_id = v_prev_owner is recorded at resolution (correction
--       round) so the read RPCs can gate on the ORIGINAL defender;
--     * the repelled branch is UNCHANGED from 0005 (population x 0.7 only)
--       — "some turrets" is a v1 exclusion (audit B4), so no turret change.
--   CREATE OR REPLACE keeps the existing owner, ACLs (0007's authenticated
--   revoke persists — re-stated below as belt-and-braces) and the
--   function's dependent status; 0005 is not modified (applied).
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

-- ---------------------------------------------------------------------
-- get_player_state() — client read (B6). Lazily resolves due attacks on
--   read (§5.3 D5 — resolution ALWAYS runs; the report list is already
--   response-gated by resolve_due_attacks), then returns the caller's
--   wallet, owned planets (with defenses), MY attacks (launcher / ORIGINAL
--   defender via attacks.defender_id / member — inbound open-to-all
--   coordination is surfaced through get_galaxy, not here) and unread
--   notifications. A conqueror who took a planet after a prior attack
--   resolved is NOT the original defender and never sees that attack.
-- ---------------------------------------------------------------------
create or replace function public.get_player_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me         uuid := auth.uid();
  v_wallet   jsonb;
  v_planets  jsonb;
  v_attacks  jsonb;
  v_notifs   jsonb;
  v_resolved jsonb;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  -- Lazy on-read resolve (§5.3 D5). Side-effects always run; the response
  -- is gated to this caller by resolve_due_attacks' internal filter.
  v_resolved := public.resolve_due_attacks();

  select to_jsonb(p)
    into v_wallet
    from public.players p
   where p.id = me;

  select coalesce(jsonb_agg(to_jsonb(op) order by op.is_home desc, op.planet_name), '[]'::jsonb)
    into v_planets
    from public.owned_planets op
   where op.owner_id = me;

  -- SECURITY DEFINER bypasses RLS, so re-apply the attacks visibility gate
  -- manually: launcher / attack member / ORIGINAL defender (attacks.
  -- defender_id, recorded at resolution; report.defender as belt-and-braces)
  -- / the CURRENT owner of an INBOUND attack (the defender while an attack
  -- is in flight — join-first blocks any handover). A conqueror who took
  -- the planet AFTER a prior attack resolved is none of these and must NOT
  -- receive that prior attack's row or report (correction round). The row
  -- payload embeds attack_report, so only gated rows may carry it.
  select coalesce(jsonb_agg(to_jsonb(a) order by a.launched_at desc), '[]'::jsonb)
    into v_attacks
    from public.attacks a
   where a.launcher_id = me
      or a.defender_id = me
      or (a.attack_report is not null
          and (a.attack_report->'defender'->>'player_id')::uuid = me)
      or (a.status = 'inbound'
          and a.target_planet_name in (select op.planet_name from public.owned_planets op where op.owner_id = me))
      or exists (select 1 from public.attack_members m where m.attack_id = a.id and m.player_id = me);

  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
    into v_notifs
    from public.notifications n
   where n.player_id = me
     and n.read_at is null;

  return jsonb_build_object(
    'player_id', me,
    'wallet', v_wallet,
    'owned_planets', v_planets,
    'attacks', v_attacks,
    'unread_notifications', v_notifs,
    'resolved', coalesce(v_resolved, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- get_galaxy() — scout read (B6). Lazily resolves due attacks, then
--   returns every owned planet (planet_name, owner display_name, population,
--   garrison, fleet, turret_level from the grid, distance_pc, quirk flags,
--   inbound-attack overlay) + the caller's CURRENT weariness + the resolved
--   game_config PvP knobs so the client estimator mirrors the server
--   exactly (audit §2.3(a) — the client never reads game_config directly).
--   Distance note: the schema stores catalogue distance_pc (from Sol) on
--   owned_planets; there is NO inter-planet distance function in the schema
--   and 0005's travel uses the TARGET's distance_pc directly (0005:204).
--   get_galaxy therefore returns each planet's distance_pc — the same value
--   the server charges — as the scout distance.
-- ---------------------------------------------------------------------
create or replace function public.get_galaxy()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me          uuid := auth.uid();
  v_resolved  jsonb;
  v_planets   jsonb;
  v_weariness double precision;
  v_pvp       jsonb;
begin
  if me is null then
    raise exception 'authenticated caller required' using errcode = '42501'; -- insufficient_privilege
  end if;

  v_resolved := public.resolve_due_attacks();

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'planet_name', op.planet_name,
             'owner_id', op.owner_id,
             'display_name', coalesce(pl.display_name, ''),
             'tier', op.tier,
             'population', op.population,
             'garrison', op.garrison,
             'fleet', op.fleet,
             'turret_level', coalesce((op.structure_levels->>'defenseTurret')::int, 0),
             'distance_pc', op.distance_pc,
             'massive_world', op.massive_world,
             'unconquerable', op.unconquerable,
             'inbound_attacks', (
               select coalesce(jsonb_agg(
                        jsonb_build_object(
                          'attack_id', a.id,
                          'launcher_id', a.launcher_id,
                          'resolves_at', a.resolves_at
                        )
                      ), '[]'::jsonb)
                 from public.attacks a
                where a.target_planet_name = op.planet_name
                  and a.status = 'inbound'
             )
           ) order by op.planet_name),
         '[]'::jsonb)
    into v_planets
    from public.owned_planets op
    left join public.players pl on pl.id = op.owner_id;

  -- Weariness a NEW launch by this caller would face (all current launches
  -- counted — mirrors the corrected B1 semantics).
  v_weariness := public.war_weariness_multiplier_for(me);

  -- Resolved PvP knobs (audit §2.3(a)): the estimator mirrors these exactly;
  -- missing keys RAISE loudly (drift is loud by design).
  v_pvp := jsonb_build_object(
    'travel_minutes_per_pc',        public.game_config_number('travel_minutes_per_pc'),
    'travel_floor_seconds',         public.game_config_number('travel_floor_seconds'),
    'travel_cap_seconds',           public.game_config_number('travel_cap_seconds'),
    'join_window_seconds',          public.game_config_number('join_window_seconds'),
    'launch_cost_base_credits',     public.game_config_number('launch_cost_base_credits'),
    'launch_cost_per_fleet_credits',public.game_config_number('launch_cost_per_fleet_credits'),
    'launch_cost_per_pc_credits',   public.game_config_number('launch_cost_per_pc_credits'),
    'war_weariness_multiplier',     public.game_config_number('war_weariness_multiplier'),
    'war_weariness_window_hours',   public.game_config_number('war_weariness_window_hours'),
    'new_player_shield_days',       public.game_config_number('new_player_shield_days'),
    'defender_pop_loss_repelled',   public.game_config_number('defender_pop_loss_repelled'),
    'turret_defense_power_per_level', public.game_config_number('turret_defense_power_per_level'),
    'militia_defense_per_population', public.game_config_number('militia_defense_per_population'),
    'effective_level_cap',          public.game_config_number('effective_level_cap'),
    'diminishing_returns_factor',   public.game_config_number('diminishing_returns_factor'),
    'massive_world_multiplier',     public.game_config_number('massive_world_multiplier'),
    'outcome_ratios_and_losses',    public.game_config_value('outcome_ratios_and_losses')
  );

  return jsonb_build_object(
    'current_player_id', me,
    'planets', v_planets,
    'my_weariness', v_weariness,
    'pvp', v_pvp,
    'resolved', coalesce(v_resolved, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- get_attack(p_attack_id) — single-attack read (B6). Lazily resolves due
--   attacks first, then returns the attack + member roster + report when
--   the caller is the launcher / the ORIGINAL defender (the owner at
--   resolution, stored on the attack row as attacks.defender_id — never
--   the current owner, so a conqueror who took the planet AFTER resolution
--   cannot read a prior attack's report; correction round) / a member.
--   Inbound attacks are visible to all authenticated (band-together) but
--   the roster + report stay restricted to launcher / original defender /
--   member. Returns {found:false} for unknown attacks or callers outside
--   the gates.
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
    'report', v_report
  );
end;
$$;

-- =====================================================================
-- ACL hygiene (TradieHubAU pattern, consistent with 0005/0007)
--   client-facing read RPCs -> authenticated + service_role.
--   internal helper -> no client EXECUTE (revoked from authenticated;
--   resolve_attack's authenticated revoke from 0007 re-stated in case a
--   drop/recreate re-grants via default privileges).
-- =====================================================================
revoke all on function public.war_weariness_multiplier_for(uuid, uuid) from public, anon;
revoke execute on function public.war_weariness_multiplier_for(uuid, uuid) from authenticated;

revoke all on function public.get_player_state() from public, anon;
revoke all on function public.get_galaxy()       from public, anon;
revoke all on function public.get_attack(uuid)   from public, anon;

grant execute on function public.get_player_state() to authenticated, service_role;
grant execute on function public.get_galaxy()       to authenticated, service_role;
grant execute on function public.get_attack(uuid)   to authenticated, service_role;

-- resolve_attack stays INTERNAL (0007 intent re-stated — a CREATE OR REPLACE
-- preserves ACLs, but a re-grant via default privileges is guarded loudly).
revoke execute on function public.resolve_attack(uuid) from authenticated;
