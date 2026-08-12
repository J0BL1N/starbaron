READ-ONLY AUDIT — StarBaron P2-T01 (master roadmap): Player Profile.

READ LIST:
- src/sim/player/profile.ts   (NEW — under audit)
- tests/profile.test.ts       (NEW — test suite under audit)
- src/sim/player/types.ts     (existing PlayerState — must NOT be modified)
- src/sim/world/identity.ts   (P1-T01: BodyId, parseCanonicalId — withHomeWorld dependency)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 913c8e3c7d214a1113918f4e2dff54a39cb6b5b3 (`git show --stat` adds exactly src/sim/player/profile.ts + tests/profile.test.ts). Docs/working tree OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p2-t01-brief.md + master roadmap P2-T01):
1. PlayerProfile { playerId (<=64, trimmed), displayName (1-32, no control chars), empireName (2-32, no control chars), joinedAt (input, finite > 0), settings { theme 'dark'|'light' (default dark), reducedMotion bool (default false), notificationsEnabled bool (default true) }, progression { xp >= 0 int, level = floor(xp/100)+1, achievementsUnlocked unique }, homeWorld?: BodyId, generationVersion = 1 }.
2. createPlayerProfile validates (throws descriptive Error on violations); validateProfile returns {ok, problems}; levelFromXp pure; withHomeWorld immutable + parseCanonicalId-validated.
3. Purity: no Date.now/random/global-state/module-mutable-state; no `any`; imports only ../world/identity types/helpers + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Validation completeness: every rule above enforced in create (throw) + validate (problems) — name lengths/control chars, joinedAt NaN/<=0, xp < 0, level/xp consistency, dup achievements, homeWorld parse.
C. levelFromXp math (0→1, 99→1, 100→2, 1000→11).
D. withHomeWorld immutable (input not mutated), valid BodyId accepted, invalid throws.
E. Determinism: same input → deep-equal profile.
F. Tests ~27 covering the above; vitest conventions; imports resolve; no `any`.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
