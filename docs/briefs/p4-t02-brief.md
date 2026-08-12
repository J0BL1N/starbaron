TASK (StarBaron P4-T02, master roadmap): CONTEXTUAL HOVER INTELLIGENCE HUD — galaxy hover, system hover, star hover, planet hover, moon hover, asteroid hover, smooth target switching contract.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/world/reconstruct.ts + api.ts (P1-T07/T08): UniverseState, queryGalaxy, querySystem, queryBody, queryBodiesBySystem.
- src/sim/world/identity.ts: parseCanonicalId, parentOf.
- src/sim/world/body.ts: BodyRecord (type star/planet/moon/asteroid, radius, orbit).
- src/sim/world/galaxy.ts: GalaxyRecord (class).
- src/sim/world/system.ts: SystemRecord (star metadata).
- src/sim/player/ownership.ts (P2-T04): OwnershipRecord.
- src/sim/player/territory.ts (P2-T05): ownershipOverlayPayload pattern.
- src/sim/ui/hud.ts (P4-T01): HudLocation kind pattern.

ALLOWED FILES (create ONLY):
- src/sim/ui/hover.ts
- tests/hover.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no React/rendering wiring.

DESIGN SPEC:
1. `HoverTarget = { kind: 'galaxy' | 'system' | 'body'; id: string }` — id is the canonical id string.
2. `HoverInfo = { target: HoverTarget; title: string; subtitle: string; stats: { label: string; value: string }[]; ownedBy: string | null; summary: string }` — stats labels/values deterministic, values via locked formatNumber (no locale APIs); ownedBy from the ownership overlay (null when unowned/unknown).
3. Pure functions:
   - `hoverInfoFor(input: { target: HoverTarget; universe: UniverseState; ownership?: ReadonlyMap<string, string>; at: number }): HoverInfo`
     - galaxy: title = name; subtitle = class ('Spiral galaxy' etc.); stats: systems count (galaxy.systemIds.length), real-data flag; ownedBy: null (galaxies aren't owned in v1 — document).
     - system: title = name; subtitle = star summary ('G-class star' from starType); stats: body count (bodyIds.length), position magnitude (rounded, from galaxy-local position); ownedBy: null (systems derive ownership from bodies — document).
     - body: title = name; type label (star/planet/moon/asteroid); stats: radius (locked formatNumber), type, orbit period (rounded seconds); ownedBy from ownership map (body id → owner id) when present.
     - unknown/missing target (query miss or unparseable id): return null? NO — the contract: `hoverInfoFor` returns HoverInfo | null (null when the target doesn't resolve — document that the UI hides the tooltip). Fix the type: `HoverInfo | null`.
   - `resolveHoverTarget(raw: string): HoverTarget | null` — parseCanonicalId → kind mapping (galaxy/system/body), null on unparseable.
   - `smoothSwitch(from: HoverTarget | null, to: HoverTarget, at: number): { from: HoverTarget | null; to: HoverTarget; at: number; immediate: boolean }` — the SMOOTH TARGET SWITCHING contract: immediate = from === null || from.kind !== to.kind (cross-kind switches are immediate; same-kind switches are smooth — the animation timing is the UI's concern; the contract records the transition data). Deterministic.
4. Invariants (test): hoverInfoFor per kind (fields, stats, ownedBy); null on miss/unparseable; resolveHoverTarget round-trip; smoothSwitch immediate/smooth classification; determinism; stats formatting via formatNumber; validation (bad at).

TESTS (vitest, tests/hover.test.ts, ~26-32): all invariants + edges (body owned/unowned, missing target, galaxy without systems).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/hover.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
