-- =====================================================================
-- 01_claim_rls
-- Purpose   : P3-T01-C claim/colonise contract tests against the applied
--             0001-0003 migration set. Proves:
--               * claim_home_planet is idempotent (same caller re-claims ->
--                 the same home row, still exactly one home).
--               * two claims of the same planet -> ONE winner (advisory
--                 lock serialises; second claimant gets the structured
--                 planet_taken conflict; unique index is the backstop).
--               * claim_colony's real rejection paths: no home -> raises;
--                 NULL name -> not-null violation; double-colony (own
--                 planet re-claim) -> planet_taken; other-owner planet ->
--                 planet_taken.
--               * anon sees ZERO owned_planets rows. The schema grants
--                 anon nothing (audit §3.1), so this manifests as an
--                 explicit permission-denied (42501) assertion, not 0 rows.
--               * anon cannot EXECUTE the claim RPCs (no EXECUTE grant).
--               * authenticated CAN EXECUTE the claim RPCs.
--             D3 tradeoff note (audit §7): the server validates uniqueness,
--             NOT catalogue membership, so an unclaimed arbitrary name IS
--             accepted by design; the tests assert the rejection paths the
--             schema actually implements.
-- Run      : npx --no-install supabase db query --linked -f supabase/tests/01_claim_rls.sql
-- Exit     : 0 = pass. Failures RAISE ('8653 ASSERTION FAILED: ...') ->
--             non-zero exit (the CLI treats any raised exception as failure).
-- Non-persisting: everything is inside BEGIN ... ROLLBACK (fake auth.users
-- rows, claims, role switches all roll back).
-- =====================================================================

begin;

-- Seed fake auth.users (players.id FK -> auth.users.id; the claim RPC
-- creates the players row on first claim). Removed by the ROLLBACK.
insert into auth.users (id, email, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@test.local', now(), now());

-- 1. claim_home_planet is idempotent: same caller, same candidate ->
--    the same home row, and still exactly one home.
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare
  r1 jsonb;
  r2 jsonb;
  n  bigint;
begin
  select public.claim_home_planet('alpha', 2) into r1;
  select public.claim_home_planet('alpha', 2) into r2;
  if r1 <> r2 then
    raise exception '8653 ASSERTION FAILED: idempotent re-claim must return the same home row';
  end if;
  if r1->>'is_home' <> 'true' or r1->>'unconquerable' <> 'true' then
    raise exception '8653 ASSERTION FAILED: home claim must set is_home + unconquerable';
  end if;
  select count(*) into n
    from public.owned_planets
   where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and is_home;
  if n <> 1 then
    raise exception '8653 ASSERTION FAILED: expected exactly 1 home row, got %', n;
  end if;
end $$;

-- 2. Two claims of the same planet -> ONE winner. A owns 'alpha'; B
--    proposes the same name and must get the clean conflict.
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare
  r jsonb;
  n bigint;
begin
  select public.claim_home_planet('alpha', 1) into r;
  if r->>'claimed' <> 'false' or r->>'reason' <> 'planet_taken' then
    raise exception '8653 ASSERTION FAILED: second claimant must get planet_taken, got %', r;
  end if;
  select count(*) into n from public.owned_planets where planet_name = 'alpha';
  if n <> 1 then
    raise exception '8653 ASSERTION FAILED: planet must have exactly 1 owner, got %', n;
  end if;
end $$;

-- 3. claim_colony: no home planet -> raises (no context to colonise from).
do $$
begin
  begin
    perform public.claim_colony('zeta', 1);
    raise exception '8653 ASSERTION FAILED: claim_colony with no home must raise';
  exception
    when others then
      if sqlerrm !~ 'requires a claimed home' then raise; end if;
  end;
end $$;

-- B claims a home, then colonies: colony shape, D3 unknown-name acceptance,
-- double-colony rejection, cross-owner rejection, NULL-name rejection.
do $$
declare r jsonb;
begin
  select public.claim_home_planet('beta', 1) into r;
  if r->>'planet_name' <> 'beta' then
    raise exception '8653 ASSERTION FAILED: B home claim failed: %', r;
  end if;

  -- colony on an unclaimed, catalogue-unknown name SUCCEEDS (D3 tradeoff:
  -- the server enforces uniqueness, not catalogue membership).
  select public.claim_colony('zeta', 1) into r;
  if r->>'planet_name' <> 'zeta' or r->>'is_home' <> 'false'
     or r->>'unconquerable' <> 'false' or r->>'population' <> '0' then
    raise exception '8653 ASSERTION FAILED: colony row shape wrong: %', r;
  end if;

  -- double-colony on a planet the caller already owns -> planet_taken.
  select public.claim_colony('zeta', 1) into r;
  if r->>'claimed' <> 'false' or r->>'reason' <> 'planet_taken' then
    raise exception '8653 ASSERTION FAILED: double-colony must be planet_taken, got %', r;
  end if;

  -- colonising a planet owned by another player -> planet_taken.
  select public.claim_colony('alpha', 1) into r;
  if r->>'reason' <> 'planet_taken' then
    raise exception '8653 ASSERTION FAILED: colonising A-owned planet must be planet_taken, got %', r;
  end if;

  -- NULL planet name is rejected by the NOT NULL column guard.
  begin
    perform public.claim_colony(null, 1);
    raise exception '8653 ASSERTION FAILED: claim_colony(NULL) must raise not-null violation';
  exception
    when not_null_violation then null; -- expected
  end;
end $$;

-- 4. anon sees ZERO owned_planets rows: no anon grant (audit §3.1) ->
--    permission-denied (42501) is the enforcement.
set local role anon;
do $$
begin
  begin
    perform count(*) from public.owned_planets;
    raise exception '8653 ASSERTION FAILED: anon must be denied SELECT on owned_planets';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;
set local role postgres;

-- 5. anon cannot EXECUTE the claim RPCs (no EXECUTE grant, audit §3.1/§8).
set local role anon;
do $$
begin
  begin
    perform public.claim_home_planet('anon-probe', 1);
    raise exception '8653 ASSERTION FAILED: anon must not invoke claim_home_planet';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;
set local role postgres;

-- 6. authenticated CAN EXECUTE the claim RPCs (the real client path). A
--    already owns 'alpha', so this proves the grant on the idempotent path.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare r jsonb;
begin
  select public.claim_home_planet('alpha', 2) into r;
  if r->>'planet_name' <> 'alpha' then
    raise exception '8653 ASSERTION FAILED: authenticated EXECUTE grant broken: %', r;
  end if;
end $$;
set local role postgres;

rollback;
