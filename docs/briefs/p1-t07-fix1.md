TASK (StarBaron P1-T07, design-tension resolution — the audited canonical model requires parent chains to hold EXACTLY):

PROBLEM: reconstruct.ts re-homes catalogue systems onto the home galaxy by repointing the declared `galaxy` field, but their ids still encode the 'catalogue' slug (`sys:catalogue|<hostname>`), so `parentOf(system.id)` resolves to a phantom `gal:catalogue` galaxy — the canonical parent chain is broken for re-homed catalogue systems.

FIX (make the chain exact):
1. src/sim/world/catalogue.ts: extend `buildCatalogueMapping(planets, meta?, opts?: { galaxySlug?: string })` — when `opts.galaxySlug` is provided, system ids are built as `systemId(opts.galaxySlug, hostname)` AND the mapping's galaxy record is built with that slug (galaxyId(opts.galaxySlug), same position/seed semantics as the default). Default behaviour (no opts) is IDENTICAL to today ('catalogue' slug) — all existing P1-T05 tests must still pass unchanged.
2. src/sim/world/reconstruct.ts: call `buildCatalogueMapping(PLANETS, PLANET_SNAPSHOT, { galaxySlug: config.seed })` and drop the re-homing logic — catalogue systems now have canonical parents === home galaxy id by construction. Keep the realData/provenance passthrough. Update any tests that asserted the old re-homed behaviour.
3. tests/reconstruct.test.ts: add/adjust an assertion that for a catalogue-on state, EVERY system's `parentOf(system.id)` equals the home galaxy id, and every body's `parentOf(body.id)` equals its declared system (the full exact chain).

ALLOWED FILES: src/sim/world/catalogue.ts, src/sim/world/reconstruct.ts, tests/reconstruct.test.ts. Do NOT touch tests/catalogue.test.ts (must stay green with the backwards-compatible default).

RESTRICTIONS: pure modules, no `any`, strict TS, no banned tokens in comments, deterministic.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/catalogue.test.ts` (all pass, unchanged suite); `npx vitest run tests/reconstruct.test.ts` (all pass, updated). DO NOT run the full suite. Report changed lines + results.
