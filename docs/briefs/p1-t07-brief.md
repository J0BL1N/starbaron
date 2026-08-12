TASK (StarBaron P1-T07, master roadmap): DETERMINISTIC UNIVERSE RECONSTRUCTION — same seed rebuilds the same universe; reload consistency + duplicate prevention.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/identity.ts (P1-T01): galaxyId/systemId/bodyId, idSeed(), parseCanonicalId, parentOf.
- src/sim/world/galaxy.ts (P1-T02): buildGalaxyRecord, GalaxyRecord, seededGalaxyClass, seededGalaxyName, universePositionFor, registerSystem.
- src/sim/world/system.ts (P1-T03): buildSystemRecord, SystemRecord, galaxyLocalPositionFor, registerBody.
- src/sim/world/body.ts (P1-T04): buildBodyRecord, BodyRecord.
- src/sim/world/catalogue.ts (P1-T05): buildCatalogueMapping, CatalogueMappingResult.
- src/sim/data/planets.ts: PLANETS.

ALLOWED FILES (create ONLY):
- src/sim/world/reconstruct.ts
- tests/reconstruct.test.ts

RESTRICTIONS: pure module — no Math.random/Date/THREE/no shared mutable data (avoid literal banned tokens even in comments); no `any`; strict TS; NO modification of existing files; NO src/ui/** imports; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `UniverseState = { galaxy: GalaxyRecord; systems: SystemRecord[]; bodies: BodyRecord[] }`.
2. `buildUniverseState(config: { seed: string; includeCatalogue?: boolean }): UniverseState`
   - ALWAYS builds the procedural home galaxy from the seed: buildGalaxyRecord({ slug: config.seed, seed: config.seed, position: universePositionFor(config.seed, 0) }).
   - When includeCatalogue is true (default), ADDS the real catalogue systems+bodies (from buildCatalogueMapping(PLANETS)) as additional systems of the home galaxy (their galaxy reference must be the home galaxy id — rebase the catalogue mapping's galaxy record into the home galaxy via registerSystem for each catalogue system id; bodies stay attached to their systems). The catalogue records keep realData/provenance exactly as produced.
   - Procedural expansion beyond the catalogue is OUT OF SCOPE for this task (document that a future task adds procedural systems) — the reconstruction proof focuses on seed-determinism of the home galaxy + catalogue determinism.
3. `serializeUniverse(state: UniverseState): string` — stable JSON.stringify (sort keys option: use a canonical replacer that sorts object keys, so serialization is byte-stable across runs).
4. `deserializeUniverse(json: string): UniverseState` — parse + validate: every id parses (parseCanonicalId ok), parent chains consistent (parentOf(body.id) === body.system; parentOf(system.id) === galaxy.id), no duplicate ids. Throw descriptive Error on invalid payload (corrupt JSON, bad ids, broken chains, dup ids).
5. `reconstructConsistency(state: UniverseState): { ok: boolean; problems: string[] }` — rebuild from state.galaxy.seed with the same includeCatalogue flag (derive: state.systems.some(s => s.realData) → true): deep-equal check galaxy + systems + bodies arrays (order-stable), id-chain checks, count checks. Returns problems for any mismatch.
6. Invariants (test):
   - same seed → deep-equal UniverseState (run buildUniverseState twice).
   - different seeds → different galaxy ids.
   - serialize → deserialize → deep-equal original (byte-stable string: serialize twice → identical strings).
   - deserialize of corrupt JSON / bad id / broken chain / dup id throws.
   - reconstructConsistency on a valid state → ok true, no problems.
   - includeCatalogue=false → systems/bodies empty.
   - catalogue systems all have realData true; galaxy id is the seed slug galaxy.

TESTS (vitest, tests/reconstruct.test.ts, ~22-28): determinism (2× build), seed difference, catalogue inclusion, serialization round-trip + byte-stability, 4 corrupt-payload negatives, consistency ok + one mutated-state negative, empty-expansion case, id-chain checks across the whole state.

VERIFY AND REPORT: `npx tsc -b` exit 0; `npx vitest run tests/reconstruct.test.ts` all pass (counts) — DO NOT run the full suite; report changed files, commands + results, limitations.
