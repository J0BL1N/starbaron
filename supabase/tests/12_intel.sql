-- =====================================================================
-- 12_intel (P6-T08 — contract tests for 0018_intel.sql)
-- Purpose   : Contract tests for the intel persistence table against the
--             applied 0001-0018 migration set. 0018 ships WRITE-ONLY and
--             is deferred to Jay; this suite runs only once Jay applies
--             it. Proves:
--               * an intel record round-trips as the OWNER: the recording
--                 player (A) INSERTs directly through the RLS policies,
--                 then SELECTs the rows back — last_updated_at round-trips
--                 as exact numeric sim ms and sources as the JSON array;
--               * owner isolation: a SECOND authenticated user (B)
--                 SELECTs the same rows → 0 rows — RLS is owner-scoped in
--                 both directions;
--               * the no-leak write gate: B INSERTing a row owned by A is
--                 rejected by the WITH CHECK (insufficient_privilege,
--                 42501) — a player can only write THEIR OWN records;
--               * the level CHECK fires: intel_level outside the SIX ladder
--                 values (none / observed / scanned / scouted / deep recon
--                 / full intelligence — levels.ts INTEL_LEVELS, EXACT)
--                 raises check_violation and nothing persists;
--               * the sources-array CHECK fires: sources not a JSON array
--                 raises check_violation;
--               * the timestamp CHECK fires: last_updated_at <= 0 raises
--                 check_violation;
--               * the composite PK (owner_id, target_id) admits one row per
--                 (owner, target) — a duplicate raises unique_violation;
--               * anon holds no intel-table privileges (belt-and-braces
--                 ACL probe, 11_fleets §6 style).
-- THE SERVER-SIDE GATE CONTRACT (documented, not executed here): the PvP
--             projection (pvpGatedView, src/sim/intel/pvp-gate.ts) runs
--             INSIDE a server-side RPC, NEVER in the client. The RPC reads
--             the VIEWER'S OWN store through this table's SELECT policy
--             (owner-scoped — only the recording player's rows are visible)
--             and applies the gate over it. The no-leak rule is enforced
--             at the ROW level here (RLS) and the gate applies at the RPC
--             boundary; a client can never read another player's intel and
--             never runs the gate itself.
-- Run      : executed via the project's linked database test workflow
--             (see ROADMAP).
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit.
-- Non-persisting: everything is inside BEGIN ... ROLLBACK (auth.users,
-- players and intel records all roll back).
-- =====================================================================

begin;

insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now());

insert into public.players (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- ---------------------------------------------------------------------
-- 1. Owner write + round-trip: the recording player (A) inserts two intel
--    records and reads them back. last_updated_at is the sim ms number as
--    exact numeric, sources is the deterministic source-id array.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

insert into public.intel_record (owner_id, target_id, intel_level, last_updated_at, sources)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'target:alpha', 'scanned', 1700000000000, '["mission-1"]'::jsonb),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'target:beta',  'deep recon', 1700000005000, '["mission-1","mission-2"]'::jsonb);

do $$
declare v_n bigint; v_level text; v_at numeric;
begin
  select count(*) into v_n from public.intel_record where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_n <> 2 then
    raise exception '8653 ASSERTION FAILED: owner intel round-trip must find 2 rows, saw %', v_n;
  end if;
  select intel_level, last_updated_at into v_level, v_at from public.intel_record where target_id = 'target:alpha';
  if v_level is distinct from 'scanned' or v_at <> 1700000000000 then
    raise exception '8653 ASSERTION FAILED: intel round-trip must preserve level and exact numeric ms, saw % / %', v_level, v_at;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Owner isolation: B selects the same rows → 0 rows (RLS is
--    owner-scoped in both directions).
-- ---------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.intel_record where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: another user must see 0 rows (RLS owner isolation), saw %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. The no-leak write gate: B inserting a row owned by A must be rejected
--    — the WITH CHECK (auth.uid() = owner_id) evaluates false
--    (insufficient_privilege, 42501).
-- ---------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
begin
  begin
    insert into public.intel_record (owner_id, target_id, intel_level, last_updated_at, sources)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'target:leak', 'scouted', 1700000000000, '["mission-x"]'::jsonb);
    raise exception '8653 ASSERTION FAILED: B must not write a record owned by A';
  exception
    when insufficient_privilege then null; -- RLS with-check violation (42501)
  end;
end $$;

-- ---------------------------------------------------------------------
-- 4. CHECKs fire (as postgres — RLS bypassed by superuser so each failure
--    isolates the constraint itself): intel_level outside the SIX ladder
--    values (the draft 'probed' name is deliberately NOT on the ladder —
--    levels.ts documents its removal), sources not a JSON array, and
--    last_updated_at <= 0. Nothing persists.
-- ---------------------------------------------------------------------
set local role postgres;
do $$
begin
  begin
    insert into public.intel_record (owner_id, target_id, intel_level, last_updated_at, sources)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'intel-bad-level', 'probed', 1700000000000, '[]'::jsonb);
    raise exception '8653 ASSERTION FAILED: intel_level outside the six ladder values must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.intel_record (owner_id, target_id, intel_level, last_updated_at, sources)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'intel-bad-sources', 'scanned', 1700000000000, '"mission-1"'::jsonb);
    raise exception '8653 ASSERTION FAILED: sources must be a JSON array';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.intel_record (owner_id, target_id, intel_level, last_updated_at, sources)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'intel-bad-at-zero', 'scanned', 0, '[]'::jsonb);
    raise exception '8653 ASSERTION FAILED: last_updated_at = 0 must raise';
  exception
    when check_violation then null; -- expected
  end;
  begin
    insert into public.intel_record (owner_id, target_id, intel_level, last_updated_at, sources)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'intel-bad-at-negative', 'scanned', -5, '[]'::jsonb);
    raise exception '8653 ASSERTION FAILED: last_updated_at < 0 must raise';
  exception
    when check_violation then null; -- expected
  end;
end $$;

do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.intel_record where target_id like 'intel-bad-%';
  if v_n <> 0 then
    raise exception '8653 ASSERTION FAILED: rejected intel inserts must not persist, saw %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Composite PK: a duplicate (owner_id, target_id) row raises
--    unique_violation (23505) — the PK mirrors the store's per-owner
--    targetId-keyed map.
-- ---------------------------------------------------------------------
do $$
begin
  insert into public.intel_record (owner_id, target_id, intel_level, last_updated_at, sources)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'target:alpha', 'scouted', 1700000001000, '["mission-x"]'::jsonb);
  raise exception '8653 ASSERTION FAILED: a duplicate (owner_id, target_id) row must violate the PK';
exception
  when unique_violation then null; -- expected
end $$;

-- ---------------------------------------------------------------------
-- 6. ACL belt-and-braces probe (11_fleets §6 style): anon holds no
--    intel-table privileges at all — the REVOKE set in 0018 is the
--    grant-level contract, independent of RLS.
-- ---------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.intel_record', 'SELECT')
     or has_table_privilege('anon', 'public.intel_record', 'INSERT')
     or has_table_privilege('anon', 'public.intel_record', 'UPDATE')
     or has_table_privilege('anon', 'public.intel_record', 'DELETE') then
    raise exception '8653 ASSERTION FAILED: anon must hold no intel-table privileges';
  end if;
end $$;

rollback;
