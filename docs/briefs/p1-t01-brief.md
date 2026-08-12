TASK (StarBaron P1-T01, master roadmap): Implement CANONICAL OBJECT IDENTITY for the universe foundation.

CONTEXT — existing code you may READ but must NOT modify:
- src/sim/planets/hash.ts exports fnv1a(input: string): number (FNV-1a 32-bit, deterministic).
- src/sim/planets/types.ts has PlanetIdentity (a VISUAL PROFILE — not an ID; do not conflate).
- src/sim/player/claim.ts assigns planets via fnv1a('starbaron-claim-v1|playerId') % PLANETS.length.
- src/ui/planetgen3d/ uses seeded generators keyed by string seeds (galaxy 'HD-564', systems `${seed}|sys`, bodies `${seed}|moonN`).
- TS strict mode is on repo-wide; vitest is the test runner (tests/ dir, vitest.config.ts).

ALLOWED FILES (create ONLY these two):
- src/sim/world/identity.ts  (new folder src/sim/world/)
- tests/identity.test.ts

RESTRICTIONS:
- Do NOT modify or delete ANY existing file. Import fnv1a via the correct relative path from src/sim/planets/hash.ts (verify it compiles).
- NO Math.random anywhere — every ID is a pure deterministic function of string inputs.
- No UI wiring, no DB/backend changes, no rendering changes, no Supabase.
- No `any`. No untyped objects. Strict TS.

DESIGN SPEC:
1. BodyType = 'star' | 'planet' | 'moon' | 'asteroid' (a union type, extensible later).
2. Canonical ID strings with stable prefixes:
   - galaxy:  `gal:<slug>`            (slug is a stable label e.g. 'HD-564')
   - system:  `sys:<galaxySlug>|<systemSeed>`   (systemSeed: string or number, e.g. index or seeded name)
   - body:    `body:<galaxySlug>|<systemSeed>|<bodyType>|<ordinal>`   (ordinal = stable position within parent)
3. Branded types: `GalaxyId = string & { __galaxy: true }`, `SystemId`, `BodyId` (same pattern), plus `CanonicalId = GalaxyId | SystemId | BodyId`.
4. Parent-child chains: `SystemRef { id: SystemId; galaxy: GalaxyId }`, `BodyRef { id: BodyId; type: BodyType; parent: SystemId }`.
5. Pure functions (all exported):
   - galaxyId(slug: string): GalaxyId
   - systemId(galaxySlug: string, systemSeed: string | number): SystemId
   - bodyId(system: SystemId, type: BodyType, ordinal: number): BodyId
   - parseCanonicalId(id: string): { ok: true; kind: 'galaxy'|'system'|'body'; ...fields } | { ok: false; reason: string }  — never throws; rejects bad prefixes, missing segments, invalid body type, empty segments.
   - parentOf(id: CanonicalId): GalaxyId | SystemId | null  (body -> its SystemId; system -> its GalaxyId; galaxy -> null)
   - idSeed(id: CanonicalId): number  = fnv1a(id) — stable numeric seed per canonical ID so downstream seeded generation reconstructs deterministically after reload.
6. Round-trip invariants (must hold): parse(galaxyId(x)) ok galaxy; parse(systemId(g,s)) ok with same segments; parse(bodyId(sys,'moon',2)) -> bodyType 'moon', ordinal 2; parentOf(bodyId) equals the systemId; parentOf(systemId) equals galaxyId.

TESTS (vitest, tests/identity.test.ts — aim ~15-20 focused tests):
- round-trip parse for galaxy/system/body (all four body types)
- parent-chain correctness (body -> system -> galaxy)
- malformed rejection: '', 'gal:', 'sys:a|', 'body:a|b|comet|1', 'body:a|b|planet', bad ordinal (negative, NaN), extra segments
- determinism: same inputs -> identical IDs and idSeed; different inputs -> different ids (sample set)
- idSeed stability across repeated calls
- branded types compile (assign a GalaxyId where GalaxyId expected)

VERIFY AND REPORT (required):
- `npx tsc -b` exit 0
- `npx vitest run tests/identity.test.ts` all pass (report pass count)
- Report: changed files, test counts, exact commands + results, limitations, anything you deliberately excluded.
