TASK (StarBaron P6-T09, master roadmap): HOVER HUD INTEGRATION — the hover HUD for OTHER players' objects routes through the PvP gate: gated hover info, intel-status line ('Scouted · aging'), blocked-tooltip contract, owner hover unchanged. (Pure integration contract — the hover UI consumes it.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/ui/hover.ts (P4-T02): HoverInfo, hoverInfoFor, HoverTarget.
- src/sim/intel/pvp-gate.ts (P6-T07): pvpGatedView, GatedView.
- src/sim/intel/permissions.ts (P6-T01): ViewerContext, TargetContext.
- src/sim/intel/levels.ts (P6-T02): IntelLevel, coverageFor.
- src/sim/intel/staleness.ts (P6-T06): Freshness, stalenessSummary.
- src/sim/intel/store.ts (P6-T08): IntelStore, storeQuery.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/ui/hover-intel.ts
- tests/hover-intel.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no React wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `IntelHoverInfo = { base: HoverInfo; intelLine: string | null; blocked: string | null; shownFromIntel: boolean }` — intelLine = the deterministic status line ('Scouted intel · aging · updated 3h ago' — from coverageFor(level) + freshness + age; null when not intel-sourced); blocked = the gate's blocked reason (null when shown).
2. Pure functions:
   - `hoverIntelInfo(input: { target: HoverTarget; universe: UniverseState; viewer: ViewerContext; targetContext: TargetContext; intel: TargetIntel | null; ownership?: ReadonlyMap<string, string>; at: number }): IntelHoverInfo` — COMPOSE: base = hoverInfoFor (P4-T02 — the existing per-kind hover data; READ its signature — it takes { target, universe, ownership?, at }); gated = pvpGatedView for the SAME target (the gate decides visibility); when gated.blocked → return { base (the PUBLIC-safe base — note: the base hoverInfoFor may include owner-visible stats; the GATE is authoritative: blocked → the tooltip shows the base's public-safe subset — READ hoverInfoFor's ownedBy gating (it takes viewerLevel? — P4 phase fix added viewerLevel to hoverInfoFor — READ and pass 'public' when blocked, else the gated level); intelLine null; shownFromIntel false }; when shownFromIntel → intelLine from coverageFor(gated.intelLevel) + freshness + age ('Scouted intel · aging · updated 3h ago' — age formatted deterministically, no environment-dependent formatting); base fields = the gated.visible projection mapped onto the hover shape (the base's stats replaced by the gated fields — document the mapping).
   - `intelStatusLine(intel: TargetIntel, at: number): string` — the standalone deterministic line (exported for tests/UI reuse).
3. Invariants (test): owner hover unchanged (no intel line); stranger with fresh intel → intel line + gated stats; stranger without intel → blocked + public-safe base (NO owner stats leak — verify the base's ownedBy/stats are public-safe); expired intel → blocked; unowned → plain public hover; intelStatusLine formats; determinism; validation (bad at).

TESTS (vitest, tests/hover-intel.test.ts, ~26-32): all invariants + leak cases.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/hover-intel.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (the React tooltip rendering is the UI's concern).
