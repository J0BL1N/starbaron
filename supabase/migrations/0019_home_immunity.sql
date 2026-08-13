-- =====================================================================
-- 0019_home_immunity (P7-T08 — WRITE-ONLY, deferred to Jay, NEVER applied)
-- Purpose   : Make the DESIGN §5 "unconquerable home planet" decision hold
--             at the ATTACK layer of the database, not only in the
--             application layer and the ownership-transfer guard (0014).
--             0005's launch_attack() already rejects an unconquerable target
--             before an attack can form, and 0014 blocks the ownership
--             transfer; this trigger is the backend enforcement BACKSTOP for
--             the attack row itself — an attack whose target is the target
--             owner's home world can never be INSERTed or re-targeted, no
--             matter which path attempts it (a future RPC, a service_role
--             script, or a corrupt in-flight state reaching the resolver).
--             DESIGN §6: "Unconquerable home planet | Never a total loss".
--             A direct attacks INSERT on a home world therefore fails HERE,
--             in addition to the RPC layer — defense in depth.
-- MECHANISM : one BEFORE INSERT OR UPDATE OF target_planet_name trigger on
--             public.attacks (the attack/conquest header row, 0004). It keys
--             on the SAME flag as the layers above and below — the target
--             owned_planets row's unconquerable (= is_home at claim, exact
--             parity enforced by the 0016 CHECK) — and raises when that flag
--             is true. The column-restricted trigger form (UPDATE OF
--             target_planet_name) lets every OTHER column update pass
--             untouched — status, outcome, winner_id, resolved_at, the
--             resolve transition — exactly like 0014 lets non-ownership
--             updates pass. The target FK (target_planet_name -> owned_planets
--             planet_name) guarantees the referenced row exists before the
--             trigger runs; `if found` guards the degenerate case anyway.
-- Idempotent: YES for the guard itself — CREATE OR REPLACE FUNCTION +
--             DROP TRIGGER IF EXISTS + CREATE TRIGGER re-run cleanly (the
--             13 suite's re-run contract probes this). The migration is
--             forward-only overall.
--             WRITE-ONLY: shipped for review only and NEVER applied without
--             Jay's explicit authorisation (the 0017 fleets convention).
-- Date      : 2026-08-13
-- Scope     : one internal trigger function (no table/schema change, no new
--             client grants). Function EXECUTE is revoked from public/anon
--             for hygiene (trigger invocation does not need it).
-- =====================================================================

create or replace function public.attacks_home_immunity_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_unconquerable boolean;
begin
  select unconquerable
    into v_unconquerable
    from public.owned_planets
   where planet_name = new.target_planet_name;
  if found and v_unconquerable then
    raise exception 'cannot attack unconquerable home world: %', new.target_planet_name;
  end if;
  return new;
end;
$$;

revoke all on function public.attacks_home_immunity_guard() from public, anon;

drop trigger if exists attacks_home_immunity_guard on public.attacks;
create trigger attacks_home_immunity_guard
  before insert or update of target_planet_name on public.attacks
  for each row
  execute function public.attacks_home_immunity_guard();
