READ-ONLY AUDIT — StarBaron P6-T01 (master roadmap): Intel Permission Model.

READ LIST:
- src/sim/intel/permissions.ts   (NEW — under audit)
- tests/permissions.test.ts      (NEW — test suite)
- src/sim/ui/info.ts             (P4-T03: InfoLevel, the corrected owner-top hierarchy)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 1019c3415023a3bdc59583a5eaeacae58aac52f3 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t01-brief.md + master roadmap P6-T01):
1. ViewerContext { viewerId, alliances[], isAdmin? }; TargetContext { targetId, ownerId|null, ownerAlliances[], isHome? }; PermissionResult { level, allowed, reason owner|alliance|intel|public|admin|denied }.
2. RELATIONSHIP-EXCLUSIVE granted-set model (the correct semantics — NOT a rank ladder): admin/owner → all levels; alliance member (non-owner) → {public, alliance}; stranger → {public, intel}; unowned → {public}; permissionFor denies requests above the granted set (allowed false, reason denied, level = effective); effectiveLevelFor returns the max granted level; intelGrants.canSee per-level membership consistent with permissionFor.
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ ui/info (types) + stdlib; banned comment tokens absent.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Granted-set semantics: owner all; admin override; alliance {public, alliance} (NOT intel/owner); stranger {public, intel} (NOT alliance/owner); unowned {public}; requested-above-set → denied with context.
C. effectiveLevelFor ordering (owner > alliance? NO — verify the SET semantics: stranger effective = intel; alliance effective = alliance — the max granted level per the set, not a global rank); intelGrants consistency with permissionFor (cross-check).
D. Validation (empty viewerId); determinism; no mutation.
E. Tests ~34 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
