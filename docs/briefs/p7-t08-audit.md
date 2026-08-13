READ-ONLY AUDIT — StarBaron P7-T08 (master roadmap): Home-World Immunity.

READ LIST:
- src/sim/combat/home-immunity.ts        (NEW — under audit)
- tests/home-immunity.test.ts            (NEW — test suite)
- supabase/migrations/0019_home_immunity.sql  (NEW — write-only)
- supabase/tests/13_home_immunity.sql         (NEW — write-only)
- src/sim/player/protection.ts           (P2-T03: the LOCKED home-world predicate)
- supabase/migrations/0014_home_world_protection.sql (the mirrored RLS style)

AUTHORISED SCOPE: ONLY those four new files. AUDIT TARGET = COMMIT 7f2ab7d118ac675b8724649ff59367f40c5a5f1c (`git show --stat` adds exactly those four). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t08-brief.md + master roadmap P7-T08):
1. HomeImmunity { targetId, isHome, status immune|attackable, reason, attemptedAt } — homeImmunityFor DELEGATES the home-world truth to protection.ts (the LOCKED predicate); unowned (ownerPlayer null) → attackable.
2. guardLaunch { allowed, immunity } — allowed = !isHome; assertConquestPermitted throws on home (Error) / no-op otherwise — the launch-layer + resolution-layer guards.
3. SQL 0019 (write-only): mirrors 0014's style — a trigger/check rejecting attack/combat rows whose target is its owner's home world; probes in 13 (home-world attack insert FAILS; non-home SUCCEEDS).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ player/protection + player/types + ui/validate + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Home-world truth delegated to the locked protection predicate (verify the call + semantics: owner's home world → immune; unowned → attackable).
C. guardLaunch + assertConquestPermitted semantics (throw on home; no-op otherwise).
D. SQL mirror: 0019 consistent with 0014's trigger/RLS conventions; 13 probes assert the home-world rejection + non-home acceptance; write-only (no application).
E. Tests ~26 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
