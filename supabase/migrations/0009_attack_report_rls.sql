-- =====================================================================
-- 0009_attack_report_rls (CORRECTION ROUND 3)
-- Purpose   : P3-T02-B — hide the attack_report jsonb (full attack
--             details: members, casualties, defender, winner) from direct
--             table reads by authenticated. The 0004 SELECT policy
--             (attacks_participants_and_open) lets the CURRENT owner of
--             the target planet read attack rows, and 0004's table-level
--             `grant select on public.attacks to authenticated` exposes
--             EVERY column — including the sensitive attack_report. After
--             a LATER conquest the new owner IS the current owner, so they
--             could read a prior attack's full report directly from the
--             table, bypassing get_attack()'s RPC gate (0008, which
--             already restricts the launcher / ORIGINAL defender / member
--             response correctly).
-- WHY ROUND 2 FAILED (Codex re-audit FAIL): PostgreSQL column privileges
--             do NOT subtract from a table-level grant. Round 2 ran
--             `revoke select (attack_report) on table public.attacks from
--             authenticated` while 0004:75 STILL held `grant select on
--             table public.attacks to authenticated`. The table-level
--             grant continues to authorize every column, so the column-
--             level REVOKE was a silent no-op: the guard at :41 evaluated
--             has_column_privilege(...) = true and aborted the migration;
--             if the guard were removed the column would STILL leak.
-- FIX (round 3): column privileges ACCUMULATE, so:
--             1. revoke select on table public.attacks from authenticated
--                (drop the table-level grant entirely — a column REVOKE
--                cannot subtract it);
--             2. grant select (<every column EXCEPT attack_report>) on
--                public.attacks to authenticated — re-grant column-by-
--                column. Each column grant is independent and additive, so
--                the role regains exactly the pre-existing table read path
--                minus the report column. This is the CORRECT mechanism:
--                column privileges DO accumulate (GRANT docs §5.8: "A user
--                may perform SELECT ... on a column if they hold that
--                privilege for either the specific column or its whole
--                table").
--             The report column is then unreachable via the table for ANY
--             authenticated role; it is ONLY delivered through the SECURITY
--             DEFINER get_attack() / get_player_state() gates (launcher /
--             ORIGINAL defender / member). Those definer RPCs run as the
--             table OWNER, who bypasses column privileges entirely (owners
--             always hold all privileges, GRANT docs), so get_attack() is
--             unaffected — same for resolve_due_attacks / launch / join /
--             resolve and service_role. Row-level visibility from 0004 is
--             unchanged: the current owner still sees the attack row, just
--             not the report column.
-- Idempotent: YES. The guard asserts the END state (attack_report NOT
--             selectable by authenticated): after a re-run the revoke is a
--             no-op and the re-grant already holds, so the guard still
--             passes. Forward-only: 0004 is applied, so the grant is
--             corrected here rather than editing 0004.
-- Date      : 2026-08-09
-- Scope     : ONE table-level revoke + ONE column-list re-grant on
--             public.attacks. No RLS policies, functions, or signatures
--             change.
-- =====================================================================

revoke select on table public.attacks from authenticated;

grant select (
  id,
  target_planet_name,
  launcher_id,
  status,
  outcome,
  winner_id,
  launched_at,
  join_window_seconds,
  travel_seconds,
  resolves_at,
  resolved_at,
  defender_id
) on public.attacks to authenticated;

-- Belt-and-braces: assert the END state (idempotent — checks that the
-- column is NOT selectable by authenticated after the revoke+re-grant, so
-- a re-run of the migration still passes). Guards against both regressions
-- in one assertion: a re-granted table-level SELECT, or a re-granted
-- column-level SELECT on attack_report. Positive side asserts the re-grant
-- actually took (a representative non-report column stays readable), so a
-- botched column list fails loudly here rather than silently at runtime.
do $$
begin
  if has_column_privilege('authenticated', 'public.attacks', 'attack_report', 'SELECT') then
    raise exception '0009 guard failed: authenticated still holds SELECT on public.attacks.attack_report';
  end if;
  if not has_column_privilege('authenticated', 'public.attacks', 'id', 'SELECT') then
    raise exception '0009 guard failed: column-level re-grant did not take (public.attacks.id not selectable)';
  end if;
end
$$;
