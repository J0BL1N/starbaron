TASK (StarBaron P5-T10, master roadmap): FLEET PERSISTENCE — serialization contract (fleet + orders + route state to/from JSON, round-trip, validation) AND the write-only SQL deliverable (fleet tables migration + SQL test — NOT applied, deferred to Jay).

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/fleet.ts (P5-T03): Fleet.
- src/sim/fleet/orders.ts (P5-T07): FleetOrders, FleetOrder.
- src/sim/fleet/routes.ts (P5-T09): TravelRoute.
- src/sim/player/player.ts: serializePlayer/deserializePlayer conventions (READ for the established serialization pattern — field naming, validation style).
- supabase/migrations/0013_world_schema.sql + 0016_ownership_canonical.sql: the SQL conventions (enum handling, RLS, write-only style).
- supabase/tests/07_world_schema.sql + 10_home_claim_atomicity.sql: SQL test conventions.

ALLOWED FILES (create ONLY):
- src/sim/fleet/persistence.ts
- tests/persistence.test.ts
- supabase/migrations/0017_fleets.sql        (WRITE-ONLY — never applied; RLS locked; deferred to Jay)
- supabase/tests/11_fleets.sql               (WRITE-ONLY SQL test)

RESTRICTIONS: TS part pure (no nondeterministic APIs, no module-level MUTABLE state, no wall-clock; no `any`; strict TS); SQL part follows the established 0013/0016 conventions exactly.

DESIGN SPEC (TS):
1. `FleetSnapshot = { fleet: Fleet; orders: FleetOrders | null; routes: TravelRoute[] }`.
2. Pure functions:
   - `serializeFleetSnapshot(snapshot: FleetSnapshot): string` — deterministic JSON (stable key order — hand-ordered object construction, no reliance on insertion order of dynamic maps; document); no undefined values (null instead); validates the snapshot via the invariants first (fleetInvariants + ordersInvariants) and throws on invalid.
   - `deserializeFleetSnapshot(json: string): FleetSnapshot` — strict parse (reject trailing content? use JSON.parse + a deep validation pass); re-validates ALL invariants (fleet, orders, routes) and throws descriptive Error on any violation; round-trip guarantee: deserialize(serialize(x)) deep-equals x.
   - `snapshotInvariants(snapshot: FleetSnapshot): { ok: boolean; problems: string[] }` — fleetInvariants + ordersInvariants (when present) + route shape checks (waypoints >= 2, leg count = waypoints−1, totals consistent — reuse routes invariants if exported, else local checks documented).
3. Invariants (test): round-trip (serialize→deserialize → deep-equal, incl. null orders, empty routes, multi-route); determinism (same snapshot → byte-identical string); invalid input rejection (malformed JSON, wrong shapes, invariant violations — e.g. corrupted composition, dangling activeOrderId); stable key order.

DESIGN SPEC (SQL — supabase/migrations/0017_fleets.sql, WRITE-ONLY):
1. Follow 0016's conventions EXACTLY (search_path, comment header, RLS policies with `to authenticated using (owner_id = auth.uid())` style — READ 0016 for the exact policy shape; enums via CREATE TYPE ... AS ENUM; timestamps as timestamptz).
2. Tables:
   - `fleet` (id text primary key, owner_id text not null references player_profile(player_id) — READ 0013/0016 for the exact player table + id types, name text not null, composition jsonb not null, location jsonb not null, status text not null check, created_at timestamptz default now(), updated_at timestamptz default now()).
   - `fleet_order` (id text primary key, fleet_id text not null references fleet(id) on delete cascade, type text not null check in ('move','attack','defend','return'), target jsonb null, issued_at timestamptz not null, status text not null check in ('issued','active','done','cancelled'), expires_at timestamptz null).
   - `fleet_route` (id text primary key, fleet_id text not null references fleet(id) on delete cascade, waypoints jsonb not null, total_distance_pc numeric not null check (total_distance_pc >= 0), departure_at timestamptz not null, arrival_at timestamptz not null, check (arrival_at > departure_at)).
3. Indexes: fleet(owner_id); fleet_order(fleet_id, status); fleet_route(fleet_id, arrival_at).
4. RLS: enable on all three; policies: fleet select/insert/update/delete by owner; fleet_order select/insert/update/delete via the fleet's owner (subquery `exists (select 1 from fleet f where f.id = fleet_order.fleet_id and f.owner_id = auth.uid())` — READ 0016 for the established pattern); fleet_route same pattern.
5. supabase/tests/11_fleets.sql — follow 10_home_claim_atomicity.sql conventions: begin/rollback transaction, insert a fleet + orders + route as a test owner, assert RLS behaviors (select as another user → 0 rows), assert the arrival > departure check fires on bad insert, rollback.

VERIFY: TS: `npx tsc -b` exit 0; `npx vitest run tests/persistence.test.ts --pool threads` all pass. SQL: static self-review ONLY (do NOT run psql; do NOT apply). Report changed files, commands + results, limitations (SQL deferred; RLS pattern cited from which migration).
