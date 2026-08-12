TASK (StarBaron P1-T02, master roadmap): Implement the CANONICAL GALAXY DATA MODEL.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/identity.ts (JUST COMMITTED, P1-T01): exports GalaxyId, SystemId, BodyId, CanonicalId, galaxyId(), systemId(), bodyId(), parseCanonicalId(), parentOf(), idSeed(). Import from './identity'.
- src/ui/planetgen3d/galaxy.ts: render-side position helpers (GalaxyPosition, galaxyPositionFor, scaleGalaxyPositions, DEFAULT_GALAXY_RADIUS) — read-only reference for position semantics.
- src/ui/planetgen3d/hosts.ts: HostStar grouping (hostname, entries, representativePosition, bestTier).
- src/ui/planetgen3d/system.ts: SolarSystemData (seeded system assembler).
- src/sim/data/planets.ts: PLANETS catalogue + PlanetCatalogueEntry.

ALLOWED FILES (create ONLY):
- src/sim/world/galaxy.ts
- tests/galaxy-model.test.ts

RESTRICTIONS:
- Do NOT modify or delete ANY existing file. Pure module: NO Math.random, NO THREE imports, NO Date/global state, NO `any`, strict TS.
- This is the CANONICAL data model — it must NOT depend on render objects. Render-side modules may later import FROM it, never the reverse.
- No UI/DB/rendering wiring. No Supabase.

DESIGN SPEC:
1. `GalaxyClass = 'spiral' | 'barred-spiral' | 'elliptical' | 'irregular' | 'dwarf'` (extensible union).
2. `GalaxyRecord` interface (canonical, persistent):
   - id: GalaxyId
   - seed: string            (generation seed — everything about the galaxy derives from it)
   - name: string            (display name, e.g. 'HD-564' or a seeded name)
   - class: GalaxyClass
   - position: { x: number; y: number; z: number }   (universe-space position; Sol-origin convention from planetgen3d/galaxy.ts)
   - radius: number          (view radius, default 600 — reference DEFAULT_GALAXY_RADIUS semantics)
   - systemIds: SystemId[]   (registry of systems — empty for now, populated by P1-T03+; must be stable/ordered)
   - generationVersion: number
   - realData: boolean       (true when backed by catalogue data, false for pure procedural)
   - provenance: string      (e.g. 'nasa-exoplanet-archive-2026-08-10' | 'procedural')
   - createdAt? — NO timestamps in pure model (determinism); omit.
3. Pure factory:
   - `buildGalaxyRecord(input: { slug: string; seed?: string; name?: string; class?: GalaxyClass; position?: {x,y,z}; radius?: number; realData?: boolean; provenance?: string }): GalaxyRecord`
     - defaults: seed = input.seed ?? slug; name = input.name ?? slug; class = 'spiral'; position = {0,0,0}; radius = 600; generationVersion = GALAXY_GENERATION_VERSION; realData = false; provenance = 'procedural'.
     - id MUST be galaxyId(slug) from ./identity (branded) — never constructed by hand.
   - `GALAXY_GENERATION_VERSION = 1` exported const.
   - `seededGalaxyClass(seed: string): GalaxyClass` — deterministic class pick via fnv1a(seed + '|class') % 100 with sensible weights (spiral ~45%, barred ~25%, elliptical ~15%, irregular ~10%, dwarf ~5%).
   - `seededGalaxyName(seed: string): string` — deterministic name from a small seeded pool (GalaxyClass-based suffix optional; keep simple: seeded pick from a 20-name pool).
   - `universePositionFor(slug: string, index: number): { x: number; y: number; z: number }` — deterministic seeded position (spherical shell ~1800-6000 radius, matching the showcase's near-tier band; use fnv1a-based rng via the existing pattern in src/ui/planetgen3d/random.ts rngFrom — you may READ that file; re-implement a minimal local deterministic rng from fnv1a if importing rngFrom would create coupling — prefer a tiny local `seededUnit(seed)` helper built on fnv1a so galaxy.ts stays independent).
   - `registerSystem(galaxy: GalaxyRecord, systemId: SystemId): GalaxyRecord` — returns a NEW record with the system appended (immutable style; no duplicate ids — reject duplicates by returning the same record or skipping; document choice).
4. Invariants (test them):
   - record.id === galaxyId(record.seed-ish slug used at construction) — the id is exactly the branded slug id.
   - same input → deep-equal identical record (determinism).
   - different slugs → different ids.
   - generationVersion === GALAXY_GENERATION_VERSION.
   - registerSystem appends and never duplicates; returned record is a new object (immutability).
   - seededGalaxyClass/Name deterministic + within the union/pool.
   - universePositionFor deterministic, magnitude within [1800, 6000].

TESTS (vitest, tests/galaxy-model.test.ts, ~18-24 tests):
- factory defaults, explicit overrides, id branding (parseCanonicalId(record.id).kind === 'galaxy')
- determinism (deep equality), distinct slugs distinct ids
- seededGalaxyClass distribution sanity (all values in union; a fixed seed always returns the same class)
- seededGalaxyName stable + in pool
- universePositionFor determinism + shell bounds + distinct seeds distinct positions
- registerSystem append/duplicate/no-mutation-of-input
- generationVersion constant

VERIFY AND REPORT: `npx tsc -b` exit 0; `npx vitest run tests/galaxy-model.test.ts` all pass (counts); report changed files, commands + results, limitations.
