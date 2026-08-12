READ-ONLY AUDIT — StarBaron PHASE 2 whole-phase, PART 1 OF 2 (model coherence): TS simulation layer only.

READ LIST (TS modules + their tests):
- src/sim/player/profile.ts + tests/profile.test.ts       (T01)
- src/sim/player/assignment.ts + tests/assignment.test.ts (T02)
- src/sim/player/protection.ts + tests/protection.test.ts (T03)
- src/sim/player/ownership.ts + tests/ownership.test.ts   (T04)
- src/sim/player/territory.ts + tests/territory.test.ts   (T05)
- src/sim/player/colonisation.ts + tests/colonisation.test.ts (T06)
- src/sim/player/transfer.ts + tests/transfer.test.ts     (T07)
- src/sim/player/onboarding.ts + tests/onboarding.test.ts (T08)
- src/sim/player/claim.ts + tests/claim.test.ts           (legacy wrapper)
- src/sim/player/grid.ts, player.ts, wallet.ts, types.ts  (support)
- Dependencies: src/sim/world/identity.ts, api.ts (types only), src/boundary/id.ts

AUDIT TARGET: Phase 2 TS feature set on staging (through the latest phase-fix commit). Docs commits OUT OF SCOPE.

CHECK (TS layer only):
A. ID TYPE FLOW: canonical BodyId everywhere; no hand-stringed ids; parseCanonicalId at validation points; claim.ts wrapper derives canonical ids the SAME way as assignment.ts eligibleHomeBodies (no divergent derivation).
B. PROTECTION PARITY: ownership parity gate (isHome === unconquerable) enforced in ownershipFor, deriveProtection, transferOwnership, conquestTransfer — ONE predicate; no path accepts unequal flags.
C. OWNERSHIP CHAIN: acquisition (ownershipFor) → transfer (transferOwnership/conquestTransfer) → history (historyAppend/ownershipHistory) → currentOwner; event previousOwnerId/fromOwnerId consistent; conquestTransfer returns the appended history or documents the caller step — NO unused inputs.
D. DETERMINISM: no nondeterministic APIs / module-level mutable state / wall-clock in src/sim/player/** (id.ts lives in src/boundary — verify NO sim module imports it: the sim-purity fence test covers this — confirm the fence exists and is meaningful).
E. STARTER CONTRACT: STARTER_STRUCTURES {housing:1} used identically in grid.ts, player.ts createPlayer, onboarding initialStructuresFor; claim.ts legacy home path produces the same starter grid; colonies start all-zero (documented distinction).
F. HOME-WORLD INVARIANT: profile.homeWorld assignment is permanent (withHomeWorld rejects a DIFFERENT existing home); entryFlow uses the TRIMMED profile playerId for selection/onboarding (no untrimmed hashing).
G. WALLET/ECONOMY: colonisation/transfer never mutate wallet (caller-owned, documented); legacy wrapper documents its spend ownership.
H. SINGLE OWNERSHIP MODEL: only colonisation.ts implements colonisation; claim.ts delegates (no second implementation with different dup semantics).

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix, implicated task). PASS → invariants verified. Keep this response under ~1200 words.
