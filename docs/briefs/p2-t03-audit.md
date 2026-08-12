READ-ONLY AUDIT — StarBaron P2-T03 (master roadmap): Home-World Protection.

READ LIST:
- src/sim/player/protection.ts      (NEW — under audit)
- tests/protection.test.ts          (NEW — test suite)
- supabase/migrations/0014_home_world_protection.sql (NEW — write-only migration)
- supabase/tests/08_home_world_protection.sql        (NEW — contract tests)
- supabase/migrations/0001_players_owned_planets.sql (owned_planets: is_home/unconquerable/one-home index)
- supabase/migrations/0005_attack_rpcs.sql (conquest flow reference)
- src/sim/world/identity.ts (BodyId)
- src/sim/player/types.ts (OwnedPlanet)

AUTHORISED SCOPE: ONLY the four new files. AUDIT TARGET = COMMIT 03e4db505ad3346fcac38e47a06f0aa9ea048eba (`git show --stat` adds exactly those four). Docs/working tree OUT OF SCOPE. No existing file modified. SQL must remain write-only (no supabase invocation anywhere in the deliverable or commit message).

TASK SPEC (docs/briefs/p2-t03-brief.md + master roadmap P2-T03):
1. protection.ts: deriveProtection (protected = isHome && unconquerable; protectedSince caller-supplied), attemptedConquest (rejected for any protected target incl. owner), conquestAllowed, protectionStateForUi ('Unconquerable home world'/'Conquerable'). Pure, deterministic, immutable, no wall-clock.
2. 0014: BEFORE UPDATE OR DELETE trigger on owned_planets raising on owner-transfer/delete of unconquerable rows (OLD-keyed); non-ownership updates + no-op self-transfers pass; idempotent constructs; header documents design + attack-RPC interaction + cascade nuance.
3. 08: transfer raises + row untouched, population update allowed, delete raises, conquerable transfer allowed, self-transfer legal, anon denied (42501), re-run contract.

CHECK:
A. protection.ts purity/imports; no banned tokens in comments; no `any`.
B. deriveProtection logic — ONLY isHome && unconquerable protects; attemptedConquest rejects owner too; conquestAllowed inverts; labels exact.
C. 0014 trigger correctness: fires on UPDATE (owner_id changed) and DELETE of unconquerable rows; does NOT fire for non-owner columns; no-op self-transfer allowed; idempotency (re-run safe); trigger function SECURITY considerations (uses OLD — correct).
D. 08 tests match repo style (DO blocks, exception when X then null, no-persist count checks); cover the checklist; anon denial.
E. Write-only: no supabase commands anywhere.
F. Tests ~20 cover the model; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
