TASK (StarBaron P2-T05, master roadmap): EMPIRE TERRITORY — owned-planet query, controlled-system query, territory totals, empire summary, ownership-independent rendering.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/ownership.ts (P2-T04, just committed): OwnershipRecord, OwnershipEvent, ownershipHistory, currentOwner.
- src/sim/player/types.ts: PlayerState { homePlanet, colonies, wallet, structureLevels }.
- src/sim/world/reconstruct.ts + api.ts (P1-T07/T08): UniverseState, querySystemsByGalaxy, queryBodiesBySystem, regionQuery.
- src/sim/world/identity.ts: BodyId, SystemId, parentOf.
- src/sim/player/profile.ts: PlayerProfile.

ALLOWED FILES (create ONLY):
- src/sim/player/territory.ts
- tests/territory.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock; no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring (but the module MAY import from world/ modules — that's the sim layer).

DESIGN SPEC:
1. `TerritoryTotals = { ownedBodies: number; controlledSystems: number; homeWorlds: number; colonies: number }`.
2. `EmpireSummary = { ownerId: string; totals: TerritoryTotals; ownedBodyIds: BodyId[]; controlledSystemIds: SystemId[]; }`.
3. Pure functions:
   - `ownedBodyIdsFor(records: readonly OwnershipRecord[], ownerId: string): BodyId[]` — deterministic (input order).
   - `controlledSystemsFor(records: readonly OwnershipRecord[], state: UniverseState, ownerId: string): SystemId[]` — systems that contain at least one body owned by the player; derive via state (parentOf(bodyId) or queryBodiesBySystem membership); unique, deterministic (sorted by id).
   - `territoryTotalsFor(records, state, ownerId): TerritoryTotals` — counts.
   - `empireSummaryFor(records, state, ownerId): EmpireSummary`.
   - `renderNeutralPayload(state: UniverseState): { systems: { id: SystemId; name: string }[]; bodies: { id: BodyId; name: string; type: string }[] }` — OWNERSHIP-INDEPENDENT renderer payload: the renderer shows the universe without owner data; ownership overlays come from a SEPARATE ownership payload (defines `ownershipOverlayPayload(records, ownerId)` returning a compact { bodyId, ownerId }[] map — minimal, no names). Document the separation (renderer never receives ownership inside the world payload — matches roadmap 'ownership-independent rendering').
4. Invariants (test):
   - ownedBodyIds order + membership; controlled systems unique + sorted; totals math; summary aggregates; render payload contains NO owner fields (deep scan: no 'owner'/'ownerId' keys); ownership overlay is minimal + keyed by bodyId; determinism.
   - cross-check: controlledSystemsFor result ⊆ systems containing owned bodies in state.

TESTS (vitest, tests/territory.test.ts, ~20-26): use a small built UniverseState (buildUniverseState with catalogue off + a couple of crafted systems/bodies) + crafted ownership records; cover all invariants + determinism + empty inputs (no records → empty totals, no crash).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/territory.test.ts` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
