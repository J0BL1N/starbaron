TASK (StarBaron P2-T01, master roadmap): PLAYER PROFILE — canonical player profile record.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/player/types.ts: PlayerState { playerId, homePlanet: OwnedPlanet, colonies, wallet, structureLevels, lastTickAt } — the RUNTIME state shape (do not break it).
- src/sim/player/player.ts, src/sim/player/index.ts, src/sim/player/claim.ts: existing player/claim logic.
- tests/player-save.test.ts, tests/player-wallet.test.ts: existing conventions.
- src/sim/world/identity.ts (P1-T01): BodyId etc.

ALLOWED FILES (create ONLY):
- src/sim/player/profile.ts
- tests/profile.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock timestamps (a join timestamp is an INPUT, never Date.now() internally); no `any`; strict TS; NO modification of existing files; no UI/DB/rendering wiring.

DESIGN SPEC:
1. `PlayerProfile` (canonical, persistent):
   - playerId: string        (canonical id — non-empty, trimmed, max 64 chars; validated)
   - displayName: string     (1-32 chars, trimmed, no control chars)
   - empireName: string      (2-32 chars, trimmed, no control chars)
   - joinedAt: number        (epoch ms — INPUT to construction, never generated internally)
   - settings: { theme?: 'dark' | 'light'; reducedMotion: boolean; notificationsEnabled: boolean } (defaults dark/true... choose sensible defaults: theme 'dark', reducedMotion false, notificationsEnabled true)
   - progression: { xp: number; level: number; achievementsUnlocked: string[]; prestige?: number } — xp >= 0 integer, level >= 1 integer (derived: level = floor(xp/100)+1 — pure function `levelFromXp(xp)` exported), achievementsUnlocked unique array
   - homeWorld?: BodyId       (link to the canonical world model — optional at profile creation, set by P2-T02)
   - generationVersion: number = 1 (PROFILE_GENERATION_VERSION const)
2. `createPlayerProfile(input: { playerId: string; displayName: string; empireName: string; joinedAt: number; theme?: ...; homeWorld?: BodyId }): PlayerProfile` — validates (throw descriptive Error on invalid id/name lengths/control chars/NaN joinedAt), fills defaults.
3. `validateProfile(p: PlayerProfile): { ok: boolean; problems: string[] }` — every field rule incl. xp/level consistency (level === levelFromXp(xp)), unique achievements, joinedAt finite > 0.
4. `levelFromXp(xp: number): number` — pure, exported.
5. `withHomeWorld(profile: PlayerProfile, homeWorld: BodyId): PlayerProfile` — immutable update (new object), validates the BodyId is a parseable body id (parseCanonicalId from world/identity — ok:true + kind 'body'), throws otherwise.
6. Invariants (test): defaults, name validation (too long/short/empty/control chars → throw), joinedAt NaN/<=0 → throw, levelFromXp(0)=1, levelFromXp(99)=1, levelFromXp(100)=2, levelFromXp(1000)=11, validateProfile ok on valid + problems on each tamper (bad level, dup achievement, bad names), withHomeWorld immutable + valid body id + invalid throws, determinism (same input → deep-equal).

TESTS (vitest, tests/profile.test.ts, ~24-30): all of the above + edge cases.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/profile.test.ts` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations.
