READ-ONLY AUDIT — StarBaron P1-T05 (master roadmap): Real Astronomy Integration (canonical catalogue mapping).

READ LIST:
- src/sim/world/catalogue.ts   (NEW — implementation under audit)
- tests/catalogue.test.ts      (NEW — test suite under audit)
- src/sim/world/identity.ts    (P1-T01: GalaxyId/SystemId/BodyId, idSeed(), parentOf())
- src/sim/world/galaxy.ts      (P1-T02: GalaxyRecord, buildGalaxyRecord)
- src/sim/world/system.ts      (P1-T03: SystemRecord, buildSystemRecord)
- src/sim/world/body.ts        (P1-T04: BodyRecord, buildBodyRecord)
- src/sim/data/planets.ts      (PLANET_SNAPSHOT meta + PLANETS: PlanetCatalogueEntry[])
- scripts/import-planets.mjs + tests/import-planets-edge.test.ts (snapshot pin + drift-gate convention)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 012b96a4c75ac351732ebfc9b6d1c90eafe0ba09 (`git show b2cac57 --stat` must add exactly src/sim/world/catalogue.ts + tests/catalogue.test.ts). Docs/working-tree files OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p1-t05-brief.md + master roadmap P1-T05):
1. buildCatalogueMapping(planets, meta?) → { galaxy, systems, bodies, stats } — deterministic: hosts sorted by hostname; systems one per unique host; bodies one per catalogue planet (type 'planet', ordinal = index within host).
2. realData TRUE + provenance 'nasa-exoplanet-archive-2026-08-10' on every catalogue-derived record. Real data NEVER relabelled procedural.
3. radiusEarth → world radius 1.2 + r*0.35 clamped [1.2, 40]; massJup carried as mass (units documented).
4. validateCatalogue(mapping, snapshot) → { ok, problems } — systems count === unique hosts; bodies count === input length; ids parse; every body's parent system exists; ordinals match index; no duplicate ids.
5. Purity: no Math.random/Date/THREE/shared mutable data (comments included); no `any`; imports only world/** + ../data/planets + ../planets/hash + stdlib; NO src/ui/**.
6. Empty input → empty mapping, ok:true; missing fields handled deterministically.

CHECK:
A. Purity + import allowlist; no banned tokens in comments.
B. Determinism: same input → deep-equal mapping (real PLANETS ×2).
C. Counts + provenance invariants (realData true everywhere, provenance string exact).
D. validateCatalogue catches: mutated/duplicate ids, orphan body (parent not in systems), count mismatches.
E. id chains: body parentOf → its system; system parentOf → galaxy.id; ids parse via parseCanonicalId.
F. radius/mass mapping math correct (clamp bounds); empty-input edge ok.
G. Tests ~20+ using real PLANETS + small fixture; vitest conventions; imports resolve; no `any`.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
