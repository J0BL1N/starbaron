READ-ONLY AUDIT — StarBaron P1-T07 (master roadmap): Deterministic Universe Reconstruction.

READ LIST:
- src/sim/world/reconstruct.ts  (NEW — implementation under audit)
- tests/reconstruct.test.ts     (NEW — test suite under audit)
- src/sim/world/identity.ts     (P1-T01: id factories, parseCanonicalId, parentOf, idSeed)
- src/sim/world/galaxy.ts       (P1-T02: buildGalaxyRecord, universePositionFor)
- src/sim/world/system.ts       (P1-T03: buildSystemRecord)
- src/sim/world/body.ts         (P1-T04: buildBodyRecord)
- src/sim/world/catalogue.ts    (P1-T05: buildCatalogueMapping)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 58c298d52de9f28e148445d40674bc31f2aa42f8 (`git show --stat` = A src/sim/world/reconstruct.ts, A tests/reconstruct.test.ts, M src/sim/world/catalogue.ts). The catalogue.ts modification is the AUTHORISED backwards-compatible `galaxySlug` option (default behaviour unchanged — tests/catalogue.test.ts untouched and green); it exists so re-homed catalogue systems have EXACT canonical parent chains. Docs/working tree OUT OF SCOPE.

TASK SPEC (docs/briefs/p1-t07-brief.md + master roadmap P1-T07):
1. UniverseState { galaxy, systems, bodies }; buildUniverseState({seed, includeCatalogue=true}) — home galaxy from seed; catalogue systems+bodies rebased onto the home galaxy (registerSystem each; bodies untouched); catalogue records keep realData/provenance.
2. serializeUniverse — byte-stable JSON (sorted keys); deserializeUniverse — validates ids parse, parent chains exact, no dup ids; throws descriptive Error on corrupt/invalid.
3. reconstructConsistency — rebuild from seed (+ includeCatalogue derived from state), deep-equal galaxy/systems/bodies, id chains, counts; returns {ok, problems}.
4. Purity: no Math.random/Date/THREE/no shared mutable data (comments included); no `any`; imports ⊆ world/** + ../data/planets + ../planets/hash + stdlib; NO src/ui/**.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. buildUniverseState determinism (2× deep-equal); includeCatalogue=false → empty systems/bodies; catalogue systems realData true + galaxy id = seed slug.
C. serialize byte-stability (2× identical strings); deserialize round-trip deep-equal; 4+ corrupt negatives throw.
D. reconstructConsistency ok:true on valid state; detects a mutated state (swap/dup/missing) with problems.
E. Rebase correctness: catalogue systems' galaxy field === home galaxy id; parentOf chains hold across the whole state.
F. Tests ~22+ covering spec; vitest conventions; imports resolve; no `any`.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
