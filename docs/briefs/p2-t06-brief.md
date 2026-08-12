TASK (StarBaron P2-T06, master roadmap): COLONISATION — eligibility, cost, fleet/travel requirement, completion event, ownership creation, duplicate claim prevention.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/ownership.ts (P2-T04): ownershipFor, OwnershipRecord, AcquisitionMethod.
- src/sim/player/protection.ts (P2-T03): conquestAllowed, deriveProtection.
- src/sim/player/assignment.ts (P2-T02): selectHomeWorld patterns.
- src/sim/player/wallet.ts: wallet shape (credits/alloys) — read-only reference.
- src/sim/world/identity.ts: BodyId, parseCanonicalId.
- src/sim/world/api.ts: queryBody (to resolve a target body in state).

ALLOWED FILES (create ONLY):
- src/sim/player/colonisation.ts
- tests/colonisation.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps are INPUTS); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring. Fleet/travel requirements are a P5 concern — represent them as a documented EXTERNAL prerequisite flag (the colonisation model checks the flag, P5 supplies it).

DESIGN SPEC:
1. `ColonisationCost = { credits: number; alloys: number }` — default base cost exported const COLONISATION_BASE_COST = { credits: 500, alloys: 100 } (align with DESIGN.md §5 if it specifies; READ DESIGN.md colonisation section).
2. `ColonisationRequirement = { hasFleet: boolean; hasTravel: boolean }` — external prerequisite flag bundle (P5 supplies the real computation).
3. `ColonisationResult = { ok: true; record: OwnershipRecord; event: OwnershipEvent; cost: ColonisationCost } | { ok: false; reason: 'already-owned' | 'protected' | 'requirements-not-met' | 'insufficient-funds' | 'invalid-target'; cost: ColonisationCost }`.
4. `colonise(input: { bodyId: BodyId; ownerId: string; wallet: { credits: number; alloys: number }; requirements: ColonisationRequirement; existingOwners: ReadonlySet<BodyId>; at: number; protection?: HomeProtection }): ColonisationResult`
   - eligibility order: invalid-target (bodyId doesn't parse) → already-owned (bodyId in existingOwners) → protected (protection?.protected true — P2-T03) → requirements-not-met (missing fleet/travel) → insufficient-funds (credits < cost.credits OR alloys < cost.alloys) → success.
   - success: ownershipFor(bodyId, ownerId, null, at, 'colonisation', false, false) + OwnershipEvent; cost consumed (returned; the wallet mutation is the caller's concern — document).
   - determinism: same inputs → same result.
5. `colonisationCostFor(bodyId: BodyId, base?: ColonisationCost): ColonisationCost` — deterministic: base scaled by fnv1a(bodyId + '|colonise-cost') — mild variance (±10%: 0.9 + (r%21)/100 … keep simple: multiplier = 0.9 + (idSeed(bodyId) % 21) / 100) — exported for UI display.
6. Invariants (test): full eligibility ladder (each rejection reason hits exactly when its condition applies; success only when all pass), cost math + determinism, immutability (inputs not mutated), success record/event fields (method 'colonisation', isHome false), duplicate prevention via existingOwners, protection integration.

TESTS (vitest, tests/colonisation.test.ts, ~24-30): every rejection reason, success path, cost variance determinism + bounds (0.9x-1.1x base), immutability, empty edge cases.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/colonisation.test.ts` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
