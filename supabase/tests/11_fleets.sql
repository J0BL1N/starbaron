-- =====================================================================
-- 11_fleets (P5-T10 — contract tests for 0017_fleets.sql)
-- Purpose   : Contract tests for the fleet persistence tables against the
--             applied 0001-0017 migration set. 0017 ships WRITE-ONLY and
--             is deferred to Jay; this suite runs only once Jay applies
--             it. Proves:
--               * a fleet + orders + routes round-trip as the OWNER: the
--                 owner (A) INSERTs directly through the RLS policies,
--                 then SELECTs the rows back;
--               * owner isolation: a SECOND authenticated user (B)
--                 SELECTs the same rows → 0 rows on all three tables —
--                 RLS is owner-scoped in both directions;
--               * the fleet_order / fleet_route policies resolve the
--                 owner THROUGH the fleet row: B inserting a child row on
--                 A's fleet is rejected by the WITH CHECK subquery
--                 (insufficient_privilege, 42501);
--               * CHECKs fire: fleet.status outside the union, order
--                 type/status outside the unions, fleet.composition /
--                 location not JSON objects, fleet_order.target not a JSON
--                 object when present, fleet_route.legs not a JSON array,
--                 fleet_route.arrival_at <= departure_at, fleet_route
--                 total_distance_pc < 0, the round-3 active/status pair
--                 mismatches (active=true on 'issued' and active=false on
--                 'active') — each raises check_violation and nothing
--                 persists;
--               * finding 5 NOT NULL columns: fleet.sim_created_at and the
--                 route legs / total_duration_sec columns are present on
--                 the written rows and an omitted value raises
--                 not_null_violation;
--               * round-4 sim-time contract: the fleet / order / route
--                 sim timestamps round-trip as exact millisecond numeric
--                 values (sim_created_at, issued_at, departure_at /
--                 arrival_at) — the TS `number` snapshots persist without
--                 a timestamptz mapper, INCLUDING fractional arrivals
--                 (10 pc @ 3 pc/s → arrival 1700000003333.3333 ms) that a
--                 bigint column cannot hold;
--               * finding 5 one-active-order partial UNIQUE index: with
--                 the active slot handed from order-1 to order-2 (status
--                 and active flag transition together, round-3), a second
--                 active order for the same fleet raises unique_violation
--                 and nothing persists;
--               * ON DELETE CASCADE: deleting a fleet removes its orders
--                 and routes;
--               * anon holds no fleet-table privileges (belt-and-braces
--                 ACL probe, 07_world_schema.sql §0 style).
-- Run      : executed via the project's linked database test workflow
--             (see ROADMAP).
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK (auth.users,
-- players, fleets, orders and routes all roll back).
-- =====================================================================

begin;

insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now());

