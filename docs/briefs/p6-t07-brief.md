TASK (StarBaron P6-T07, master roadmap): PVP INFORMATION GATING — the COMBINED gate: viewer × target → the exact visible picture, combining the permission model (T01) + intel store (T02/T05) + staleness (T06). The roadmap's locked PvP rule: strangers see ONLY what scouting revealed (never fresher/richer than the intel store), owners see everything, and stale intel degrades.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/intel/permissions.ts (P6-T01): permissionFor, effectiveLevelFor, ViewerContext, TargetContext.
- src/sim/intel/levels.ts (P6-T02): TargetIntel, recordIntel, promoteIntel.
- src/sim/intel/staleness.ts (P6-T06): freshnessFor, decayedLevel, applyDecay, needsRescout, Freshness.
- src/sim/intel/reports.ts (P6-T05): IntelReport, buildIntelReport.
- src/sim/ui/info.ts (P4-T03): InfoField, projectInfo.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/intel/pvp-gate.ts
- tests/pvp-gate.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `GatedView = { targetId: string; viewerId: string; visible: InfoField[]; intelLevel: IntelLevel; freshness: Freshness; shownFromIntel: boolean; blocked: string | null }` — blocked = the reason when the viewer gets NOTHING (e.g. 'unowned-public-only', 'expired-intel'); null when the view is shown.
2. Pure functions:
   - `pvpGatedView(input: { viewer: ViewerContext; target: TargetContext; intel: TargetIntel | null; contractFields: InfoField[]; values: ReadonlyMap<string, string | number | null>; at: number }): GatedView` — the COMBINED gate (documented order):
     1. OWNER (permissionFor effectiveLevelFor == 'owner'): visible = ALL contract fields projected with values (projectInfo at 'owner'); shownFromIntel false; intelLevel = the intel store level (or 'full intelligence' when null — document: owner always sees everything; the store is for OTHERS); freshness 'fresh'.
     2. ALLIANCE member: visible = alliance-tier fields (projectInfo at 'alliance'); shownFromIntel false; blocked null.
     3. STRANGER (intel tier): shownFromIntel true — visible = the intel-store projection: contract fields gated by the DECAYED intel level (use reports.REVEAL_MATRIX mapping via buildIntelReport? — READ reports.ts exports; PREFER delegating the reveal to the intel report machinery) filtered by staleness (freshnessFor at `at`): expired intel → blocked 'expired-intel' + visible [] (NEVER shownFromIntel with stale-only data — document: no intel, no picture); otherwise visible = the report fields at decayedLevel, intelLevel = decayedLevel, freshness = freshnessFor.
     4. UNOWNED target: public-only (projectInfo at 'public'); shownFromIntel false; blocked null.
     5. No intel + stranger: visible [] + blocked 'no-intel' (the stranger sees NOTHING beyond public — the locked PvP rule: scouting is the ONLY window).
   - `pvpSummary(view: GatedView): string` — deterministic one-line ('Owner view · full intelligence' / 'Intel view · scanned (aging) — 14 fields' / 'Blocked: no-intel').
3. Invariants (test): owner sees all + never intel-blocked; alliance tier; stranger with fresh intel → decayed-level fields; stranger with expired intel → blocked empty; stranger with NO intel → blocked 'no-intel' + NOTHING (no public-leak — verify: unowned vs owned-by-other distinction — a stranger viewing an OWNED target gets only intel; public fields are NOT shown unless intel exists — DOCUMENT this strict rule); unowned → public; decay interplay (scanned intel aging → observed fields); determinism; validation (bad at).

TESTS (vitest, tests/pvp-gate.test.ts, ~30-36): all invariants + the strict no-leak cases.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/pvp-gate.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (backend enforcement deferred to T08; the gate is the pure decision).
