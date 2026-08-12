READ-ONLY AUDIT — StarBaron P1-T03 (master roadmap): Canonical Solar-System Data Model.

READ LIST:
- src/sim/world/system.ts      (NEW — implementation under audit)
- tests/system-model.test.ts   (NEW — test suite under audit)
- src/sim/world/identity.ts    (P1-T01: SystemId/GalaxyId, systemId(), parseCanonicalId(), parentOf(), idSeed())
- src/sim/world/galaxy.ts      (P1-T02: GalaxyRecord, registerSystem pattern, DEFAULT_GALAXY_RADIUS)
- src/ui/planetgen3d/system.ts (render-side assembler — semantics reference ONLY; world/ must NOT import it)

AUTHORISED SCOPE: ONLY the two new files (verify git show --stat HEAD adds exactly those). No existing file modified.

TASK SPEC (docs/briefs/p1-t03-brief.md + master roadmap P1-T03):
1. StarMetadata { name, starType: string|undefined, color } (seeded color picker).
2. SystemRecord { id: SystemId, galaxy: GalaxyId, seed, name, position {x,y,z} (galaxy-local), star: StarMetadata, bodyIds: BodyId[], generationVersion, realData, provenance }.
3. buildSystemRecord(input) — id = systemId(galaxySlug, seed??slug); galaxy slug extracted via parseCanonicalId (never hand string-split); SYSTEM_GENERATION_VERSION = 1.
4. galaxyLocalPositionFor(slug, index, galaxyRadius=600): deterministic, spiral-arm biased, radius band 40-55% of galaxyRadius, thin y-jitter, local fnv1a-based rng (no rngFrom import).
5. registerBody immutable append, no duplicates. parentOf(system.id) === galaxy. Purity: no Math.random/Date/THREE/global state; no `any`; no src/ui/** imports.

CHECK:
A. Purity + imports (grep Math.random|Date|THREE|rngFrom in system.ts — must be none; imports only ./identity, ./galaxy, stdlib).
B. id construction — uses systemId() + parseCanonicalId for slug extraction; never manual string surgery; parseCanonicalId(system.id).kind === 'system'.
C. parent chain — parentOf(system.id) === galaxy (identity helper), and galaxy segment matches.
D. galaxyLocalPositionFor — deterministic, magnitude within [0.4, 0.55]*galaxyRadius, distinct seeds distinct.
E. registerBody — immutable (input not mutated), no duplicate BodyIds.
F. Tests ~20+ covering the above + star metadata defaults + realData/provenance passthrough; vitest conventions; imports resolve.
G. No `any`; strict TS; no render dependency.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
