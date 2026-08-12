-- =====================================================================
-- 0015_ownership_audit
-- Purpose   : P2-T04-B persistence for planet ownership — the ownership_audit
--             table is the audit trail behind src/sim/player/ownership.ts.
--             OwnershipRecord.acquiredAt / OwnershipEvent map 1:1 onto a
--             row: body_id, from_owner_id (null for a first ownership),
--             to_owner_id, method (the AcquisitionMethod union), and at_ms
--             (epoch milliseconds — the unit of the pure model).
--             body_id TEXT carries owned_planets.planet_name — the CURRENT
--             persistence key of a world (UNIQUE in 0001). A canonical BodyId
--             ('body:<galaxySlug>|<systemSeed>|<type>|<ordinal>',
--             0013 world_bodies.id) is NOT yet linked to owned_planets; when a
--             future migration joins them, this column's content is re-
--             provisioned to the canonical id. OwnershipRecord.bodyId is the
--             canonical id; this column stores what owned_planets stores today.
--             No FK on from/to owner columns: the audit is HISTORICAL and must
--             survive a player row's later removal (and the home world is
--             protected against deletion by 0014 anyway).
-- MECHANISM : one AFTER INSERT OR UPDATE OF owner_id, FOR EACH ROW trigger on
--             public.owned_planets. The UPDATE column-list form means the
--             trigger fires ONLY when an UPDATE statement names owner_id in
--             its SET list — population/garrison/fleet/structure_levels writes
--             (accrual, build_structure) never reach it.
--               * INSERT -> one audit row: from_owner_id NULL, to NEW.owner_id,
--                 method 'home-assignment'. (The pure model tags colonies
--                 'colonisation'; the trigger keys on the ROW TRANSITION and
--                 keeps the mapping simple — an insert is a first ownership,
--                 which in the claim RPCs is exactly the home-claim path. See
--                 the documented simplification in tests/09.)
--               * UPDATE -> one audit row when NEW.owner_id IS DISTINCT FROM
--                 OLD.owner_id (mirror of 0014's no-op self-transfer rule, so
--                 a SET owner_id = owner_id statement writes nothing): from
--                 OLD.owner_id, to NEW.owner_id, method 'conquest' (the generic
--                 change-of-hands method; trade/colonisation tagging stays
--                 with the application layer for now).
--             at_ms := floor(extract(epoch from now()) * 1000)::bigint — the
--             persistence layer is the ONE place a wall clock is legitimately
--             read; the pure model never reads one.
-- 0014 INTERACTION : 0014's BEFORE UPDATE OR DELETE guard raises on any
--   owner_id change of an unconquerable row. Because it is a BEFORE trigger,
--   the raise aborts the statement BEFORE this AFTER trigger can run — a
--   blocked home-world transfer therefore writes NO audit row. Ordering is
--   guaranteed by Postgres trigger semantics: BEFORE triggers always fire
--   before AFTER triggers on the same event, so the audit can never record a
--   transfer the protection guard rejected.
-- LOCKDOWN : RLS enabled + FORCE with NO policies, ALL privileges revoked from
--   public, anon AND authenticated (mirror of the 0013 world tables): the
--   audit is backend-write / backend-read only (service_role / postgres).
--   No client read policies ship until a task authorises exposing audit data.
-- created_at TIMESTAMPTZ DEFAULT now() is NON-CANONICAL persistence metadata
--   (operational tracing only), excluded from the pure model — the canonical
--   timestamp is at_ms.
-- Idempotent: YES for the trigger constructs + table + index (CREATE TABLE /
--   INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS +
--   CREATE TRIGGER, ALTER RLS enable/force and REVOKE are no-ops on re-run) —
--   the 09 suite's re-run contract probes this. Forward-only overall: runs
--   once on staging after 0014.
-- Date      : 2026-08-12
-- Scope     : 1 new table + 1 index + 1 internal trigger function + RLS
--             enables + revokes. No changes to existing objects. No RPCs.
-- =====================================================================

create table if not exists public.ownership_audit (
  id             bigint generated always as identity primary key,
  body_id        text not null,
  from_owner_id  uuid,
  to_owner_id    uuid not null,
  method         text not null check (method in ('home-assignment','colonisation','conquest','trade')),
  at_ms          bigint not null check (at_ms > 0),
  -- Non-canonical persistence metadata (see header): operational tracing only.
  created_at     timestamptz not null default now()
);

create index if not exists ownership_audit_body_at_idx on public.ownership_audit (body_id, at_ms);

-- AFTER INSERT OR UPDATE OF owner_id: fires after the row transition is final,
-- so 0014's BEFORE guard runs first and a rejected transfer never reaches the
-- log. SECURITY INVOKER is sufficient — only postgres (migration), service_role
-- (BYPASSRLS) or SECURITY DEFINER RPCs can write owned_planets today.
create or replace function public.owned_planets_audit_logger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ownership_audit (
      body_id, from_owner_id, to_owner_id, method, at_ms
    ) values (
      new.planet_name, null, new.owner_id, 'home-assignment',
      floor(extract(epoch from now()) * 1000)::bigint
    );
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into public.ownership_audit (
      body_id, from_owner_id, to_owner_id, method, at_ms
    ) values (
      new.planet_name, old.owner_id, new.owner_id, 'conquest',
      floor(extract(epoch from now()) * 1000)::bigint
    );
  end if;
  return new;
end;
$$;

revoke all on function public.owned_planets_audit_logger() from public, anon, authenticated;

drop trigger if exists owned_planets_ownership_audit on public.owned_planets;
create trigger owned_planets_ownership_audit
  after insert or update of owner_id on public.owned_planets
  for each row
  execute function public.owned_planets_audit_logger();

-- =====================================================================
-- RLS + grants: locked down, mirror of the 0013 world tables. RLS enabled +
-- FORCE (the table owner stays subject to RLS) with NO policies, and every
-- client role stripped — backend (service_role / postgres) writes and reads
-- only, until a later task authorises exposing audit data.
-- =====================================================================

alter table public.ownership_audit enable row level security;
alter table public.ownership_audit force row level security;

revoke all on table public.ownership_audit from public, anon, authenticated;
