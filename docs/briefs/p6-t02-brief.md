TASK (StarBaron P6-T02, master roadmap): INTEL LEVELS — the scouting QUALITY tiers: observed / scanned / probed (and the roadmap's full subtask list — READ the master roadmap's T02 section for the complete set), level ordering, coverage semantics, promotion rules (what upgrades an intel level), staleness interplay (deferred to T06 but the LEVEL model must expose the hooks).

CONTEXT — existing code you may READ but NOT modify:
- docs/MASTER-ROADMAP.md: the P6-T02 subtask list (READ it — the exact tier names come from there).
- src/sim/intel/permissions.ts (P6-T01): granted sets (intel tier for strangers).
- src/sim/ui/info.ts (P4-T03): InfoState (unknown/estimated/stale/verified).
- src/sim/fleet/ships.ts (P5-T01): scout class scoutingPower=100.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/intel/levels.ts
- tests/levels.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock; no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `IntelLevel = 'none' | 'observed' | 'scanned' | 'probed'` — the scouting QUALITY ladder (verify the roadmap's T02 subtask names; 'observed' = passive fly-by, 'scanned' = scout visit, 'probed' = deep scan — rename to the roadmap's exact names if they differ).
2. `TargetIntel = { targetId: string; level: IntelLevel; lastUpdatedAt: number | null; sources: readonly string[] }` — sources = deterministic ids of what produced the intel (scout mission ids — fnv1a strings; T04 wires them).
3. Pure functions:
   - `INTEL_LEVEL_RANK: Readonly<Record<IntelLevel, number>>` — deep-frozen; none 0 < observed 1 < scanned 2 < probed 3 (documented).
   - `higher(a: IntelLevel, b: IntelLevel): IntelLevel` — max by rank (deterministic; equal → a).
   - `promoteIntel(current: IntelLevel, gained: IntelLevel): IntelLevel` — the promotion rule: max(current, gained) (intel levels NEVER decrease through promotion — documented; decay is T06's staleness concern).
   - `recordIntel(target: TargetIntel, input: { level: IntelLevel; at: number; source: string }): TargetIntel` — immutable: level = promoteIntel(current, input.level); lastUpdatedAt = at (validated positive finite); source appended to sources (dedup — same source string not added twice); the level-hook for T04 scout missions.
   - `coverageFor(level: IntelLevel): string` — deterministic coverage description ('Nothing known', 'Observed: presence + class', 'Scanned: structures + defenses', 'Probed: full detail incl. fleet activity') — the roadmap's 'coverage semantics' (adjust strings to the roadmap's framing; document).
   - `levelFromInfoState(state: InfoState): IntelLevel` — the HUD-INTEROP hook: verified → probed, estimated → scanned, stale → observed, unknown → none (documented mapping; T06 refines staleness handling).
4. Invariants (test): rank order; higher/promoteIntel (never decreases, max semantics); recordIntel (promotion, lastUpdatedAt, source dedup, immutability); coverageFor per level; levelFromInfoState mapping; determinism; validation (bad at, empty source).

TESTS (vitest, tests/levels.test.ts, ~26-32): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/levels.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (staleness/decay deferred to T06).
