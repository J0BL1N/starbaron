TASK (StarBaron P6-T06, master roadmap): INTEL STALENESS — the decay model: intel age, decay thresholds, freshness states, last-updated tracking, degradation (levels decay over time), re-scout prompts.

CONTEXT — existing code you may READ but NOT modify:
- src/sim/intel/levels.ts (P6-T02): IntelLevel ladder, TargetIntel { targetId, level, lastUpdatedAt, sources }, recordIntel, promoteIntel.
- src/sim/intel/reports.ts (P6-T05): IntelReport (observedAt).
- src/sim/ui/info.ts (P4-T03): InfoState 'stale' semantics.
- src/sim/ui/validate.ts: assertPositiveAt.

ALLOWED FILES (create ONLY):
- src/sim/intel/staleness.ts
- tests/staleness.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level MUTABLE state (tables deep-frozen), no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no backend wiring. Banned comment tokens: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

DESIGN SPEC:
1. `Freshness = 'fresh' | 'aging' | 'stale' | 'expired'` — the freshness ladder (deterministic time-based).
2. Deep-frozen decay thresholds (exported consts): FRESH_WINDOW_SECONDS = 6h; AGING_WINDOW_SECONDS = 24h; STALE_WINDOW_SECONDS = 72h; EXPIRED_AFTER_SECONDS = 168h (1 week) — intel older than EXPIRED is REMOVED from the store (the decay policy; document as balance-harness input).
3. Pure functions:
   - `freshnessFor(intel: TargetIntel, at: number): Freshness` — age = (at − lastUpdatedAt)/1000 (lastUpdatedAt null → 'expired' — never updated); fresh < 6h; aging < 24h; stale < 72h; >= 72h → expired... WAIT — define against the thresholds: age < FRESH → 'fresh'; < AGING → 'aging'; < STALE → 'stale'; >= STALE → 'expired' (expiry = the STALE threshold; the EXPIRED_AFTER const is redundant? — REVISE: keep 4 states with the 3 thresholds: fresh(6h) → aging(24h) → stale(72h) → expired(>=72h); DROP EXPIRED_AFTER_SECONDS to avoid the redundancy — document).
   - `decayedLevel(intel: TargetIntel, at: number): IntelLevel` — the DECAY policy: level degrades with age: fresh → level unchanged; aging → one rung down (max(none, rank(level)−1)); stale → two rungs down; expired → 'none'. Deterministic; the PvP model never shows better-than-current-freshness data (documented).
   - `needsRescout(intel: TargetIntel, at: number): boolean` — stale or expired (the 're-scout prompt' hook: age >= STALE_WINDOW).
   - `applyDecay(intel: TargetIntel, at: number): TargetIntel` — the immutable store update: expired → null (the store drops it — return type TargetIntel | null); otherwise level = decayedLevel, lastUpdatedAt UNCHANGED (the age keeps counting — document: decay doesn't reset the clock; a new recordIntel resets it).
   - `stalenessSummary(intel: TargetIntel, at: number): string` — deterministic ('Fresh · scanned · updated 2h ago' / 'Expired — rescout needed').
4. Invariants (test): freshness boundaries (exact 6h/24h/72h edges — which side each lands on: document + test); decay rungs (fresh/aging/stale/expired × each level — hand-computed table); needsRescout; applyDecay immutability + null on expired + clock preservation; determinism; validation (bad at).

TESTS (vitest, tests/staleness.test.ts, ~28-34): all invariants + the decay table.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/staleness.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (thresholds are balance-harness input; the T08 backend schedules the decay job).
