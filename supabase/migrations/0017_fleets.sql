-- =====================================================================
-- 0017_fleets (P5-T10 — WRITE-ONLY, deferred to Jay, NEVER applied)
-- Purpose   : Fleet persistence — the SQL mirror of the P5-T10 fleet
--             snapshot serialization contract
--             (src/sim/fleet/persistence.ts): one row per Fleet
--             (fleet), per FleetOrder (fleet_order) and per TravelRoute
--             (fleet_route). The three tables are OWNER-scoped direct
--             client writes via RLS policies — the first direct-client
--             write tables in the stack (0001/0002/0004 keep writes
--             behind SECURITY DEFINER RPCs; the P5-T10 brief locks fleet
--             writes as direct DML gated by owner policies).
--             WRITE-ONLY: this file is shipped for review only and is
--             NEVER applied without Jay's explicit authorisation. RLS is
--             LOCKED (enabled + FORCED on all three tables) so even the
--             apply window leaks nothing to anon/other players.
-- Convention deviations from the brief (documented — the brief is
--   superseded by the LOCKED repo conventions it points at):
--   * Player FK: the brief names player_profile(player_id), but no such
--     table exists. The repo's player identity table is public.players
--     (id uuid primary key references auth.users (id)) — 0001; every
--     user-owned table (0001 owned_planets, 0002 notifications, 0004
--     attacks/attack_members) references public.players (id) with a uuid
--     FK. owner_id is therefore uuid, not text, matching
--     owned_planets.owner_id / attacks.launcher_id.
--   * Enums: the brief says CREATE TYPE ... AS ENUM, but the LOCKED repo
--     convention is text + CHECK (0004 header, D7: "status/outcome as
--     text+CHECK (D7, not enums)"). Every status/type/kind below is text
--     with an inline CHECK, exactly like 0001/0004/0013/0016.
--   * search_path: 0016 sets search_path INSIDE its function bodies
--     (set search_path = public, pg_temp); this file is pure DDL (no
--     functions) and the top-level DDL migrations (0001/0002/0004/0013)
--     set no search_path — all objects are public.-qualified. Same here.
-- Timestamps: created_at/updated_at are timestamptz with default now()
--   (0001/0013 DB-filled operational metadata convention); issued_at /
--   expires_at / departure_at / arrival_at are explicit NOT NULL inputs
--   (the sim timestamps are caller-supplied millisecond numbers — the
--   SQL mirror maps them to timestamptz columns).
-- Idempotent: NO (forward-only; runs exactly once on an empty schema).
--   CREATE POLICY has no IF NOT EXISTS, so this file is NOT re-runnable —
--   the 0001/0002/0004 convention for user-owned tables (0013's
--   IF-NOT-EXISTS style is for the world tables, which have no policies
--   here).
-- Date      : 2026-08-13
-- Scope     : 3 new tables + 4 indexes (incl. the fleet_order one-active
--             partial UNIQUE index) + RLS (enable + force) + owner
--             policies + grants. No data, no RPCs, no changes to existing
--             objects. NOT APPLIED — deferred to Jay. Whole-phase finding 5
--             additions: fleet.sim_created_at, fleet_order.active +
--             one-active partial UNIQUE index + target object CHECK,
--             fleet_route.legs + total_duration_sec + legs array CHECK
--             (the SQL mirrors the full TS graph; deep JSONB shape
--             validation stays in persistence.ts).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. fleet — one row per Fleet (src/sim/fleet/fleet.ts). composition /
--    location are JSONB mirrors of FleetComposition (per-class non-negative
--    integer counts) and FleetLocation ({kind, bodyId}); status is the
--    FleetStatus union (text + CHECK, D7). owner_id is the owning
--    public.players row; deleting a player cascades away their fleets
--    (owned_planets.owner_id precedent, 0001). sim_created_at mirrors the
--    sim's deterministic createdAt (the caller-supplied millisecond
--    timestamp, mapped to timestamptz — finding 5). created_at/updated_at
--    are DB-filled operational metadata (0013 convention) — the sim keeps
--    its own sim_created_at separately. The JSONB CHECKs enforce structural
--    types only (composition/location must be objects); deep shape
--    validation (per-class integer counts, {kind, bodyId} fields) stays in
--    the TS snapshot invariants (persistence.ts).
-- ---------------------------------------------------------------------
create table public.fleet (
  id            text primary key,   -- deterministic fleet id (fnv1a, fleet.ts)
  owner_id      uuid not null references public.players (id) on delete cascade,
  name          text not null,
  composition   jsonb not null check (jsonb_typeof(composition) = 'object'), -- FleetComposition: per-class non-negative integer counts
  location      jsonb not null check (jsonb_typeof(location) = 'object'),    -- FleetLocation: {kind, bodyId}
  status        text not null check (status in ('idle','traveling','combat','returning')), -- FleetStatus union
  sim_created_at timestamptz not null, -- the sim's deterministic createdAt (finding 5)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index fleet_owner_idx on public.fleet (owner_id);

-- ---------------------------------------------------------------------
-- 2. fleet_order — one row per FleetOrder (src/sim/fleet/orders.ts), the
--    queue rows of a fleet's FleetOrders. type/status are text + CHECK
--    (D7); target is nullable JSONB ({kind,id}, null for 'return') with a
--    structural object CHECK (deep validation stays in TS); the parent
--    fleet FK cascades (0004 attack_members.attack_id precedent). `active`
--    mirrors the one-active-order semantics: exactly one row per fleet may
--    be active at a time, enforced in SQL by the partial UNIQUE index
--    fleet_order_one_active_idx on (fleet_id) WHERE active (finding 5).
-- ---------------------------------------------------------------------
create table public.fleet_order (
  id         text primary key,   -- deterministic order id (fnv1a, orders.ts)
  fleet_id   text not null references public.fleet (id) on delete cascade,
  type       text not null check (type in ('move','attack','defend','return')), -- FleetOrderType union
  target     jsonb check (target is null or jsonb_typeof(target) = 'object'),   -- FleetOrderTarget {kind,id} | null ('return' carries no target)
  issued_at  timestamptz not null,
  status     text not null check (status in ('issued','active','done','cancelled')), -- FleetOrderStatus union
  expires_at timestamptz,
  active     boolean not null default false -- one-active-order flag (finding 5)
);
create index fleet_order_fleet_status_idx on public.fleet_order (fleet_id, status);
create unique index fleet_order_one_active_idx on public.fleet_order (fleet_id) where active; -- at most one active order per fleet (finding 5)

-- ---------------------------------------------------------------------
-- 3. fleet_route — one row per TravelRoute (src/sim/fleet/routes.ts).
--    waypoints is the JSONB waypoint array; legs is the JSONB leg array
--    (finding 5 — the SQL now mirrors the full route graph); total
--    distance/duration totals are numeric (>= 0 — route totals are always
--    non-negative); departure_at must be strictly before arrival_at
--    (routes.ts guarantees arrival > departure). The JSONB CHECKs enforce
--    structural types only (waypoints/legs must be arrays); deep shape
--    validation (per-waypoint ref/position, per-leg refs/timing/geometry)
--    stays in the TS snapshot invariants (persistence.ts). The id is a
--    persistence key — the sim route carries no id field (the caller
--    supplies one at persist time, like owned_planets.id). Parent FK
--    cascades like fleet_order.
-- ---------------------------------------------------------------------
create table public.fleet_route (
  id                text primary key,   -- persistence key (sim TravelRoute has no id)
  fleet_id          text not null references public.fleet (id) on delete cascade,
  waypoints         jsonb not null check (jsonb_typeof(waypoints) = 'array'),  -- Waypoint[] (ref + position each)
  legs              jsonb not null check (jsonb_typeof(legs) = 'array'),       -- TravelLeg[] (finding 5)
  total_distance_pc numeric not null check (total_distance_pc >= 0),
  total_duration_sec numeric not null check (total_duration_sec >= 0),         -- finding 5
  departure_at      timestamptz not null,
  arrival_at        timestamptz not null,
  check (arrival_at > departure_at)
);
create index fleet_route_fleet_arrival_idx on public.fleet_route (fleet_id, arrival_at);

-- =====================================================================
-- RLS + grants.
--   fleet / fleet_order / fleet_route are the first direct-client-write
--   tables in the stack (fleet persistence is written by the client per
--   the P5-T10 brief) — unlike 0001/0002/0004 where writes flow through
--   SECURITY DEFINER RPCs. Every table is OWNER-scoped:
--     * fleet:        auth.uid() = owner_id — the direct row gate
--                     (0001 players_own_row + 0002 notifications_own_rows
--                     shape; INSERT/UPDATE add WITH CHECK so a player can
--                     only ever write their own rows).
--     * fleet_order / fleet_route: the owning FLEET's owner, via a
--                     SINGLE-DIRECTION subquery — exists (select 1 from
--                     public.fleet f where f.id = fleet_order.fleet_id
--                     and f.owner_id = auth.uid()). RLS recursion audit
--                     (0004 convention): the subquery re-enters fleet's
--                     SELECT policy, which is a pure owner row gate that
--                     NEVER references the child tables, so the direction
--                     is one-way and the fleet_order ↔ fleet recursion
--                     cannot form. No helper functions, no client-EXECUTE
--                     probes — a client can never evaluate visibility for
--                     an arbitrary fleet/player.
--   FORCE row-level security (0001/0002/0013 belt-and-braces) so the
--   table owner is still subject to the policies. service_role bypasses
--   RLS (BYPASSRLS) and is not granted table privileges here.
-- =====================================================================

alter table public.fleet       enable row level security;
alter table public.fleet       force row level security;
alter table public.fleet_order enable row level security;
alter table public.fleet_order force row level security;
alter table public.fleet_route enable row level security;
alter table public.fleet_route force row level security;

revoke all on table public.fleet       from public, anon;
revoke all on table public.fleet_order from public, anon;
revoke all on table public.fleet_route from public, anon;

grant select, insert, update, delete on table public.fleet       to authenticated;
grant select, insert, update, delete on table public.fleet_order to authenticated;
grant select, insert, update, delete on table public.fleet_route to authenticated;

create policy "fleet_own_rows_select"
  on public.fleet
  for select to authenticated
  using (auth.uid() = owner_id);

create policy "fleet_own_rows_insert"
  on public.fleet
  for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "fleet_own_rows_update"
  on public.fleet
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "fleet_own_rows_delete"
  on public.fleet
  for delete to authenticated
  using (auth.uid() = owner_id);

create policy "fleet_order_via_fleet_select"
  on public.fleet_order
  for select to authenticated
  using (exists (select 1 from public.fleet f where f.id = fleet_order.fleet_id and f.owner_id = auth.uid()));

create policy "fleet_order_via_fleet_insert"
  on public.fleet_order
  for insert to authenticated
  with check (exists (select 1 from public.fleet f where f.id = fleet_order.fleet_id and f.owner_id = auth.uid()));

create policy "fleet_order_via_fleet_update"
  on public.fleet_order
  for update to authenticated
  using (exists (select 1 from public.fleet f where f.id = fleet_order.fleet_id and f.owner_id = auth.uid()))
  with check (exists (select 1 from public.fleet f where f.id = fleet_order.fleet_id and f.owner_id = auth.uid()));

create policy "fleet_order_via_fleet_delete"
  on public.fleet_order
  for delete to authenticated
  using (exists (select 1 from public.fleet f where f.id = fleet_order.fleet_id and f.owner_id = auth.uid()));

create policy "fleet_route_via_fleet_select"
  on public.fleet_route
  for select to authenticated
  using (exists (select 1 from public.fleet f where f.id = fleet_route.fleet_id and f.owner_id = auth.uid()));

create policy "fleet_route_via_fleet_insert"
  on public.fleet_route
  for insert to authenticated
  with check (exists (select 1 from public.fleet f where f.id = fleet_route.fleet_id and f.owner_id = auth.uid()));

create policy "fleet_route_via_fleet_update"
  on public.fleet_route
  for update to authenticated
  using (exists (select 1 from public.fleet f where f.id = fleet_route.fleet_id and f.owner_id = auth.uid()))
  with check (exists (select 1 from public.fleet f where f.id = fleet_route.fleet_id and f.owner_id = auth.uid()));

create policy "fleet_route_via_fleet_delete"
  on public.fleet_route
  for delete to authenticated
  using (exists (select 1 from public.fleet f where f.id = fleet_route.fleet_id and f.owner_id = auth.uid()));
