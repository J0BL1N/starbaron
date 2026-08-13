READ-ONLY AUDIT — StarBaron P5-T10 (master roadmap): Fleet Persistence.

READ LIST:
- src/sim/fleet/persistence.ts      (NEW — under audit)
- tests/persistence.test.ts         (NEW — test suite)
- src/sim/fleet/fleet.ts, orders.ts, routes.ts (P5-T03/T07/T09)
- supabase/migrations/0017_fleets.sql   (NEW — write-only, under audit)
- supabase/tests/11_fleets.sql          (NEW — write-only, under audit)
- supabase/migrations/0001/0002/0004 + 0016 (conventions: players(id) uuid FK, text+CHECK enums, RLS owner-gate + child-subquery patterns)

AUTHORISED SCOPE: ONLY the four new files. AUDIT TARGET = COMMIT 22c7cb41246d94a36c025da81f2e15c5565f5c82 (`git show --stat` adds exactly those four). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t10-brief.md + master roadmap P5-T10):
1. FleetSnapshot { fleet, orders|null, routes[] }; serializeFleetSnapshot (deterministic, hand-ordered keys, null-not-undefined, validate-then-serialize); deserializeFleetSnapshot (strict parse, deep shape pass, invariant re-check, round-trip deep-equal); snapshotInvariants (fleet + orders + route shape + cross-fleet checks).
2. SQL 0017: fleet/fleet_order/fleet_route tables (owner FK → public.players(id) — the repo's actual table; text+CHECK enums; indexes; RLS owner-gate + child subquery per 0004 pattern; forward-only, no IF NOT EXISTS policies).
3. SQL 11: begin/rollback test with RLS behavior asserts + CHECK-violation asserts (do $$ blocks for exception tests).
4. Purity (TS): no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ fleet/* + stdlib. SQL: write-only, never applied.

CHECK:
A. TS purity + imports; no banned tokens in comments.
B. Round-trip (canonical snapshot deep-equal; null orders; empty/multi routes); byte-determinism; invalid rejection (malformed JSON, shape violations, invariant violations incl. cross-fleet mismatch).
C. SQL: FK/table/column types match repo conventions (players(id) uuid — verify against 0001); CHECK constraints; indexes; RLS policies shape (owner-gate + child subquery recursion-avoidance); test file structure (transaction, rollback, do $$ blocks).
D. SQL never applied (write-only — confirm the files are deliverable artifacts only).
E. Tests covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; apply SQL; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