insert into public.players (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- ---------------------------------------------------------------------
-- 1. Owner write + round-trip: A inserts a fleet, two orders (move with a
--    target, return with a null target) and a route through the direct RLS
--    policies, then reads them back. The inserts now cover the whole-phase
--    finding 5 mirror additions: fleet.sim_created_at, the route legs /
--    total_duration_sec columns, and the fleet_order.active flag.
--    Round-4: the route uses a FRACTIONAL arrival (10 pc @ 3 pc/s →
--    3.333… s → arrival 1700000003333.3333 ms) to prove the sim
--    timestamps are exact numeric, not bigint — the TS movement contract
--    emits fractional ms that a bigint column cannot hold.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

insert into public.fleet (id, owner_id, name, composition, location, status, sim_created_at)
values ('fleet-1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alpha Strike',
        '{"scout":2,"corvette":0,"frigate":1,"cruiser":0,"battleship":0}'::jsonb,
        '{"kind":"planet","bodyId":"body:home"}'::jsonb,
        'idle', 1700000000000);

insert into public.fleet_order (id, fleet_id, type, target, issued_at, status, expires_at, active)
values ('order-1', 'fleet-1', 'move',   '{"kind":"system","id":"sys-alpha"}'::jsonb, 1700000000000, 'issued', null, false),
       ('order-2', 'fleet-1', 'return', null, 1700000001000, 'issued', null, false);

insert into public.fleet_route (id, fleet_id, waypoints, legs, total_distance_pc, total_duration_sec, departure_at, arrival_at)
values ('route-1', 'fleet-1',
        '[{"ref":{"kind":"planet","bodyId":"home"},"position":{"x":0,"y":0,"z":0}},{"ref":{"kind":"system","bodyId":"sys-alpha"},"position":{"x":3,"y":0,"z":0}}]'::jsonb,
        '[{"fleetId":"fleet-1","from":{"kind":"planet","bodyId":"home"},"to":{"kind":"system","bodyId":"sys-alpha"},"distancePc":10,"speedPcPerSec":3,"departureAt":1700000000000,"arrivalAt":1700000003333.3333,"status":"traveling"}]'::jsonb,
        10, 3.3333, 1700000000000, 1700000003333.3333);

do $$
declare v_n bigint; v_sim numeric; v_dep numeric; v_arr numeric;
begin
  select count(*) into v_n from public.fleet where id = 'fleet-1';
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: owner fleet round-trip must find the row';
  end if;
  select count(*) into v_n from public.fleet_order where fleet_id = 'fleet-1';
  if v_n <> 2 then
    raise exception '8653 ASSERTION FAILED: owner order round-trip must find 2 rows, saw %', v_n;
  end if;
  select count(*) into v_n from public.fleet_route where fleet_id = 'fleet-1';
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: owner route round-trip must find the row';
  end if;
  -- round-4: sim_created_at round-trips the exact millisecond numeric value
  -- (the TS createdAt number persists without a timestamptz mapper)
  select sim_created_at into v_sim from public.fleet where id = 'fleet-1';
  if v_sim <> 1700000000000 then
    raise exception '8653 ASSERTION FAILED: fleet sim_created_at must round-trip as numeric ms, saw %', v_sim;
  end if;
  -- round-4: the FRACTIONAL arrival (10 pc @ 3 pc/s → 3333.333… ms after
  -- departure) must round-trip EXACTLY as numeric — the value that a bigint
  -- column cannot hold
  select departure_at, arrival_at into v_dep, v_arr from public.fleet_route where id = 'route-1';
  if v_dep <> 1700000000000 or v_arr <> 1700000003333.3333 then
    raise exception '8653 ASSERTION FAILED: route departure/arrival must round-trip as exact numeric ms, saw % / %', v_dep, v_arr;
  end if;
  -- finding 5: route legs and total_duration_sec are present on the route
  -- row; round-4: departure_at / arrival_at round-trip the exact numeric ms
  select count(*) into v_n from public.fleet_route r
    where r.id = 'route-1' and r.legs is not null and jsonb_typeof(r.legs) = 'array'
      and r.total_duration_sec = 3.3333
      and r.departure_at = 1700000000000 and r.arrival_at = 1700000003333.3333;
  if v_n <> 1 then
    raise exception '8653 ASSERTION FAILED: route legs, total_duration_sec and numeric ms timestamps must be present and match';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Owner isolation: B selects the same rows → 0 rows on all three
--    tables (RLS is owner-scoped in both directions).
-- ---------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_f bigint; v_o bigint; v_r bigint;
begin
  select count(*) into v_f from public.fleet      where id = 'fleet-1';
  select count(*) into v_o from public.fleet_order where fleet_id = 'fleet-1';
  select count(*) into v_r from public.fleet_route where fleet_id = 'fleet-1';
  if v_f <> 0 or v_o <> 0 or v_r <> 0 then
    raise exception '8653 ASSERTION FAILED: another user must see 0 rows (RLS owner isolation), saw f % o % r %', v_f, v_o, v_r;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Subquery ownership: B inserting a child row on A's fleet must be
--    rejected — the WITH CHECK resolves the owner through the fleet row,
--    which RLS hides from B (insufficient_privilege, 42501).
-- ---------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
begin
  begin
    insert into public.fleet_order (id, fleet_id, type, target, issued_at, status)
    values ('order-x', 'fleet-1', 'move', '{"kind":"system","id":"sys-alpha"}'::jsonb, 1700000000000, 'issued');
    raise exception '8653 ASSERTION FAILED: B must not insert an order on A fleet';
  exception
    when insufficient_privilege then null; -- RLS with-check violation (42501)
  end;
end $$;

-- ---------------------------------------------------------------------
-- 4. CHECKs + NOT NULL fire (as postgres — RLS bypassed by superuser so
--    each failure isolates the constraint itself): fleet.status / order
--    type / order status outside the unions, fleet.composition not a JSON
--    object, JSONB shape CHECKs (fleet.location / fleet_order.target must
--    be objects, fleet_route.legs must be an array), the NOT NULL columns
--    added in finding 5 (sim_created_at, route legs, total_duration_sec),
--    route arrival_at <= departure_at, route total_distance_pc < 0, and
--    the round-3 fleet_order_active_matches_status mismatches (active=true
--    on 'issued', active=false on 'active'). Nothing persists.
-- ---------------------------------------------------------------------
set local role postgres;
do $$
begin
  begin
    insert into public.fleet (id, owner_id, name, composition, location, status, sim_created_at)
    values ('fleet-bad-status', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad',
            '{"scout":0,"corvette":0,"frigate":0,"cruiser":0,"battleship":0}'::jsonb,
            '{"kind":"planet","bodyId":"x"}'::jsonb, 'orbiting', 1700000000000);
    raise exception '8653 ASSERTION FAILED: fleet.status outside the union must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet (id, owner_id, name, composition, location, status, sim_created_at)
    values ('fleet-bad-composition', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad',
            '"scout"'::jsonb, '{"kind":"planet","bodyId":"x"}'::jsonb, 'idle', 1700000000000);
    raise exception '8653 ASSERTION FAILED: fleet.composition must be a JSON object';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet (id, owner_id, name, composition, location, status, sim_created_at)
    values ('fleet-bad-location', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad',
            '{"scout":0,"corvette":0,"frigate":0,"cruiser":0,"battleship":0}'::jsonb,
            '["kind","planet"]'::jsonb, 'idle', 1700000000000);
    raise exception '8653 ASSERTION FAILED: fleet.location must be a JSON object (finding 5)';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet (id, owner_id, name, composition, location, status)
    values ('fleet-missing-sim-created-at', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad',
            '{"scout":0,"corvette":0,"frigate":0,"cruiser":0,"battleship":0}'::jsonb,
            '{"kind":"planet","bodyId":"x"}'::jsonb, 'idle');
    raise exception '8653 ASSERTION FAILED: fleet.sim_created_at is NOT NULL (finding 5)';
  exception
    when not_null_violation then null; -- expected
  end;
  begin
    insert into public.fleet_order (id, fleet_id, type, target, issued_at, status)
    values ('order-bad-type', 'fleet-1', 'explore', '{"kind":"system","id":"x"}'::jsonb, 1700000000000, 'issued');
    raise exception '8653 ASSERTION FAILED: fleet_order.type outside the union must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_order (id, fleet_id, type, target, issued_at, status)
    values ('order-bad-status', 'fleet-1', 'move', '{"kind":"system","id":"x"}'::jsonb, 1700000000000, 'flying');
    raise exception '8653 ASSERTION FAILED: fleet_order.status outside the union must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_order (id, fleet_id, type, target, issued_at, status)
    values ('order-bad-target-shape', 'fleet-1', 'move', '["kind","system"]'::jsonb, 1700000000000, 'issued');
    raise exception '8653 ASSERTION FAILED: fleet_order.target must be a JSON object when present (finding 5)';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_order (id, fleet_id, type, target, issued_at, status, active)
    values ('order-bad-active-issued', 'fleet-1', 'move', '{"kind":"system","id":"x"}'::jsonb, 1700000000000, 'issued', true);
    raise exception '8653 ASSERTION FAILED: active=true with status ''issued'' must violate fleet_order_active_matches_status (round 3)';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_order (id, fleet_id, type, target, issued_at, status, active)
    values ('order-bad-inactive-active', 'fleet-1', 'move', '{"kind":"system","id":"x"}'::jsonb, 1700000000000, 'active', false);
    raise exception '8653 ASSERTION FAILED: active=false with status ''active'' must violate fleet_order_active_matches_status (round 3)';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_route (id, fleet_id, waypoints, legs, total_distance_pc, total_duration_sec, departure_at, arrival_at)
    values ('route-bad-window', 'fleet-1', '[]'::jsonb, '[]'::jsonb, 0, 0, 1700000003000, 1700000000000);
    raise exception '8653 ASSERTION FAILED: fleet_route arrival_at <= departure_at must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_route (id, fleet_id, waypoints, legs, total_distance_pc, total_duration_sec, departure_at, arrival_at)
    values ('route-bad-distance', 'fleet-1', '[]'::jsonb, '[]'::jsonb, -1, 0, 1700000000000, 1700000006000);
    raise exception '8653 ASSERTION FAILED: fleet_route total_distance_pc < 0 must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_route (id, fleet_id, waypoints, legs, total_distance_pc, total_duration_sec, departure_at, arrival_at)
    values ('route-bad-legs-shape', 'fleet-1', '[]'::jsonb, '{}'::jsonb, 0, 0, 1700000000000, 1700000006000);
    raise exception '8653 ASSERTION FAILED: fleet_route.legs must be a JSON array (finding 5)';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_route (id, fleet_id, waypoints, total_distance_pc, total_duration_sec, departure_at, arrival_at)
    values ('route-missing-legs', 'fleet-1', '[]'::jsonb, 0, 0, 1700000000000, 1700000006000);
    raise exception '8653 ASSERTION FAILED: fleet_route.legs is NOT NULL (finding 5)';
  exception
    when not_null_violation then null; -- expected
  end;
  begin
    insert into public.fleet_route (id, fleet_id, waypoints, legs, total_distance_pc, departure_at, arrival_at)
    values ('route-missing-duration', 'fleet-1', '[]'::jsonb, '[]'::jsonb, 0, 1700000000000, 1700000006000);
    raise exception '8653 ASSERTION FAILED: fleet_route.total_duration_sec is NOT NULL (finding 5)';
  exception
    when not_null_violation then null; -- expected
  end;
end $$;

do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.fleet where id in ('fleet-bad-status', 'fleet-bad-composition', 'fleet-bad-location', 'fleet-missing-sim-created-at');
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: rejected fleet inserts must not persist, saw %', v_n;
  end if;
  select count(*) into v_n from public.fleet_order where id like 'order-bad-%';
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: rejected order inserts must not persist, saw %', v_n;
  end if;
  select count(*) into v_n from public.fleet_route where id like 'route-bad-%' or id like 'route-missing-%';
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: rejected route inserts must not persist, saw %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4b. One-active-order partial UNIQUE index (finding 5 + round 3): the
--     active slot is handed from order-1 to order-2 with status AND the
--     active flag transitioning together (order-1 completes → active=false,
--     order-2 activates → status='active' + active=true), then inserting a
--     SECOND active order for the same fleet must fail with unique_violation
--     (23505) — order-2 holds the slot. Nothing persists.
-- ---------------------------------------------------------------------
do $$
begin
  update public.fleet_order set status = 'done', active = false where id = 'order-1';
  update public.fleet_order set status = 'active', active = true where id = 'order-2';
  begin
    insert into public.fleet_order (id, fleet_id, type, target, issued_at, status, active)
    values ('order-active2', 'fleet-1', 'move', '{"kind":"system","id":"x"}'::jsonb, 1700000000000, 'active', true);
    raise exception '8653 ASSERTION FAILED: a second active order for the same fleet must violate the partial unique index';
  exception
    when unique_violation then null; -- expected
  end;
end $$;

do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.fleet_order where id = 'order-active2';
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: rejected second active order must not persist, saw %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. ON DELETE CASCADE: deleting a fleet removes its orders and routes.
-- ---------------------------------------------------------------------
delete from public.fleet where id = 'fleet-1';
do $$
declare v_f bigint; v_o bigint; v_r bigint;
begin
  select count(*) into v_f from public.fleet      where id = 'fleet-1';
  select count(*) into v_o from public.fleet_order where fleet_id = 'fleet-1';
  select count(*) into v_r from public.fleet_route where fleet_id = 'fleet-1';
  if v_f <> 0 or v_o <> 0 or v_r <> 0 then
    raise exception '8653 ASSERTION FAILED: fleet cascade must remove orders and routes, saw f % o % r %', v_f, v_o, v_r;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. ACL belt-and-braces probe (07_world_schema.sql §0 style): anon holds
--    no fleet-table privileges at all — the REVOKE set in 0017 is the
--    grant-level contract, independent of RLS.
-- ---------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.fleet', 'SELECT')
     or has_table_privilege('anon', 'public.fleet', 'INSERT')
     or has_table_privilege('anon', 'public.fleet_order', 'SELECT')
     or has_table_privilege('anon', 'public.fleet_order', 'INSERT')
     or has_table_privilege('anon', 'public.fleet_route', 'SELECT')
     or has_table_privilege('anon', 'public.fleet_route', 'INSERT') then
    raise exception '8653 ASSERTION FAILED: anon must hold no fleet-table privileges';
  end if;
end $$;

rollback;
