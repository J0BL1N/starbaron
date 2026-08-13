TASK (StarBaron P7-T01, master roadmap): ATTACK ORDERS — the attack-order model: launch an attack (fleet + target), travel to target, attack resolution hook, attack lifecycle. (DESIGN's locked attack flow: scout → assemble → launch → wait → resolve → report; attack cost = population + fleet — READ DESIGN lines ~120-186 and mirror its locked numbers.)

CONTEXT — existing code you may READ but NOT modify:
- DESIGN.md §5 (lines ~108-186): the LOCKED attack model — Attack Power (AP) = deployed soldiers (fleet) × shipyard tier; launch cost = `200 cr + fleet × 0.2 cr + distancePc × 10 cr`; attack cost = population + fleet (committed troops lost whether win or lose); travel = real distance.
- src/sim/fleet/orders.ts (P5-T07): FleetOrder (attack order type exists).
- src/sim/fleet/movement.ts (P5-T04): planTravel, TravelLeg, arrivalTime.
- src/sim/fleet/fleet.ts (P5-T03): Fleet, FleetComposition, fleetCompositionSize.
- src/sim/player/types.ts: PlayerState, OwnedPlanet.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/attack-orders.ts   (new folder src/sim/combat/)
- tests/attack-orders.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `AttackOrder = { id: string; attackerId: string; fleetId: string; targetRef: { kind: 'planet' | 'system'; id: string }; troopsCommitted: number; launchAt: number; arrivalAt: number; status: 'launched' | 'traveling' | 'arrived' | 'resolving' | 'resolved' | 'aborted'; launchCost: { credits: number }; outcome: 'pending' | 'victory' | 'defeat' | 'aborted' }` — id = fnv1a(`${attackerId}|${fleetId}|${launchAt}|${targetId}`) deterministic.
2. Pure functions:
   - `attackLaunchCost(fleetSize: number, distancePc: number): { credits: number }` — the LOCKED formula from DESIGN: credits = 200 + fleetSize × 0.2 + distancePc × 10 (DELEGATE to a locked source if one exists — READ DESIGN/old code for an existing launch-cost function; if none, mirror DESIGN's numbers with the formula exported as consts ATTACK_LAUNCH_BASE_CR = 200, ATTACK_LAUNCH_PER_FLEET_CR = 0.2, ATTACK_LAUNCH_PER_PC_CR = 10 — documented as DESIGN-locked).
   - `launchAttack(input: { attackerId: string; fleetId: string; targetRef: { kind; id }; troopsCommitted: number; fleetSize: number; distancePc: number; launchAt: number; speedPcPerSec: number; wallet: WalletState }): { order: AttackOrder; cost: { credits: number } }` — validation: troopsCommitted positive integer; fleetSize >= troopsCommitted? NO — DESIGN: troops come from the fleet (committed soldiers); require troopsCommitted <= fleetSize (the committed subset — throw otherwise); launch cost = attackLaunchCost(fleetSize, distancePc) — wallet sufficient (throw insufficient); arrivalAt = launchAt + travelDuration(distance, speed) × 1000 (overflow-safe via movement.arrivalTime — DELEGATE); status 'launched'.
   - `attackStatusAt(order: AttackOrder, at: number): { status: string; outcome: string; progress: string }` — time projection (at < launchAt → launched; launchAt..arrivalAt → traveling; arrivalAt..resolution → arrived (the resolution window — resolution timing is P7-T03's concern; the window here is [arrivalAt, ∞) until resolved); resolved → resolved + outcome); aborted → aborted; progress string deterministic ('en route · 45%' — percentage = (at − launchAt)/(arrivalAt − launchAt) clamped — document).
   - `abortAttack(order: AttackOrder, at: number): AttackOrder` — launched/traveling → aborted (arrived/resolved cannot abort — throw); outcome 'aborted'.
3. Invariants (test): launch cost math (hand-computed from DESIGN: 5,000-fleet raid on 10 pc → 200 + 1000 + 100 = 1,300 cr — the DESIGN example); troops cap (committed > fleetSize throws); wallet sufficiency; arrival math + overflow; id determinism; status projection windows + boundaries (at == launchAt → traveling; at == arrivalAt → arrived — match positioning conventions); abort transitions; immutability; determinism; validation.

TESTS (vitest, tests/attack-orders.test.ts, ~30-36): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/attack-orders.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (resolution deferred to T03).
