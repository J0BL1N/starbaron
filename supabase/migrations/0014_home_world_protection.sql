-- =====================================================================
-- 0014_home_world_protection
-- Purpose   : Make the DESIGN §5 "unconquerable home planet" decision hold
--             at the DATABASE level, not just in the application layer.
--             launch_attack() already rejects unconquerable targets before
--             an attack can even form (0005/0012 anti-grief guard); this
--             trigger is the backend enforcement BACKSTOP — a row marked
--             unconquerable can never change owner and can never be deleted,
--             no matter which path attempts it (a future RPC, a service_role
--             script, or a corrupt in-flight state reaching the resolver).
--             DESIGN §6: "Unconquerable home planet | Never a total loss".
--             The conquest transfer in resolve_attack() (owner_id := winner,
--             is_home := false, unconquerable := false) can therefore never
--             land on a home: launch is blocked upstream AND the trigger
--             aborts the resolution transaction if an unconquerable row is
--             ever presented to it — defense in depth.
-- MECHANISM : one BEFORE UPDATE OR DELETE, FOR EACH ROW trigger on
--             public.owned_planets. It raises when
--               * an UPDATE would change owner_id of a row where OLD has
--                 unconquerable = true (the check keys on the PRE-UPDATE
--                 flag, so a conquest can never first clear the flag on the
--                 same statement — new.unconquerable is irrelevant);
--               * a DELETE removes a row where OLD has unconquerable = true.
--             `new.owner_id IS DISTINCT FROM old.owner_id` keeps no-op
--             self-transfers (owner_id = owner_id) legal and lets every
--             OTHER column update pass untouched — population, garrison,
--             fleet, structure_levels, even is_home flips (one-home stays
--             enforced by the 0001 partial unique index) are NOT blocked.
--             A no-op UPDATE that does not change owner_id fires the trigger
--             but never raises, so build_structure()'s grid writes and the
--             accrual paths are unaffected.
--             CASCADE note: the players FK (owner_id ... on delete cascade)
--             means deleting a player row cascades here. The guard raises on
--             that too — there is no account-deletion RPC in v1, and "keep
--             your home planet forever" (DESIGN §5) reads exactly this way.
--             Revisit only if a delete-account flow is added later.
-- Idempotent: YES for the guard itself — CREATE OR REPLACE FUNCTION +
--             DROP TRIGGER IF EXISTS + CREATE TRIGGER re-run cleanly (the
--             08 suite's re-run contract probes this). The migration is
--             forward-only overall (runs once on staging after 0013).
-- Date      : 2026-08-12
-- Scope     : one internal trigger function (no table/schema change, no new
--             client grants). Function EXECUTE is revoked from public/anon
--             for hygiene (trigger invocation does not need it).
-- =====================================================================

create or replace function public.owned_planets_home_world_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and old.unconquerable then
    raise exception 'cannot delete unconquerable home world: %', old.planet_name;
  end if;
  if tg_op = 'UPDATE'
     and old.unconquerable
     and new.owner_id is distinct from old.owner_id then
    raise exception 'cannot transfer unconquerable home world: %', old.planet_name;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.owned_planets_home_world_guard() from public, anon;

drop trigger if exists owned_planets_home_world_guard on public.owned_planets;
create trigger owned_planets_home_world_guard
  before update or delete on public.owned_planets
  for each row
  execute function public.owned_planets_home_world_guard();
