TASK (StarBaron P6-T05, master roadmap): INTEL REPORTS — the report contract: observer player, target object, timestamp, revealed fields (field-by-field reveal per intel level), report generation, dedup.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/intel/levels.ts (P6-T02): IntelLevel ladder + coverageFor.
- src/sim/intel/permissions.ts (P6-T01): permissionFor (what the observer may see).
- src/sim/ui/info.ts (P4-T03): InfoField, contractFor, projectInfo (the display-schema machinery).
- src/sim/fleet/missions.ts (P6-T04): ScoutMission (the report source).
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/intel/reports.ts
- tests/reports.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `IntelReport = { id: string; observerId: string; targetRef: { kind: 'galaxy' | 'system' | 'body'; id: string }; targetName: string; intelLevel: IntelLevel; observedAt: number; revealedFields: InfoField[]; source: string }` — id = fnv1a(`${observerId}|${targetId}|${observedAt}`) deterministic.
2. Pure functions:
   - `buildIntelReport(input: { observerId: string; targetRef: { kind; id }; targetName: string; intelLevel: IntelLevel; observedAt: number; fields: ReadonlyMap<string, string | number | null>; staleness?: ReadonlyMap<string, boolean>; source?: string }): IntelReport` — REVEALED FIELDS = the fields the intel level unlocks: use info.ts contractFor(targetRef.kind) + a REVEAL_MATRIX (deep-frozen, exported): per IntelLevel, which contract levels are revealed (observed → public fields only; scanned → public + owner-lite (name/type/class); scouted → + population/structures summaries; deep recon → + defenses; full intelligence → all incl. fleet activity — the MATRIX is the single mapping table, documented; map the roadmap's intel ladder onto info.ts's field levels); revealedFields = contract fields whose field level is <= the matrix's permitted level for the report's intelLevel, values from the fields map (null → state unknown), formatted per the info contract (reuse projectInfo? READ its signature — if it fits (contract + values + viewerLevel + staleness), DELEGATE to it with viewerLevel = the mapped info level; else replicate the field-filtering with a documented note). PREFER delegation to projectInfo.
   - `reportInvariants(r: IntelReport): { ok: boolean; problems: string[] }` — id matches the deterministic formula; observerId non-empty; intelLevel valid; observedAt positive finite; revealedFields keys unique + within the contract's field set; source non-empty.
   - `reportsForTarget(reports: readonly IntelReport[], targetId: string, at: number): IntelReport[]` — the observer's report list for a target, NEWEST first (observedAt desc, id tie-break), validated at.
3. Invariants (test): reveal matrix per level (each ladder rung reveals exactly the documented field set — hand-check observed vs full intelligence); buildIntelReport fields from the map; unknown values → 'unknown' state; id determinism; reportInvariants tamper classes; reportsForTarget ordering; validation; determinism; no mutation.

TESTS (vitest, tests/reports.test.ts, ~30-36): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/reports.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (report DELIVERY/storage is the backend's concern — T08).
