TASK (StarBaron P5-T03, master roadmap): FLEET CREATION — composition from ship classes, fleet object model, cost, timing, validation.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/fleet/ships.ts (P5-T01): SHIP_CLASSES, ShipClassId.
- src/sim/fleet/shipyard.ts (P5-T02): canBuildShips, shipBuildCost, ShipBuildRequest.
- src/sim/structures/queues.ts (P3-T07): queueConstruction/ConstructionJob (the timing pattern).
- src/sim/planets/hash.ts: fnv1a (deterministic ids).
- src/sim/player/wallet.ts: WalletState.
- src/sim/player/types.ts: PlayerState.

ALLOWED FILES (create ONLY):
- src/sim/fleet/fleet.ts
- tests/fleet.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `FleetComposition = { scout: number; corvette: number; frigate: number; cruiser: number; battleship: number }` — counts per class (non-negative integers; the zero-composition {0,0,0,0,0} is VALID as 'empty').
2. `Fleet = { id: string; ownerId: string; name: string; composition: FleetComposition; location: { kind: 'planet' | 'system'; bodyId: string }; createdAt: number; status: 'idle' | 'traveling' | 'combat' | 'returning' }`.
3. `FleetCreationRequest = { ownerId: string; name: string; composition: FleetComposition; at: number; shipyardLevel: number; fleet: number; wallet: WalletState }`.
4. Pure functions:
   - `fleetCompositionCost(composition: FleetComposition): { credits: number; alloys: number }` — per-class cost × count summed (LOCKED numbers from SHIP_CLASSES).
   - `fleetCompositionSize(composition: FleetComposition): number` — total ship count.
   - `createFleet(request: FleetCreationRequest): { fleet: Fleet; cost: { credits: number; alloys: number } }` — validation order: at finite > 0; ownerId non-empty; composition counts non-negative integers; shipyard eligibility via shipyard.canBuildShips (the fleet-cap check uses fleetCompositionSize as the count — READ canBuildShips' signature and pass the size; if canBuildShips expects a single class request, use a documented approximation: check total size against cap + per-class cost against wallet — PREFER a direct cost+cap check here and document that canBuildShips is the per-class builder used by T02; the eligibility ladder documented); id = fnv1a(`${ownerId}|${name}|${at}`) deterministic; location default { kind: 'planet', bodyId: <owner's home — REQUEST field? NO — make location an optional request field defaulting to the owner's home planet body id — READ PlayerState for homePlanet.bodyId; if not derivable, make location REQUIRED in the request} — choose the cleaner contract and document.
   - `fleetInvariants(fleet: Fleet): { ok: boolean; problems: string[] }` — id non-empty; ownerId non-empty; composition counts valid; location kind in union + bodyId non-empty; status in union; createdAt finite > 0.
5. Invariants (test): cost math (hand-computed mix: 2 scouts + 1 frigate); size math; createFleet (id determinism — same inputs → same id; different at/name → different); validation (empty owner, negative counts, fractional counts, bad at); location default vs supplied; fleetInvariants tamper classes; immutability; determinism.

TESTS (vitest, tests/fleet.test.ts, ~28-34): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/fleet.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (eligibility approximation vs canBuildShips documented).
