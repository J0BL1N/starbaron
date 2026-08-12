READ-ONLY AUDIT — StarBaron P1-T01 (master roadmap): Canonical Object Identity.

READ LIST (every file the implementation touches or references):
- src/sim/world/identity.ts         (NEW — implementation under audit)
- tests/identity.test.ts            (NEW — test suite under audit)
- src/sim/planets/hash.ts           (fnv1a — the only imported dependency)
- src/sim/planets/types.ts          (existing PlanetIdentity type — must NOT be conflated)
- tsconfig.json / vitest.config.ts  (strict mode, test runner config)

AUTHORISED SCOPE: ONLY the two new files above. The implementer was forbidden from modifying any existing file — verify no existing file was touched (the diff is exactly: add src/sim/world/identity.ts, add tests/identity.test.ts).

TASK SPEC (from docs/MASTER-ROADMAP.md P1-T01 and the brief docs/briefs/p1-t01-brief.md):
1. BodyType = 'star' | 'planet' | 'moon' | 'asteroid'.
2. Canonical ID strings: gal:<slug> / sys:<galaxySlug>|<systemSeed> / body:<galaxySlug>|<systemSeed>|<bodyType>|<ordinal>.
3. Branded types GalaxyId/SystemId/BodyId + CanonicalId union; SystemRef/BodyRef parent-child chains.
4. Pure functions: galaxyId, systemId, bodyId, parseCanonicalId (never throws; {ok:true,...}|{ok:false,reason}), parentOf (body->system->galaxy), idSeed = fnv1a(id).
5. Determinism: no Math.random anywhere; same input -> same ID/seed; IDs survive reloads by construction.
6. Round-trip invariants must hold (parse back to identical segments; parentOf chains exact).

CHECK THESE SPECIFIC THINGS:
A. Determinism & purity — grep for Math.random / Date.now / crypto / global state in identity.ts. MUST be none.
B. parseCanonicalId — rejects: empty, missing segments, invalid body type, bad ordinal (negative/NaN/decimal/empty), extra segments, unknown prefix. Never throws for any string input.
C. Branded types actually used (not just declared) — return types are branded; assignment compiles.
D. parentOf correctness — body->its system, system->its galaxy, galaxy->null; SystemRef/BodyRef fields consistent with the string segments.
E. idSeed === fnv1a(id) and stable.
F. Round-trip tests cover all 4 body types + galaxy + system; malformed tests cover >= 8 distinct cases.
G. No import cycle: identity.ts must not import from sim/world siblings (none exist) — verify it only imports ../planets/hash and types.
H. Test file matches repo conventions (vitest, tests/ dir), and the suite is actually runnable (imports resolve).

DO NOT: modify anything, run the test suite (sandbox blocks it), invent capabilities not in the files.

REPLY FORMAT: PASS or FAIL. If FAIL, list concrete findings as numbered items, each with file:line and the specific violation (deterministic fix language, no broadened scope). If PASS, state the key invariants you verified.
