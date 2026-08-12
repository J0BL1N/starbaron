READ-ONLY AUDIT — StarBaron P1-T02 (master roadmap): Canonical Galaxy Data Model.

READ LIST:
- src/sim/world/galaxy.ts        (NEW — implementation under audit)
- tests/galaxy-model.test.ts     (NEW — test suite under audit)
- src/sim/world/identity.ts      (P1-T01 dependency: GalaxyId/SystemId, galaxyId(), idSeed())
- src/ui/planetgen3d/random.ts   (rngFrom pattern reference — may be re-implemented locally)
- src/ui/planetgen3d/galaxy.ts   (position semantics reference: DEFAULT_GALAXY_RADIUS=600, universe frame)
- src/ui/planetgen3d/hosts.ts    (render-side grouping — must NOT be depended on)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 7efa0eb (`git show 7efa0eb --stat` must add exactly src/sim/world/galaxy.ts + tests/galaxy-model.test.ts). The working tree and later docs commits (docs/briefs/**) are the bridge's evidence files — OUT OF SCOPE, do not flag them. No existing file may be modified in 7efa0eb.

TASK SPEC (docs/briefs/p1-t02-brief.md + docs/MASTER-ROADMAP.md P1-T02):
1. GalaxyClass union (5 values); GalaxyRecord { id: GalaxyId, seed, name, class, position {x,y,z}, radius (default 600), systemIds: SystemId[], generationVersion, realData, provenance }.
2. buildGalaxyRecord(input) pure factory with defaults; id = galaxyId(slug) (branded, from ./identity) — never hand-constructed.
3. GALAXY_GENERATION_VERSION = 1; seededGalaxyClass (weighted, fnv1a-based); seededGalaxyName (pool); universePositionFor (deterministic, shell 1800-6000); registerSystem (immutable, no duplicates).
4. Purity: no Math.random / Date / global state / THREE imports; no dependency on render-side modules; no `any`.

CHECK:
A. Purity — grep Math.random|Date|THREE|crypto in galaxy.ts: must be none (comments included — no literal banned tokens). Imports: ./identity, ./galaxy, and ../planets/hash are all PERMITTED (hash.ts is a pure sim primitive, not render-side). NO import from src/ui/**.
B. id === galaxyId(slug) — factory never bypasses the branded constructor; parseCanonicalId(record.id).kind === 'galaxy' holds.
C. Determinism — same input → deep-equal record (no object identity requirement, but fields equal); seededGalaxyClass/Name/universePositionFor stable per seed.
D. registerSystem — returns new record (input not mutated), appends once, rejects/skips duplicate SystemIds (documented choice, tested).
E. universePositionFor magnitude within [1800, 6000].
F. Tests: ~18+ covering defaults/overrides, determinism, class distribution sanity, name pool, position bounds, registerSystem immutability+dupes, version const. Vitest conventions, imports resolve.
G. Type safety — no `any`, no casts that hide errors; strict TS.

DO NOT: modify anything; run the suite (sandbox blocks it); invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings with file:line + deterministic fix language. PASS → key invariants verified.
