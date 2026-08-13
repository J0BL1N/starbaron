TASK (StarBaron P6-T01, master roadmap): INTEL PERMISSION MODEL — who can see what: viewer × target → permitted InfoLevel, permission checks, alliance/owner relationships, the single source for P6-T07's PvP gating. (Builds on P4-T03's InfoLevel; the enforcement layer P6-T08 wires into the backend.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/ui/info.ts (P4-T03): InfoLevel ('public' | 'owner' | 'alliance' | 'intel'), canViewLevel (the corrected owner-top hierarchy public < alliance < intel < owner).
- src/sim/player/ownership.ts (P2-T04): OwnershipRecord.
- src/sim/ui/validate.ts: assertPositiveAt.
- src/sim/planets/hash.ts: fnv1a.

ALLOWED FILES (create ONLY):
- src/sim/intel/permissions.ts   (new folder src/sim/intel/)
- tests/permissions.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state, no wall-clock; no `any`; strict TS; NO modification of existing files; no backend wiring (T08). Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `ViewerContext = { viewerId: string; alliances: readonly string[]; isAdmin?: boolean }` — the viewer's identity + alliance memberships (admin = debug/QA override, documented).
2. `TargetContext = { targetId: string; ownerId: string | null; ownerAlliances: readonly string[]; isHome?: boolean }` — the target object's ownership (ownerId null = unowned/purely public).
3. `PermissionResult = { level: InfoLevel; allowed: boolean; reason: 'owner' | 'alliance' | 'intel' | 'public' | 'admin' | 'denied' }`.
4. Pure functions:
   - `permissionFor(viewer: ViewerContext, target: TargetContext, requested: InfoLevel): PermissionResult` — the permission model (documented + locked by tests):
     - admin → allowed at 'owner' level (reason 'admin').
     - viewer === ownerId → allowed at 'owner' (reason 'owner').
     - target.ownerId null → public-only: allowed only when requested <= public (canViewLevel semantics at the public tier); else denied.
     - ownerAlliances ∩ viewer.alliances non-empty → allowed up to 'alliance' (reason 'alliance'); 'intel'/'owner' denied.
     - otherwise (stranger): allowed up to 'intel' (reason 'intel' — scouting tier; the roadmap's PvP model: strangers get scouted intel, never owner/alliance data); requested 'owner'/'alliance' denied.
     - requested level ABOVE the permitted tier → denied with the permitted level as context.
   - `effectiveLevelFor(viewer: ViewerContext, target: TargetContext): InfoLevel` — the MAX level this viewer may see for this target (owner > alliance > intel > public — the corrected hierarchy; admin → owner).
   - `intelGrants(viewer: ViewerContext, target: TargetContext): { level: InfoLevel; canSee: Record<InfoLevel, boolean> }` — canSee per level (cumulative from the effective level, using the corrected hierarchy order).
5. Invariants (test): owner sees all; admin override; alliance sees alliance tier (not owner/intel); stranger sees intel (not owner/alliance); unowned → public only; denied reasons; effectiveLevel ordering; intelGrants cumulative; determinism; validation (empty viewerId throws).

TESTS (vitest, tests/permissions.test.ts, ~28-34): all invariants + edges (viewer in multiple alliances, target in multiple alliances, admin+owner, empty alliances).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/permissions.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (backend enforcement deferred to T08).
