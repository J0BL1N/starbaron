TASK (StarBaron P4-T09, master roadmap): UI MOCK/REAL DATA BOUNDARY — the contract that separates mock/demo data from real sim data at the UI layer: data source kinds, adapter interface, mock determinism, boundary guard, switch mechanics. (The roadmap's locked rule: mocks and real data NEVER mix silently — a tagged boundary.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/ui/hud.ts (P4-T01), hover.ts (P4-T02), info.ts (P4-T03), planet-panel.ts (P4-T04), system-overview.ts (P4-T05), empire-overview.ts (P4-T06), notifications.ts (P4-T07), layout.ts (P4-T08): the UI-state contracts.
- src/sim/player/player.ts: createPlayer (real player construction).
- src/sim/world/reconstruct.ts: UniverseState.
- src/sim/planets/hash.ts: fnv1a.

ALLOWED FILES (create ONLY):
- src/sim/ui/data-sources.ts
- tests/data-sources.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no React wiring.

DESIGN SPEC:
1. `DataSourceKind = 'mock' | 'real'`.
2. `UiDataSource = { kind: DataSourceKind; label: string; playerAt(at: number): PlayerState; universeAt(at: number): UniverseState }` — the adapter INTERFACE the UI consumes; mock and real both satisfy it (structural typing).
3. `mockDataSource(label: string, seed: string): UiDataSource` — DETERMINISTIC mock: a fixed fixture player (createPlayer-based or a documented hand-built PlayerState with a small deterministic universe — 1 galaxy, 1 system, 1 planet + colonies; seed only affects the label/id suffixes via fnv1a); playerAt/universeAt ignore `at` except validation (finite > 0) and return the SAME state (mock is static — document).
4. `realDataSource(getPlayer: (at: number) => PlayerState, getUniverse: (at: number) => UniverseState): UiDataSource` — the real adapter: delegates to the getters (which the app wires to the live sim/persistence); kind 'real'; label 'live'.
5. `guardReal(source: UiDataSource): UiDataSource` — BOUNDARY GUARD: if source.kind !== 'real', throw (mocks must never be fed to production paths); returns the source unchanged when real. (The reverse guard is implicit: real data is never injected into mock fixtures because mock fixtures are self-contained.)
6. `boundaryReport(sources: readonly UiDataSource[]): { mock: string[]; real: string[]; mixed: boolean }` — labels per kind; mixed = both kinds present (flag for the dev UI).
7. Invariants (test): mock determinism (two sources with same label+seed → deep-equal states; different seeds → different ids/labels); mock kind + static semantics (playerAt different `at` → same state); real adapter delegates (getter called with the right `at`, kind 'real'); guardReal passes real / throws mock; boundaryReport (all-mock, all-real, mixed); validation (bad at).

TESTS (vitest, tests/data-sources.test.ts, ~24-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/data-sources.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
