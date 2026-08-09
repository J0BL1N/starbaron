-- =====================================================================
-- 0011_band_together (P3-T04-B)
-- Purpose   : Close the P3-T04 audit gaps G1-G4 (docs/P3_T04_A_AUDIT.md)
--             with the Jay-authorised defaults B1-B5/B7:
--               * B1/G1 — the window-vs-resolves_at race: join_attack's
--                 effective join window is CLAMPED to end at the EARLIER
--                 of (launched_at + join_window_seconds) and resolves_at.
--                 A join is accepted only while the attack is BOTH inbound
--                 AND before its clamped close — once resolves_at is
--                 reached the join is rejected even if the lazy resolver
--                 has not run yet (resolution no longer depends on when the
--                 lazy resolve happened to fire).
--               * B2/G3 — war-weariness is PER PLAYER (DESIGN §5b "per
--                 player per 24h"): each member's AP contribution is
--                 deflated by THAT member's own 1.2^count(their prior
--                 in-window launches) stack, NOT by a launcher-wide divisor
--                 on the combined total. A fresh joiner's soldiers count at
--                 full strength; a weary attacker's count at reduced
--                 strength. For a SOLO attacker the math is identical to
--                 the old launcher divisor (soldiers×tier/1.2^n ÷ DP ==
--                 soldiers×tier ÷ (DP×1.2^n)), so the applied 04 suite's
--                 solo pins are unchanged; the difference only shows for
--                 gangs.
--               * B3/G4 — join notifications: a new 'attack_joined' kind
--                 (the 0002 CHECK is ALTERed forward-only) is inserted by
--                 join_attack for the launcher + every existing member when
--                 a player commits.
--               * B4/G9 — minimum join commitment: join_attack rejects
--                 p_soldiers < 100 (implementation policy, tunable later;
--                 closes the free 1-soldier member-gate read entry).
--               * B2/G2 — window-state surfacing: get_attack returns
--                 join_window_open + window_closes_at (clamped close) for
--                 the attack payload. NO extension RPC (option (a) — closed
--                 mechanics for v1, the missing piece was visibility).
--             B6/B2 carry (loser casualty DEDUCTION) stays deferred to
--             P3-T05 — casualties remain report flavour only.
-- MECHANISM : three CREATE OR REPLACE functions (same signatures/returns,
--             so read RPCs + ACLs are untouched) + one ALTER CHECK.
--               * join_attack(uuid, double precision, text) — CREATE OR
--                 REPLACE with the clamp, the 100-soldier floor and the
--                 notification insert.
--               * resolve_attack(uuid) — CREATE OR REPLACE (0010 body +
--                 per-member weariness deflation; same report shape plus a
--                 per-member `weariness` field; combined_ap now reports the
--                 DEFLATED combined AP that drives the ratio).
--               * get_attack(uuid) — CREATE OR REPLACE (0008 body +
--                 join_window_open + window_closes_at).
--             READ RPCs (resolve_due_attacks / get_player_state /
--             get_galaxy) are NOT recreated: resolve_attack keeps its
--             signature and resolve_due_attacks invokes it by name; the
--             report shape only gains fields. ACLs persist through CREATE
--             OR REPLACE; resolve_attack's internal-execute revoke is
--             re-stated (0010 precedent).
-- Idempotent: NO for the migration (forward-only; the ALTER CHECK drop runs
--             once on staging). The FUNCTIONS are idempotent per call
--             (resolve no-ops on already-resolved; joins are validated).
-- Date      : 2026-08-09
-- Scope     : notifications CHECK + three recreated function bodies. No
--             tables, no schema, no new client grants. Tied to P3-T04-B;
--             the estimator's combinedAttackPower + the 05_band_together
--             suite + the estimator parity pins ship with it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. notifications.kind CHECK — add 'attack_joined' (B3/G4).
--    0002:24 created the CHECK inline (auto-named notifications_kind_check)
--    with only the five §5b kinds. join_attack now inserts an
--    'attack_joined' row (launcher + existing members get told who joined),
--    so the CHECK is re-created forward-only to admit the new kind. The
--    existing five kinds are preserved verbatim.
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('under_attack','invasion_landed','planet_fell','attack_result','revenge','attack_joined'));

