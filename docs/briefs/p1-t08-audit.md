READ-ONLY AUDIT — StarBaron P1-T08 (master roadmap): World-State API.

READ LIST:
- src/sim/world/api.ts        (NEW — implementation under audit)
- tests/api.test.ts           (NEW — test suite under audit)
- src/sim/world/reconstruct.ts (P1-T07: UniverseState, buildUniverseState)
- src/sim/world/identity.ts   (P1-T01: id types)
- src/sim/world/galaxy.ts / system.ts / body.ts (record shapes for projections)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 77e1c1db3fd244e7e4c7d9ce17151822ff1abcaa (`git show --stat` adds exactly src/sim/world/api.ts + tests/api.test.ts). Docs/working tree OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p1-t08-brief.md + master roadmap P1-T08):
1. Query layer: queryGalaxy/querySystem/queryBody (null on miss), querySystemsByGalaxy (stable), queryBodiesBySystem (ordinal-sorted).
2. regionQuery(state, center, radius) — Euclidean on system positions; radius >= 0 (throw descriptive Error otherwise); deterministic id-sorted; bodies included via their system.
3. Projections: galaxySummary/systemSummary/bodySummary (compact — NO registries/provenance/generation fields); rendererPayload(state, focus) — minimal renderer bundle (id/name/seed/position/class/starColor/type/radius/orbit ONLY — deep allowlist: no mass, no provenance, no systemIds/bodyIds).
4. Boundary: JSDoc states server-side permission-gated projections are a later phase (P6/P10) — this module minimises payloads, never authorises.
5. Purity: no Math.random/Date/THREE/no shared mutable data (comments included); no `any`; imports ⊆ world/** + stdlib; NO src/ui/**.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Lookup hit/miss; ordering invariants (ordinal-sorted bodies, stable systems).
C. regionQuery: contains/empty/negative-radius-throws; deterministic order.
D. Deep projection allowlist — walk the rendererPayload object graph: assert NO key equals mass/provenance/generationVersion/systemIds/bodyIds/entries anywhere; summaries drop registries.
E. Payload for galaxy without systems → empty arrays, no throw.
F. Determinism (repeated calls deep-equal).
G. Tests ~22+ covering the above (catalogue-on scale sanity light: e.g. payload.systems.length === 4746); vitest conventions; imports resolve; no `any`.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
