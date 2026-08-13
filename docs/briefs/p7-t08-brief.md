TASK (StarBaron P7-T08, master roadmap): HOME-WORLD IMMUNITY — reject attack/conquest on home worlds + backend enforcement: the combat layer's home-world protection (the P2 protection already guards ownership transfers — this module enforces it at the ATTACK/LAUNCH layer: you cannot launch an attack on a home world, and any resolution touching one is rejected). (Pure guard + the write-only SQL enforcement.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/protection.ts (P2-T03): isHomeWorld/deriveProtection — THE locked home-world truth (home worlds unconquerable in EVERY layer — P2 phase audit).
- src/sim/player/transfer.ts (P2-T07): conquestTransfer (throws on protected targets).
- src/sim/combat/attack-orders.ts (P7-T01): launchAttack (needs the home-world guard).
- src/sim/combat/capture.ts (P7-T07 — READ if present; else note it as the consumer).
- supabase/migrations/: the write-only SQL pattern (0014_home_world_protection.sql — READ it: the RLS/trigger enforcement).
- src/sim/player/types.ts: PlayerState.
- src/sim/planets/hash.ts: fnv1a.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/combat/home-immunity.ts
- tests/home-immunity.test.ts
- supabase/migrations/0019_home_immunity.sql (write-only — never applied)
- supabase/tests/13_home_immunity.sql (write-only)

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `HomeImmunity = { targetId: string; isHome: boolean; status: 'immune' | 'attackable'; reason: string; attemptedAt: number }`.
2. Pure functions:
   - `homeImmunityFor(input: { targetId: string; ownerPlayer: PlayerState | null; attemptedAt: number }): HomeImmunity` — DELEGATE the home-world truth to protection.ts (isHomeWorld/deriveProtection — the LOCKED check); immune when the target is the owner's home world (reason 'home world — protected by law' or the protection module's wording — mirror it); attackable otherwise (reason 'not a home world'); attemptedAt validated; ownerPlayer null → attackable (unowned targets are attackable — document).
   - `guardLaunch(input: { targetId: string; ownerPlayer: PlayerState | null; attemptedAt: number }): { allowed: boolean; immunity: HomeImmunity }` — the LAUNCH-layer guard: allowed = !immunity.isHome; throws on attackable? NO — returns { allowed: false, immunity } when home (the caller decides; the launch flow uses this BEFORE launchAttack — document the integration point).
   - `assertConquestPermitted(input: { targetId: string; ownerPlayer: PlayerState | null; attemptedAt: number }): void` — the RESOLUTION-layer guard: throws (Error 'home world — protected') when home; no-op otherwise (matches the P2 transfer throw semantics — the same message class).
3. SQL (write-only 0019 + 13): READ 0014_home_world_protection.sql and MIRROR its style: (a) a trigger/check that an attack/combat row's target is not the target's owner's home world (combat_orders/attack table — mirror the 0017 fleets table naming if the attack rows live there; else a generic function used by RLS/triggers on the attack table — READ the existing schema for the attack/conquest table name and use it); (b) probes in 13: an insert of an attack on a home world FAILS; on a non-home world SUCCEEDS. Write-only — never applied.
4. Invariants (test): homeImmunityFor delegation (hand-built PlayerState with a home world — the locked check flips); unowned → attackable; guardLaunch semantics; assertConquestPermitted throws on home / no-op otherwise; determinism; validation.

TESTS (vitest, tests/home-immunity.test.ts, ~24-30): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/home-immunity.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (SQL write-only; the launch-flow integration point is T11/caller's).
