TASK (StarBaron P1-T08, master roadmap): WORLD-STATE API — query + projection layer over UniverseState.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/reconstruct.ts (P1-T07, just committed): UniverseState { galaxy, systems, bodies }, buildUniverseState, serializeUniverse, deserializeUniverse.
- src/sim/world/identity.ts (P1-T01): GalaxyId/SystemId/BodyId, parseCanonicalId, parentOf.
- src/sim/world/galaxy.ts, system.ts, body.ts: record shapes.
- src/sim/world/catalogue.ts: buildCatalogueMapping.

ALLOWED FILES (create ONLY):
- src/sim/world/api.ts
- tests/api.test.ts

RESTRICTIONS: pure module — no Math.random/Date/THREE/no shared mutable data (avoid literal banned tokens even in comments); no `any`; strict TS; NO modification of existing files; NO src/ui/** imports; no UI/DB/rendering wiring. This is the CLIENT-SIDE query layer over an in-memory UniverseState — permission-safe projections at the backend are a later phase (document the boundary, don't implement auth).

DESIGN SPEC:
1. Query functions (all pure, return null/[] when not found):
   - `queryGalaxy(state: UniverseState, id: GalaxyId): GalaxyRecord | null`
   - `querySystem(state: UniverseState, id: SystemId): SystemRecord | null`
   - `queryBody(state: UniverseState, id: BodyId): BodyRecord | null`
   - `querySystemsByGalaxy(state: UniverseState, galaxyId: GalaxyId): SystemRecord[]` (stable order)
   - `queryBodiesBySystem(state: UniverseState, systemId: SystemId): BodyRecord[]` (stable order, ordinal-sorted)
2. Region query (spatial, galaxy-local):
   - `regionQuery(state: UniverseState, center: { x: number; y: number; z: number }, radius: number): { systems: SystemRecord[]; bodies: BodyRecord[] }` — Euclidean distance on position; include systems whose position is within radius; include bodies whose SYSTEM is within radius (bodies don't carry galaxy positions — document). radius must be >= 0 (throw descriptive Error otherwise). Deterministic order (sorted by id).
3. Response minimisation / projections:
   - `galaxySummary(g: GalaxyRecord)`, `systemSummary(s: SystemRecord)`, `bodySummary(b: BodyRecord)` — compact projections { id, name, type?, position?, ... } for HUD/hover use (no registries, no provenance bloat — keep: id, name, position, class/starType/type, radius).
   - `rendererPayload(state: UniverseState, focus: { galaxyId: GalaxyId; systemId?: SystemId }): RendererPayload` — minimal renderer-friendly bundle: galaxy { id, name, seed, position, radius, class }, systems in that galaxy (id, name, seed, position, starColor), bodies of each system (id, name, type, radius, orbit elements only). Type `RendererPayload` exported. NO mass/provenance/generation fields in the payload (renderer doesn't need them — response minimisation).
4. Boundary documentation: a JSDoc note on the module stating server-side permission-gated projections (intel levels, ownership) are implemented at the backend in later phases (P6/P10); this module only minimises payloads, never authorises.
5. Invariants (test):
   - lookups hit/miss (existing ids resolve; fabricated ids → null/[]).
   - queryBodiesBySystem sorted by ordinal; querySystemsByGalaxy stable.
   - regionQuery: center on a known system position with radius containing it → includes it; empty region → empty; negative radius throws.
   - summaries drop registries/provenance; rendererPayload contains ONLY the allowed fields (deep check: no `mass`, no `provenance`, no `systemIds`/`bodyIds` keys anywhere in the payload).
   - payload for a galaxy with no systems → empty arrays, no throw.
   - determinism: repeated calls deep-equal.

TESTS (vitest, tests/api.test.ts, ~22-26): use buildUniverseState with a small custom seed + catalogue off for most, PLUS one catalogue-on state for scale sanity (payload on real data builds fast — it's pure; keep assertions light, e.g. payload.systems.length === 4746). Cover: hit/miss lookups, ordering, regionQuery (contains/empty/negative-radius), projection field-allowlists (deep scan), rendererPayload minimalism, determinism.

VERIFY AND REPORT: `npx tsc -b` exit 0; `npx vitest run tests/api.test.ts` all pass (counts) — DO NOT run the full suite; report changed files, commands + results, limitations.