-- ---------------------------------------------------------------------
-- 2. join_attack — B1/G1 window clamp, B4 min-join, B3 join notification.
--    Body identical to 0005 except:
--      * p_soldiers < 100 is rejected (B4 min join commitment);
--      * the window guard becomes now() >= least(launched_at + window,
--        resolves_at) — the effective close is the EARLIER of the 2h launch
--        window and the attack's travel arrival (G1);
--      * after the membership insert, an 'attack_joined' notification is
--        written for the launcher + every existing member (not the joiner).
--    CREATE OR REPLACE keeps the ACLs from 0005 (join_attack stays
--    EXECUTE → authenticated + service_role).
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

  -- B4 minimum join commitment (implementation policy, tunable later): a
  -- free 1-soldier join bought the member-gate read (full roster/report via
  -- get_attack) at zero cost. DESIGN §5b/§6 is silent; Jay authorised a
  -- 100-soldier floor. Launch (the launcher's own commitment) is unchanged.
  if p_soldiers < 100 then
    raise exception 'minimum join commitment is 100 soldiers, got %', p_soldiers;
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

  insert into public.attack_members (attack_id, player_id, soldiers_committed, shipyard_tier)
  values (p_attack_id, me, p_soldiers, v_shipyard);

  -- B3/G4 join notification: the launcher + every existing member (not the
  -- joiner — they know) are told who committed and how much. Kind added to
  -- the 0002 CHECK in this migration. SECURITY DEFINER bypasses the owner-
  -- scoped notifications RLS (rows are read via get_player_state).
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
-- 3. resolve_attack — B2/G3 per-player war-weariness.
--    Body identical to 0010 EXCEPT the weariness site:
--      * combined AP (0010:134-140) now divides EACH member's
--        soldiers × effectiveLevel(tier) by THAT member's OWN
--        war_weariness_multiplier_for(player_id, p_attack_id) — the
--        per-player 24h stack — instead of applying the launcher's single
--        divisor to the whole combined total.
--      * required DP is the plain defender DP: greatest(v_dp, 0). The old
--        `× v_weariness` on required DP is GONE — the weariness now lives
--        in the numerator per member.
--      * the report keeps war_weariness_multiplier = the LAUNCHER's stack
--        (informational, backwards-compatible for the applied 04 suite's
--        solo pins) and gains per-member `weariness` (each attacker's own
--        multiplier). combined_ap now reports the DEFLATED combined AP —
--        the number actually compared to the fixed DP.
--    Solo equivalence: soldiers×tier/1.2^n ÷ DP == soldiers×tier ÷
--    (DP×1.2^n), so every applied 04_conquest_math solo pin (ratios,
--    weariness 1.0/1.2/1.44/1.728, combined_ap, member ap/losses) holds
--    unchanged — the change only bites for gangs. Member `ap` is also
--    deflated so Σ members[].ap == combined_ap (internally consistent).
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
  -- does NOT contribute (B5, LOCKED §5a formula). DP stays FIXED vs attacker
  -- count (band-together §5b — more attackers never buffs the defender).
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
  -- (committed × loss_pct) is unchanged — casualties remain report flavour
  -- only (loser DEDUCTION deferred to P3-T05, audit B6/B2 carry).
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
-- 4. get_attack — B2/G2 window-state surfacing.
--    Body identical to 0008 except the response gains two fields:
--      * window_closes_at — the CLAMPED join close
--        least(launched_at + join_window_seconds, resolves_at), i.e. the
--        exact instant past which join_attack rejects (G1 semantics);
--      * join_window_open — boolean: the attack is inbound AND now() is
--        still before the clamped close. Scouts/joiners see whether a
--        forming attack is still joinable without a separate RPC.
--    Both fields are computed for every gate-passing caller (they are
--    attack-row-derived, not member-gated — inbound coordination is the
--    mechanic). No extension RPC (audit G2 option (a)).
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
-- ACL hygiene (TradieHubAU pattern; CREATE OR REPLACE preserves ACLs, but
-- the internal-execute status of resolve_attack is re-stated in case a
-- re-grant via default privileges could silently re-expose it — 0010
-- precedent). join_attack (authenticated + service_role) and get_attack
-- (authenticated + service_role) keep their grants from 0005/0008 through
-- the CREATE OR REPLACE; nothing new is granted to anon.
-- =====================================================================
revoke execute on function public.resolve_attack(uuid) from authenticated;
