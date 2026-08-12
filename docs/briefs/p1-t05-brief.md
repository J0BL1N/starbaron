TASK (StarBaron P1-T05, master roadmap): REAL ASTRONOMY INTEGRATION — map the pinned NASA Exoplanet Archive catalogue into canonical world records with provenance + drift validation.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/identity.ts (P1-T01): GalaxyId/SystemId/BodyId, galaxyId(), systemId(), bodyId(), idSeed().
- src/sim/world/galaxy.ts (P1-T02): buildGalaxyRecord, GalaxyRecord, registerSystem.
- src/sim/world/system.ts (P1-T03): buildSystemRecord, SystemRecord, registerBody, StarMetadata.
- src/sim/world/body.ts (P1-T04): buildBodyRecord, BodyRecord, BODY_GENERATION_VERSION.
- src/sim/data/planets.ts: PLANET_SNAPSHOT { source, query, fetchedAt: '2026-08-10', rows: 6321, sha } + PLANETS: PlanetCatalogueEntry[] { name, hostname, systemCount, radiusEarth?, massJup?, starType?, distancePc?, ra?, dec?, tier }.
- tests/import-planets-edge.test.ts + scripts/import-planets.mjs: existing snapshot pin + drift-gate tests (READ for convention).

ALLOWED FILES (create ONLY):
- src/sim/world/catalogue.ts
- tests/catalogue.test.ts

RESTRICTIONS: pure module — no Math.random/Date/THREE/global state (comments included: avoid literal banned tokens); no `any`; strict TS; NO modification of existing files; NO src/ui/** imports; no UI/DB/rendering wiring. Real data must NEVER be relabelled procedural and vice versa.

DESIGN SPEC:
1. `CatalogueSnapshotMeta` = the PLANET_SNAPSHOT shape (source, query, fetchedAt, rows, sha) — re-export/derive from src/sim/data/planets, do not duplicate constants.
2. `CatalogueMappingResult`:
   - galaxy: GalaxyRecord          (the canonical "Milky Way analogue" record — slug 'catalogue', realData TRUE, provenance = snapshot source date)
   - systems: SystemRecord[]       (one per unique hostname — starType + name from the host; ordinal = index in deterministic hostname sort)
   - bodies: BodyRecord[]          (one per catalogue planet — type 'planet', radius from radiusEarth→world units via seeded conversion, orbit from real fields where present else deterministic defaults)
   - stats: { realSystems: number; realBodies: number; seededSystems: number; seededBodies: number; }
3. Pure functions:
   - `buildCatalogueMapping(planets: readonly PlanetCatalogueEntry[], meta?: typeof PLANET_SNAPSHOT): CatalogueMappingResult`
     - deterministic: iterate hosts in SORTED hostname order (stable), planets within a host in catalogue order.
     - system id = systemId('catalogue', hostname); body id = bodyId(system, 'planet', ordinal) with ordinal = planet index within that host.
     - realData: true for every system/body with a catalogue entry. provenance: 'nasa-exoplanet-archive-2026-08-10' (derive from meta.fetchedAt string: `nasa-exoplanet-archive-${meta.fetchedAt}`).
     - radiusEarth → world radius: r_world = 1.2 + radiusEarth * 0.35 (clamped [1.2, 40]); massJup carried as `mass` (kg not needed — keep catalogue units, document).
     - orbit: when the catalogue has no orbital data (it doesn't in this snapshot), use deterministic defaults via idSeed(bodyId) with the same band logic as P1-T04 (document that real orbital parameters are a future catalogue extension — never fabricate 'real' values).
     - validation: `validateCatalogue(mapping, snapshot): { ok: boolean; problems: string[] }` — checks: systems count === unique hostnames count; bodies count === planets.length; every system id parses; every body's parent system exists in systems; every body ordinal is its index within host; no duplicate ids anywhere.
4. Invariants (test):
   - deterministic: same input → deep-equal mapping (including on a small sample slice).
   - realData true + provenance 'nasa-exoplanet-archive-2026-08-10' on ALL catalogue-derived records.
   - counts: unique hostname count === systems.length; bodies.length === input length; stats.seededSystems === 0, seededBodies === 0 (this snapshot has no coordinate-missing rows — all catalogue-backed).
   - validateCatalogue returns ok:true with no problems on the real mapping.
   - id chains: parseCanonicalId(body.id).kind==='body'; parentOf(body.id) equals its system id; parentOf(system.id) === galaxy.id.
   - sorted-host order stable across calls.

TESTS (vitest, tests/catalogue.test.ts, ~20-26): use REAL PLANETS data (import from src/sim/data/planets — 6,321 rows; fine for vitest) for the big mapping + a tiny 3-entry fixture for edge checks (duplicate hostname, missing fields, empty input → empty mapping with ok:true). Include determinism (run twice, deep-equal), counts, provenance, id chains, validateCatalogue problems detection (feed a mutated mapping → problems list catches it).

VERIFY AND REPORT: `npx tsc -b` exit 0; `npx vitest run tests/catalogue.test.ts` all pass (counts) — DO NOT run the full suite; report changed files, commands + results, limitations (e.g. real orbit params not in snapshot — documented).
