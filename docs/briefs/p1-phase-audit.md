READ-ONLY WHOLE-PHASE AUDIT — StarBaron PHASE 1 (Universe Foundation), cross-task coherence.

READ LIST (all Phase 1 deliverables):
- src/sim/world/identity.ts + tests/identity.test.ts      (T01)
- src/sim/world/galaxy.ts + tests/galaxy-model.test.ts    (T02)
- src/sim/world/system.ts + tests/system-model.test.ts    (T03)
- src/sim/world/body.ts + tests/body-model.test.ts        (T04)
- src/sim/world/catalogue.ts + tests/catalogue.test.ts    (T05)
- supabase/migrations/0013_world_schema.sql + supabase/tests/07_world_schema.sql (T06)
- src/sim/world/reconstruct.ts + tests/reconstruct.test.ts (T07)
- src/sim/world/api.ts + tests/api.test.ts                (T08)
- src/sim/data/planets.ts (PLANET_SNAPSHOT + PLANETS), src/sim/planets/hash.ts (fnv1a)

AUDIT TARGET: the whole Phase 1 feature set (whole Phase 1 feature set on staging through 0b47322, INCLUDING phase-fix commits through 0b47322 which address your previous findings). Docs commits are the bridge's evidence — OUT OF SCOPE.

CHECK — CROSS-TASK COHERENCE (this is the point of the phase audit):
A. ID FORMAT CONSISTENCY: the same canonical formats (gal:<slug> / sys:<galaxySlug>|<systemSeed> / body:<galaxySlug>|<systemSeed>|<type>|<ordinal>) appear identically in identity.ts, the migration PKs + comments, and all factories. No module deviates.
B. TYPE/PARENT-CHAIN FLOW: galaxy → system (galaxy field + parentOf) → body (system field + parentOf) chains hold in EVERY module that validates them (identity parentOf, catalogue validate, reconstruct deserialize, api lookups). No module disagrees about who owns a body/system.
C. CATALOGUE ↔ MIGRATION: the columns/constraints of world_galaxies/systems/bodies (0013) cover every field the canonical records (galaxy/system/body.ts) carry — no model field missing from SQL and no SQL column the model can't populate. radius/mass/orbit mappings documented consistently.
D. DETERMINISM POLICY: every module derives everything from string seeds via fnv1a — no Math.random/Date/global-state anywhere in src/sim/world/**; idSeed()/seeded helpers consistent.
E. REAL-DATA POLICY: realData/provenance flags are set ONLY by catalogue-derived construction (T05/T07); procedural defaults never carry realData=true; the migration's real_data/provenance defaults match ('procedural').
F. RENDER BOUNDARY: nothing in src/sim/world/** imports from src/ui/** or THREE; render-side may import world-side only. Verify.
G. API/PAYLOAD POLICY: rendererPayload minimalism (no mass/provenance/registries) is enforced by tests; region/query semantics documented.
H. VERSIONING: generationVersion constants (GALAXY=1, SYSTEM=1, BODY=1) exist and the migration defaults generation_version=1; bump policy documented in 0013 header.
I. GLOBAL RULES (roadmap §3): stable canonical IDs, deterministic reconstruction, real-data-first, viewport/renderer-friendly payloads, no duplicates — spot-check each module honors them; flag any module that violates.
J. No obvious duplication (e.g. two modules reimplementing fnv1a or id parsing differently).

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix, which task(s) it implicates). PASS → state the phase-level invariants verified. Be strict — this closes the phase.
