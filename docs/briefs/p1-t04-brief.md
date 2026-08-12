TASK (StarBaron P1-T04, master roadmap): Implement the CANONICAL CELESTIAL-BODY DATA MODEL.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/identity.ts (P1-T01): BodyId, BodyType ('star'|'planet'|'moon'|'asteroid'), bodyId(), parseCanonicalId(), idSeed(), parentOf().
- src/sim/world/galaxy.ts (P1-T02): GalaxyRecord pattern (immutable records, register* helpers, generationVersion const).
- src/sim/world/system.ts (P1-T03, just committed): SystemRecord, registerBody, SYSTEM_GENERATION_VERSION.
- src/ui/planetgen3d/orbits.ts: OrbitalElements type + seededOrbitalElements/seededMoonElements (semantics reference for orbit parameterisation — READ it).
- src/sim/data/planets.ts: PLANETS catalogue + PlanetCatalogueEntry (radius, tier, mass, orbitalPeriod etc. — real-data provenance reference).
- src/sim/planets/types.ts: PlanetVisualProfile, PlanetQuirk (visual/procedural metadata reference).

ALLOWED FILES (create ONLY):
- src/sim/world/body.ts
- tests/body-model.test.ts

RESTRICTIONS: pure module — no Math.random/Date/THREE/global state; no `any`; strict TS; NO modification of existing files; NO src/ui/** imports; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `BodyRecord` interface (canonical, persistent):
   - id: BodyId
   - system: SystemId        (parent — parentOf(body.id) === system must hold)
   - type: BodyType          ('star' | 'planet' | 'moon' | 'asteroid')
   - name: string
   - seed: string
   - ordinal: number         (position within the parent system, matches the id segment)
   - radius: number          (world units; planets use the catalogue/scene radius semantics)
   - mass?: number           (optional; for real catalogue bodies)
   - orbit: {
       semiMajorAxis: number;   // a (world units)
       eccentricity: number;    // 0..1
       inclination: number;     // radians
       longitudeOfAscendingNode: number; // radians (omega)
       argumentOfPeriapsis: number;      // radians (w)
       meanAnomaly: number;              // radians (M0 at epoch)
       period: number;                  // simulation seconds
     }
   - realData: boolean
   - provenance: string      ('nasa-exoplanet-archive-2026-08-10' | 'procedural' | 'scene-default')
   - generationVersion: number
2. `BODY_GENERATION_VERSION = 1` exported const.
3. Pure factory:
   - `buildBodyRecord(input: { system: SystemId; type: BodyType; ordinal: number; name?: string; seed?: string; radius?: number; orbit?: Partial<BodyRecord['orbit']>; mass?: number; realData?: boolean; provenance?: string }): BodyRecord`
     - id = bodyId(system, type, ordinal) — branded, never hand-built.
     - name default = seeded name: star → '${systemName} Prime', planet → seeded pick from a 16-name pool, moon → '${parentName} ${roman-numeral}', asteroid → 'SB-${4-digit seeded}'. Keep simple + deterministic.
     - orbit defaults via a small local deterministic rng on fnv1a(id): e.g. a = 8 + r*28 (planets), e = r*0.12, i = r*0.15, omega/w/M0 = r*2π, period = 60 + r*540. Moons: a = 1 + r*2.5, period = 8 + r*40. Stars: orbit = { a: 0, e: 0, i: 0, omega: 0, w: 0, M0: 0, period: 0 } (the system centre).
   - `seededBodyName(type: BodyType, systemName: string, ordinal: number, seed: string): string` — exported, deterministic.
   - `describeBody(body: BodyRecord): string` — one-line human summary (e.g. "Planet Aurorae-2 · R 1.30 · P 212s · procedural") for debug/tooling.
4. Invariants (test):
   - parseCanonicalId(body.id).kind === 'body'; type + ordinal segments match the record fields; parentOf(body.id) === system.
   - same input → deep-equal record; different ordinals/types → distinct ids.
   - orbit fields all finite numbers; semiMajorAxis >= 0; eccentricity in [0,1); inclination/angles finite.
   - star body → zero orbit; moon/planet/asteroid → nonzero orbit.
   - deterministic name (same args → same name; different seeds differ).
   - generationVersion const; realData/provenance passthrough.

TESTS (vitest, tests/body-model.test.ts, ~24-30): factory defaults per type, id branding + parent chain, orbit defaults (bounds, finiteness, star-zero), name determinism + pool membership, describeBody smoke, determinism (deep equal), version const.

VERIFY AND REPORT: `npx tsc -b` exit 0; `npx vitest run tests/body-model.test.ts` all pass (counts) — DO NOT run the full suite (known slow crawl); report changed files, commands + results, limitations.
