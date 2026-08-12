READ-ONLY AUDIT — StarBaron P1-T03 (master roadmap): Canonical Solar-System Data Model.

READ LIST:
- src/sim/world/system.ts      (NEW — implementation under audit)
- tests/system-model.test.ts   (NEW — test suite under audit)
- src/sim/world/identity.ts    (P1-T01: SystemId/GalaxyId, systemId(), parseCanonicalId(), parentOf(), idSeed())
- src/sim/world/galaxy.ts      (P1-T02: immutable record pattern, register* helpers, DEFAULT_GALAXY_RADIUS)
- src/ui/planetgen3d/textures.ts (spiral-arm math semantics reference — lines ~454-521)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT f86ace7fce110ae554e8d26ea49af3030e25068e (`git show 1fa301b --stat` must add exactly src/sim/world/system.ts + tests/system-model.test.ts). Working tree + docs commits are the bridge's evidence — OUT OF SCOPE. No existing file modified in 1fa301b.

TASK SPEC (docs/briefs/p1-t03-brief.md + master roadmap P1-T03):
1. StarMetadata { name, starType: string|undefined, color } — seeded color picker.
2. SystemRecord { id: SystemId, galaxy: GalaxyId, seed, name, position {x,y,z} galaxy-local, star: StarMetadata, bodyIds: BodyId[], generationVersion, realData, provenance }.
3. buildSystemRecord — id = systemId(galaxySlug, seed??slug); galaxy slug extracted via parseCanonicalId (never hand string-split); SYSTEM_GENERATION_VERSION = 1.
4. galaxyLocalPositionFor(slug, index, galaxyRadius=600): deterministic, spiral-arm biased (textures.ts semantics), radius band 40-55%, thin y-jitter, local fnv1a rng.
5. registerBody immutable append, no dupes; parentOf(system.id) === galaxy; purity (no Math.random/Date/THREE/global state — comments included); no `any`; imports only ./identity, ./galaxy, ../planets/hash + stdlib; NO src/ui/** imports.

CHECK:
A. Purity + imports (grep banned tokens incl. comments). Imports ⊆ {./identity, ./galaxy, ../planets/hash, stdlib}.
B. id construction via systemId() + parseCanonicalId slug extraction; parseCanonicalId(system.id).kind === 'system'; parentOf(system.id) === galaxy.
C. galaxyLocalPositionFor — deterministic; magnitude within [0.4, 0.55]*galaxyRadius; distinct seeds distinct.
D. registerBody — immutable, no duplicate BodyIds.
E. StarMetadata color — deterministic per seed; starType passthrough.
F. Tests ~30 covering spec; vitest conventions; imports resolve.
G. Strict TS, no `any`, no render dependency.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
