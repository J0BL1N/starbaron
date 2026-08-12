TASK (StarBaron P1-T03, master roadmap): Implement the CANONICAL SOLAR-SYSTEM DATA MODEL.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/identity.ts (P1-T01): GalaxyId, SystemId, BodyId, galaxyId(), systemId(), parseCanonicalId(), idSeed().
- src/sim/world/galaxy.ts (P1-T02, just committed): GalaxyRecord, buildGalaxyRecord, GalaxyClass, GALAXY_GENERATION_VERSION, universePositionFor.
- src/ui/planetgen3d/system.ts: render-side seeded system assembler (SolarSystemData: seedName, starType, starModel, planets, asteroidBelt) — semantics reference only.
- src/ui/planetgen3d/spectral.ts: starModelFromType / StarModel (star metadata reference).
- src/sim/data/planets.ts: PLANETS catalogue (real hostnames/starType per system).

ALLOWED FILES (create ONLY):
- src/sim/world/system.ts
- tests/system-model.test.ts

RESTRICTIONS: same as P1-T02 — pure module (no Math.random/Date/THREE/global state), no `any`, strict TS, no modification of existing files, no UI/DB/rendering wiring. Must NOT import from src/ui/** (render-side may import from world/, never the reverse).

DESIGN SPEC:
1. `StarMetadata` interface: { name: string; starType: string | undefined; color: string; } (color = seeded hex, derived from starType via a tiny deterministic picker, or '#ffd27a' default).
2. `SystemRecord` interface (canonical, persistent):
   - id: SystemId
   - galaxy: GalaxyId            (parent galaxy reference — parent-child chain via identity)
   - seed: string                (generation seed)
   - name: string                (display name, e.g. seeded name like 'Aurora' or catalogue hostname)
   - position: { x: number; y: number; z: number }   (GALAXY-LOCAL position — inside the galaxy disk)
   - star: StarMetadata
   - bodyIds: BodyId[]           (registry of bodies; empty for now, populated by P1-T04; stable order)
   - generationVersion: number
   - realData: boolean
   - provenance: string
3. Pure factory:
   - `buildSystemRecord(input: { galaxy: GalaxyId; slug: string; seed?: string; name?: string; position?: {x,y,z}; starType?: string; realData?: boolean; provenance?: string }): SystemRecord`
     - id = systemId(galaxySlugOf(galaxy), seed ?? slug) — derive via identity helpers; extract the galaxy slug from the branded GalaxyId with parseCanonicalId (never string-split by hand).
     - star.name defaults to input.name ?? slug; star.color via seeded picker on the seed.
     - generationVersion = SYSTEM_GENERATION_VERSION (export const = 1).
   - `SYSTEM_GENERATION_VERSION = 1` exported const.
   - `galaxyLocalPositionFor(slug: string, index: number, galaxyRadius?: number): { x, y, z }` — deterministic seeded position inside the galaxy disk (spiral-arm biased: use the arm math semantics from src/ui/planetgen3d/galaxy.ts buildSystemsRegistry — READ it; radius band 40-55% of galaxyRadius (default 600), thin y-jitter; re-implement a minimal local deterministic rng on fnv1a — do NOT import rngFrom).
   - `registerBody(system: SystemRecord, bodyId: BodyId): SystemRecord` — immutable append, no duplicates (mirror registerSystem semantics from galaxy.ts).
4. Invariants (test):
   - parseCanonicalId(system.id).kind === 'system' and its galaxy segment === the parent galaxy slug.
   - parentOf(system.id) === galaxy (identity helper).
   - same input → deep-equal record; distinct slugs → distinct ids.
   - galaxyLocalPositionFor: magnitude within [0.4, 0.55] * galaxyRadius; deterministic; distinct seeds distinct positions.
   - registerBody immutable + no dupes.
   - generationVersion const.

TESTS (~20-24): factory defaults/overrides, id branding + parent chain (system -> galaxy), determinism, position band + determinism, registerBody, version const, star metadata defaults, realData/provenance passthrough.

VERIFY AND REPORT: `npx tsc -b` exit 0; `npx vitest run tests/system-model.test.ts` all pass (counts); report changed files, commands + results, limitations.
