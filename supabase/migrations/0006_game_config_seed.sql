-- =====================================================================
-- 0006_game_config_seed
-- Purpose   : P3-T01-B game_config seed — the draft PvP tunables (DESIGN
--             §5a, §5.2; D9) AND the small combat-balance constants the
--             server needs for authoritative resolve math (D4): turret/DP
--             coefficients, effectiveLevel half-after-10, massiveWorld/
--             denseCore multipliers, tier pop-cap table, base structure
--             effects. Values mirror src/sim/** so client previews and
--             server resolve agree (tests/balance-drift.test.ts, -C).
--             The game_config TABLE + RLS live in 0002_meta_tables (0005's
--             SQL-language functions are validated at creation and need the
--             table to already exist); this file is seed DATA only.
-- Idempotent: YES — every INSERT is guarded with ON CONFLICT DO NOTHING,
--             so re-running the file does not error (data-level idempotency).
-- Date      : 2026-08-09
-- Scope     : D9 tunables + D4 balance constants seed. No catalogue seed
--             (D3). No DDL.
-- =====================================================================

-- game_config (table + RLS) is created in 0002_meta_tables; this file only
-- seeds it — tunables live as DATA, not migrations (§5.2, D9).

-- =====================================================================
-- Seed: draft PvP tunables (DESIGN §5a table, §5.2; D9 — Jay audits at
-- playtest, values live as data).
-- =====================================================================
insert into public.game_config (key, value) values
  ('travel_minutes_per_pc',        '1'::jsonb),       -- travel = distancePc × 1 min (§5.2)
  ('travel_floor_seconds',         '600'::jsonb),     -- floor 10 min (§5.2)
  ('travel_cap_seconds',           '172800'::jsonb),  -- cap 48h (§5.2)
  ('join_window_seconds',          '7200'::jsonb),    -- launch window 2h (§5, D11)
  ('launch_cost_base_credits',     '200'::jsonb),     -- 200 cr + fleet×0.2 + pc×10 (§5.2)
  ('launch_cost_per_fleet_credits','0.2'::jsonb),
  ('launch_cost_per_pc_credits',   '10'::jsonb),
  ('war_weariness_multiplier',     '1.2'::jsonb),     -- +20% required force per 24h conquest (§5a)
  ('war_weariness_window_hours',   '24'::jsonb),
  ('new_player_shield_days',       '3'::jsonb),       -- derived shield from players.created_at (D10)
  ('defender_pop_loss_repelled',   '0.3'::jsonb)      -- repelled → defender loses 30% population (§5a)
on conflict (key) do nothing;

-- =====================================================================
-- Seed: D4 combat-balance constants (server-authoritative resolve math,
-- mirrored from src/sim/** — see audit §5.3, D4 + §8 drift test).
-- =====================================================================
insert into public.game_config (key, value) values
  -- DP coefficients (src/sim/structures/effects.ts)
  ('turret_defense_power_per_level', '500'::jsonb),
  ('militia_defense_per_population', '0.15'::jsonb),
  -- effectiveLevel half-after-10 (src/sim/planets/levels.ts)
  ('effective_level_cap',            '10'::jsonb),
  ('diminishing_returns_factor',     '0.5'::jsonb),
  -- combat-relevant quirk multipliers (src/sim/planets/quirks.ts)
  ('massive_world_multiplier',       '1.1'::jsonb),   -- DP ×1.1 (defenseTurret quirk)
  ('dense_core_multiplier',          '1.1'::jsonb),   -- housing pop-cap bonus ×1.1
  -- population core (src/sim/core/population.ts)
  ('base_population_cap',            '5000'::jsonb),
  ('housing_cap_multiplier',         '0.2'::jsonb),
  ('base_growth_per_sec',            '2'::jsonb),
  ('housing_growth_per_level',       '2'::jsonb),
  ('hydroponics_growth_bonus',       '0.5'::jsonb),
  -- structure base effects (src/sim/structures/effects.ts + data.ts)
  ('ore_alloys_per_min',             '5'::jsonb),
  ('trade_hub_income_multiplier_per_level', '0.1'::jsonb),
  ('barracks_conversion_per_sec',    '10'::jsonb),
  ('barracks_garrison_cap_per_level','5000'::jsonb),
  ('shipyard_fleet_cap_per_level',   '1000'::jsonb),
  ('shipyard_income_per_min',        '50'::jsonb),
  -- tier pop-cap table (src/sim/planets/levels.ts §4d)
  ('tier_pop_cap_multiplier', '{"1":1.0,"2":1.2,"3":1.4,"4":1.7,"5":2.0}'::jsonb),
  -- baseline income (src/sim/core/economy.ts §4d)
  ('base_income_per_tier',           '10'::jsonb),
  -- starter values (src/sim/player/wallet.ts)
  ('starter_credits',                '1000'::jsonb),
  ('starter_alloys',                 '0'::jsonb),
  ('starter_population',             '1000'::jsonb),
  -- DESIGN §5a outcome table (ratio buckets + attacker casualty %)
  ('outcome_ratios_and_losses',
   '{"decisive":{"min_ratio":1.5,"attacker_loss":0.4},"pyrrhic":{"min_ratio":1.0,"attacker_loss":0.7},"repelled":{"min_ratio":0.75,"attacker_loss":0.6},"crushed":{"min_ratio":0.0,"attacker_loss":0.9}}'::jsonb)
on conflict (key) do nothing;
