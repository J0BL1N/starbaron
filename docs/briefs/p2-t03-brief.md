TASK (StarBaron P2-T03, master roadmap): HOME-WORLD PROTECTION — mark home as unconquerable, backend enforcement, UI-exposed protected state, attempted-conquest detection.

CONTEXT — existing code you may READ but NOT modify:
- supabase/migrations/0001_players_owned_planets.sql: owned_planets has is_home + unconquerable columns + one-home partial index (owner_id) where is_home.
- supabase/migrations/0005_attack_rpcs.sql, 0011_band_together.sql, 0012_fortification_commitment.sql: existing attack/conquest RPCs (READ to understand the conquest flow + conventions).
- supabase/tests/02_attack_rls.sql: existing attack contract tests (style reference).
- src/sim/player/types.ts: OwnedPlanet { isHome, unconquerable }.
- src/sim/player/profile.ts: PlayerProfile.homeWorld (BodyId).
- src/sim/world/identity.ts: BodyId, parseCanonicalId.
- DESIGN.md: the 'unconquerable home' locked decision (§5).

ALLOWED FILES (create ONLY):
- src/sim/player/protection.ts
- tests/protection.test.ts
- supabase/migrations/0014_home_world_protection.sql
- supabase/tests/08_home_world_protection.sql

RESTRICTIONS: pure module (no nondeterministic APIs, no module-level mutable state, no wall-clock, no `any`, strict TS); SQL WRITE-ONLY (no supabase commands); NO modification of existing files; no UI/DB/rendering wiring beyond the SQL deliverable.

DESIGN SPEC — protection.ts (pure model):
1. `HomeProtection = { bodyId: BodyId; ownerId: string; protected: boolean; protectedSince?: number; reason?: string }` — reason ∈ 'home-world' (locked).
2. `deriveProtection(bodyId: BodyId, ownerId: string, isHome: boolean, unconquerable: boolean): HomeProtection` — protected = isHome && unconquerable; if protected, reason 'home-world'; protectedSince is an INPUT (never Date.now() internally).
3. `attemptedConquest(input: { target: HomeProtection; attackerId: string }): { rejected: boolean; reason?: 'home-world-protected'; details: string }` — rejected when target.protected (any attacker incl. owner; a home world can never be conquered).
4. `conquestAllowed(target: HomeProtection): boolean` — !target.protected.
5. `protectionStateForUi(p: HomeProtection): { protected: boolean; label: string }` — label 'Unconquerable home world' when protected, 'Conquerable' otherwise.
6. Invariants: deriveProtection only protects when BOTH isHome && unconquerable; attemptedConquest rejects protected targets and allows unprotected; determinism; immutability (no mutation of inputs).

DESIGN SPEC — 0014_home_world_protection.sql (write-only migration):
- A trigger (BEFORE UPDATE OR DELETE? — think) on public.owned_planets that RAISEs when a row with unconquerable = true would have its owner_id changed (ownership transfer) or be deleted. The conquest RPCs update owner_id — the trigger blocks home-world transfers at the DB level (backend enforcement). Do NOT block updates of other columns (population etc.).
- Also guard: prevent a non-home row from being updated to is_home = true while another home exists? NO — the partial index already enforces one home. Keep the trigger scope to ownership-transfer/delete protection of unconquerable rows.
- Header comment documenting the design decision + interaction with the attack RPCs.
- Idempotent constructs (DROP TRIGGER IF EXISTS + CREATE TRIGGER, or DO-block guards).

DESIGN SPEC — 08_home_world_protection.sql (contract tests, repo psql style):
- Insert a home row (is_home + unconquerable true) → UPDATE owner_id → trigger raises (expected); population update on the same row → allowed.
- DELETE on an unconquerable row → raises.
- A conquerable row (unconquerable false) → owner_id update allowed.
- anon still sees zero rows (permission-denied assertion, matching conventions).
- Re-running the migration's idempotent constructs does not error (documented re-run contract).

TESTS (vitest, tests/protection.test.ts, ~18-22): deriveProtection combinations, attemptedConquest rejection/allow, conquestAllowed, protectionStateForUi labels, determinism, immutability.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/protection.test.ts` all pass (counts); SQL static read-back only — DO NOT run the full suite. Report changed files, commands + results, limitations.
