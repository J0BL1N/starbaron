READ-ONLY AUDIT — StarBaron P2-T04 (master roadmap): Planet Ownership.

READ LIST:
- src/sim/player/ownership.ts      (NEW — under audit)
- tests/ownership.test.ts          (NEW — test suite)
- supabase/migrations/0015_ownership_audit.sql (NEW — write-only migration)
- supabase/tests/09_ownership_audit.sql        (NEW — contract tests)
- supabase/migrations/0014_home_world_protection.sql (protection trigger — interaction)
- supabase/migrations/0001_players_owned_planets.sql (owned_planets)
- src/sim/world/identity.ts (BodyId, parseCanonicalId)
- src/sim/player/protection.ts (P2-T03)

AUTHORISED SCOPE: ONLY the four new files. AUDIT TARGET = COMMIT 5ed730a993358105ddedd698f58f4fda0d86b2eb (`git show --stat` adds exactly those four). Docs/working tree OUT OF SCOPE. No existing file modified. Write-only: no supabase invocation anywhere in deliverable/commit.

TASK SPEC (docs/briefs/p2-t04-brief.md + master roadmap P2-T04):
1. ownership.ts: OwnershipRecord/OwnershipEvent; ownershipFor validates (acquiredAt finite>0, owner non-empty, previousOwnerId !== ownerId, method union, isHome → 'home-assignment', unconquerable → isHome); transferOwnership throws on unconquerable/self-transfer/invalid, immutable, returns record + event; historyAppend immutable; ownershipHistory filtered oldest-first; currentOwner last-event resolution.
2. 0015: ownership_audit table (identity PK, method CHECK, at_ms, non-canonical created_at documented), (body_id, at_ms) index, AFTER INSERT OR UPDATE OF owner_id trigger (home-assignment on insert, conquest on IS DISTINCT FROM change), RLS locked + revoked, idempotent.
3. 09: insert audits, transfer audits, protected-transfer writes NO row, no-op self-transfer/no non-owner update → no row, anon denied, re-run contract.

CHECK:
A. Model purity/imports; no banned tokens in comments; no `any`; no wall-clock.
B. Validation completeness (every rule above); transferOwnership protection integration (unconquerable throws — consistent with deriveProtection); immutability.
C. History semantics: order (at then input order), filter by bodyId, currentOwner correctness (incl. null on empty).
D. 0015 trigger correctness: INSERT → home-assignment; owner change → conquest; IS DISTINCT FROM guard (no audit on no-op); interaction with 0014 (blocked transfer → no row); RLS/grants locked; idempotency.
E. 09 tests cover the checklist in repo style; anon denial.
F. Tests ~22+ cover model; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
