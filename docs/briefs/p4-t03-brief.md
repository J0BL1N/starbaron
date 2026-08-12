TASK (StarBaron P4-T03, master roadmap): OBJECT INFORMATION CONTRACTS — public information, owner-visible information, alliance-visible information, intel-gated information, unknown/estimated/stale/verified states, per-object display schema. (The CONTRACT layer — P6 implements the backend enforcement; this task defines the contracts + pure projection.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/body.ts, system.ts, galaxy.ts: record shapes.
- src/sim/world/api.ts: query layer.
- src/sim/player/ownership.ts: OwnershipRecord.
- src/sim/player/territory.ts: ownership overlay.
- src/sim/core/format.ts: formatNumber.

ALLOWED FILES (create ONLY):
- src/sim/ui/info.ts
- tests/info.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no React wiring. Backend enforcement (P6) is OUT of scope — the module defines the contract + a pure projection function the UI can render.

DESIGN SPEC:
1. `InfoLevel = 'public' | 'owner' | 'alliance' | 'intel'` — visibility levels (locked by the roadmap; P6 maps these to backend permission checks).
2. `InfoState = 'unknown' | 'estimated' | 'stale' | 'verified'` — per-field state qualifier.
3. `InfoField = { key: string; label: string; value: string | null; level: InfoLevel; state: InfoState; format?: 'number' | 'text' }`.
4. `ObjectInfoContract = { kind: 'galaxy' | 'system' | 'body'; type?: string; fields: InfoField[]; displaySchema: { titleKey: string; subtitleKey: string; primaryStatKey: string } }`.
5. Pure functions:
   - `contractFor(kind: 'galaxy' | 'system' | 'body', type?: string): ObjectInfoContract` — the per-object display schema: which fields exist, their base level (public: name/id/type/class; owner: population/structures/income; alliance: alliance-held flags; intel: fleet/defense details), and the display schema (title/subtitle/primary stat keys). Deterministic; every field key unique.
   - `projectInfo(input: { contract: ObjectInfoContract; values: ReadonlyMap<string, string | number | null>; viewerLevel: InfoLevel; staleness: ReadonlyMap<string, boolean> }): InfoField[]` — the PURE PROJECTION: for each field, level <= viewerLevel → include (value from values, state from staleness: stale when flagged else verified; value null → state 'unknown'); level > viewerLevel → EXCLUDE (the field is absent — never a placeholder value; the client never sees hidden truth — mirrors the roadmap's 'never send unauthorized hidden truth'). Unknown values (missing from the map) → state 'unknown', value null.
   - `summaryLine(fields: InfoField[]): string` — deterministic one-line summary of the visible fields (title + primary stat).
6. Invariants (test): contractFor per kind (field sets + levels + display schema uniqueness); projection: viewer levels include/exclude correctly (owner sees owner fields; public viewer doesn't); stale flags → state 'stale'; missing values → 'unknown'; hidden fields NEVER appear even as placeholders; summaryLine; determinism; validation (bad kind).

TESTS (vitest, tests/info.test.ts, ~26-32): all invariants + edges (all viewer levels, all states).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/info.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (backend enforcement deferred to P6).
