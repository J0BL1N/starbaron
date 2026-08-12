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
--                 type/status outside the unions, fleet.composition not a
--                 JSON object, fleet_route.arrival_at <= departure_at,
--                 fleet_route.total_distance_pc < 0 — each raises
--                 check_violation and nothing persists;
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
--    policies, then reads them back.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

insert into public.fleet (id, owner_id, name, composition, location, status)
values ('fleet-1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alpha Strike',
        '{"scout":2,"corvette":0,"frigate":1,"cruiser":0,"battleship":0}'::jsonb,
        '{"kind":"planet","bodyId":"body:home"}'::jsonb,
        'idle');

insert into public.fleet_order (id, fleet_id, type, target, issued_at, status, expires_at)
values ('order-1', 'fleet-1', 'move',   '{"kind":"system","id":"sys-alpha"}'::jsonb, now(), 'issued', null),
       ('order-2', 'fleet-1', 'return', null, now() + interval '1 second', 'issued', null);

insert into public.fleet_route (id, fleet_id, waypoints, total_distance_pc, departure_at, arrival_at)
values ('route-1', 'fleet-1',
        '[{"ref":{"kind":"planet","bodyId":"home"},"position":{"x":0,"y":0,"z":0}},{"ref":{"kind":"system","bodyId":"sys-alpha"},"position":{"x":3,"y":0,"z":0}}]'::jsonb,
        3, now(), now() + interval '10 minutes');

do $$
declare v_n bigint;
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
    values ('order-x', 'fleet-1', 'move', '{"kind":"system","id":"sys-alpha"}'::jsonb, now(), 'issued');
    raise exception '8653 ASSERTION FAILED: B must not insert an order on A fleet';
  exception
    when insufficient_privilege then null; -- RLS with-check violation (42501)
  end;
end $$;

-- ---------------------------------------------------------------------
-- 4. CHECKs fire (as postgres — RLS bypassed by superuser so each failure
--    isolates the CHECK itself): fleet.status / order type / order status
--    outside the unions, fleet.composition not a JSON object, route
--    arrival_at <= departure_at, route total_distance_pc < 0. Nothing
--    persists.
-- ---------------------------------------------------------------------
set local role postgres;
do $$
begin
  begin
    insert into public.fleet (id, owner_id, name, composition, location, status)
    values ('fleet-bad-status', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad',
            '{"scout":0,"corvette":0,"frigate":0,"cruiser":0,"battleship":0}'::jsonb,
            '{"kind":"planet","bodyId":"x"}'::jsonb, 'orbiting');
    raise exception '8653 ASSERTION FAILED: fleet.status outside the union must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet (id, owner_id, name, composition, location, status)
    values ('fleet-bad-composition', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad',
            '"scout"'::jsonb, '{"kind":"planet","bodyId":"x"}'::jsonb, 'idle');
    raise exception '8653 ASSERTION FAILED: fleet.composition must be a JSON object';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_order (id, fleet_id, type, target, issued_at, status)
    values ('order-bad-type', 'fleet-1', 'explore', '{"kind":"system","id":"x"}'::jsonb, now(), 'issued');
    raise exception '8653 ASSERTION FAILED: fleet_order.type outside the union must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_order (id, fleet_id, type, target, issued_at, status)
    values ('order-bad-status', 'fleet-1', 'move', '{"kind":"system","id":"x"}'::jsonb, now(), 'flying');
    raise exception '8653 ASSERTION FAILED: fleet_order.status outside the union must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_route (id, fleet_id, waypoints, total_distance_pc, departure_at, arrival_at)
    values ('route-bad-window', 'fleet-1', '[]'::jsonb, 0, now(), now() - interval '1 minute');
    raise exception '8653 ASSERTION FAILED: fleet_route arrival_at <= departure_at must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.fleet_route (id, fleet_id, waypoints, total_distance_pc, departure_at, arrival_at)
    values ('route-bad-distance', 'fleet-1', '[]'::jsonb, -1, now(), now() + interval '1 minute');
    raise exception '8653 ASSERTION FAILED: fleet_route total_distance_pc < 0 must raise';
  exception
    when check_violation then null; -- expected
  end;
end $$;

do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.fleet where id in ('fleet-bad-status', 'fleet-bad-composition');
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: rejected fleet inserts must not persist, saw %', v_n;
  end if;
  select count(*) into v_n from public.fleet_order where id like 'order-bad-%';
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: rejected order inserts must not persist, saw %', v_n;
  end if;
  select count(*) into v_n from public.fleet_route where id like 'route-bad-%';
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: rejected route inserts must not persist, saw %', v_n;
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
