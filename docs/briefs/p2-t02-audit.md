READ-ONLY AUDIT — StarBaron P2-T02 (master roadmap): Home-World Assignment.

READ LIST:
- src/sim/player/assignment.ts  (NEW — under audit)
- tests/assignment.test.ts      (NEW — test suite under audit)
- src/sim/player/profile.ts     (P2-T01: withHomeWorld — dependency)
- src/sim/world/identity.ts     (P1-T01: BodyId, bodyId, idSeed, parseCanonicalId)
- src/sim/player/claim.ts       (existing claim logic — must NOT be modified)
- src/sim/data/planets.ts       (PLANETS catalogue)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT a3a53a4d2cfc050f2a323b4d53c415b01fd8e19c (`git show --stat` adds exactly src/sim/player/assignment.ts + tests/assignment.test.ts). Docs/working tree OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p2-t02-brief.md + master roadmap P2-T02):
1. eligibleHomeBodies(planets): deterministic eligible set of 6,321 real catalogue planet body ids (type 'planet'), derived identically to buildCatalogueMapping (hostGroupIndex exported); all ids parse as body/planet.
2. selectHomeWorld({playerId, eligible, taken, salt?}): deterministic probing (fnv1a base + per-attempt re-hash, max 3×n); never returns a taken id; exhaustion → {ok:false, reason:'exhausted'}; empty eligible → 'invalid-eligible-set'; same inputs → same result.
3. assignHomeWorld(profile, result): immutable (withHomeWorld) on ok, unchanged on not-ok.
4. resolveExistingHome(profile, taken): 'not-assigned' | 'home-not-in-taken' | ok.
5. Purity: no Date.now/random/module-mutable-state/global-state; no `any`; imports only ../world/identity, ../planets/hash (fnv1a), ../data/planets types, ../player/profile types.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. eligible set: count 6321 (real catalogue), determinism, all parse as body/planet, parity with buildCatalogueMapping's body construction (same system id derivation).
C. selectHomeWorld: determinism (deep-equal ×2 incl. probing path); collision — taken base index → different non-taken result; exhaustion (taken = all) → ok:false 'exhausted'; empty → 'invalid-eligible-set'; bounded attempts (no infinite loop on pathological taken sets).
D. assignHomeWorld immutability; resolveExistingHome three states.
E. The power-of-two probing subtlety: verify the documented behaviour (same-base players converge at 2^k sizes; distinct at odd sizes) is at least consistent with the tests and honestly documented (no false claims).
F. Tests ~28 covering the above; vitest conventions; imports resolve; no `any`.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
