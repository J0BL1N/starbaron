READ-ONLY WHOLE-PHASE AUDIT — StarBaron PHASE 2 (Players, Home Worlds & Empire Ownership), cross-task coherence.

READ LIST (all Phase 2 deliverables):
- src/sim/player/profile.ts + tests/profile.test.ts       (T01)
- src/sim/player/assignment.ts + tests/assignment.test.ts (T02)
- src/sim/player/protection.ts + tests/protection.test.ts + supabase/migrations/0014_home_world_protection.sql + supabase/tests/08 (T03)
- src/sim/player/ownership.ts + tests/ownership.test.ts + supabase/migrations/0015_ownership_audit.sql + supabase/tests/09 (T04)
- src/sim/player/territory.ts + tests/territory.test.ts   (T05)
- src/sim/player/colonisation.ts + tests/colonisation.test.ts (T06)
- src/sim/player/transfer.ts + tests/transfer.test.ts     (T07)
- src/sim/player/onboarding.ts + tests/onboarding.test.ts (T08)
- Dependencies: src/sim/world/identity.ts (P1-T01), src/sim/world/api.ts + reconstruct.ts (P1-T07/T08), src/sim/player/claim.ts (pre-existing), src/sim/player/wallet.ts, src/sim/player/types.ts

AUDIT TARGET: the whole Phase 2 feature set on staging through ba9fd78302173e01f3801f65e4af005da33455c0, INCLUDING phase-fix commits through round 5 which address your previous findings) consistently; no module hand-strings ids; parseCanonicalId used wherever validation happens.
B. PROTECTION INVARIANT UNIFORMITY: home worlds are unconquerable in EVERY layer — protection.ts (deriveProtection/attemptedConquest), ownership.ts transferOwnership throw, transfer.ts ladder ('protected'), colonisation.ts ladder ('protected'), migration 0014 trigger, migration 0015 audit (no audit row for blocked transfers). No layer disagrees.
C. OWNERSHIP CHAIN CONSISTENCY: ownershipFor (acquisition) → transferOwnership/conquestTransfer (change) → historyAppend/ownershipHistory (audit trail) → currentOwner (resolution). Event previousOwnerId/fromOwnerId semantics consistent between ownership.ts and transfer.ts.
D. DETERMINISM POLICY: no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps are inputs) across ALL player/** modules; identical input → identical output everywhere (spot-check each module).
E. IMPORT BOUNDARIES: player/** may import world/** (sim layer) but NOT src/ui/** or THREE; no module imports catalogue data except through documented injection (onboarding's eligible set is caller-supplied). Verify no rogue imports.
F. WALLET/ECONOMY COUPLING: colonisation/transfer do NOT mutate wallet (caller's concern) — consistent documented pattern; starter values (1000/0/1000, housing:1) consistent between wallet.ts and onboarding.ts.
G. SQL COHERENCE (T03/T04): 0014 trigger + 0015 audit trigger + 0001 schema agree on column names (is_home/unconquerable/owner_id/planet_name); blocked transfer writes NO audit row; RLS lockdown consistent; write-only policy respected (no supabase invocation anywhere in deliverables or commit messages).
H. GLOBAL RULES (roadmap §3): stable canonical IDs; ownership-independent rendering (T05 payloads separate from overlay); backend authority (protection/audit triggers); no duplicate claims (assignment + colonisation + onboarding all prevent dupes); deterministic home assignment.
I. GAP SCAN vs the roadmap subtask list: T01-T08 subtasks (player ID/display/empire/join/settings/progression/home link; eligible-unclaimed/deterministic/atomic/collision/persistence/exhaustion/repeat-login; unconquerable/backend/transfer/edge/UI-state/conquest-tests; owner/previous/method/time/audit; owned query/controlled query/totals/future-moon/empire-summary/ownership-independent-render; eligibility/cost/fleet/travel/completion/creation/dup-prevention; transfer/population/structures/history/transaction/notifications; creation/assignment/initial-resources/initial-structures/camera/tutorial) — flag any subtask with NO implementation anywhere in the phase.
J. No duplicated logic (e.g. two modules implementing the same validation differently).

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix, implicated task(s)). PASS → state the phase-level invariants verified. Be strict — this closes the phase.
