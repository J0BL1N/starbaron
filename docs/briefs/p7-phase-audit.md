READ-ONLY WHOLE-PHASE AUDIT — StarBaron PHASE 7 (Combat & Planet Conquest), cross-task coherence.

READ LIST (all Phase 7 deliverables):
- src/sim/combat/attack-orders.ts + tests/attack-orders.test.ts   (T01)
- src/sim/combat/invasion.ts + tests/invasion.test.ts             (T02)
- src/sim/combat/resolution.ts + tests/resolution.test.ts         (T03)
- src/sim/combat/defense.ts + tests/defense.test.ts               (T04)
- src/sim/combat/casualties.ts + tests/casualties.test.ts         (T05)
- src/sim/combat/conquest-cost.ts + tests/conquest-cost.test.ts   (T06)
- src/sim/combat/capture.ts + tests/capture.test.ts               (T07)
- src/sim/combat/home-immunity.ts + tests/home-immunity.test.ts   (T08)
- src/sim/combat/combat-reports.ts + tests/combat-reports.test.ts (T09)
- src/sim/combat/sim-harness.ts + tests/sim-harness.test.ts       (T10)
- src/sim/ui/attack-notifications.ts + tests/attack-notifications.test.ts (T11)
- supabase/migrations/0019_home_immunity.sql + supabase/tests/13_home_immunity.sql (write-only)
- Locked sources: player/transfer.ts, player/protection.ts, player/ownership.ts, player/estimator.ts, structures/effects.ts, fleet/movement.ts, fleet/ships.ts, fleet/fleet.ts, core/format.ts, ui/notifications.ts, ui/validate.ts, planets/hash.ts

AUDIT TARGET: the whole Phase 7 feature set on staging (through the P7-T11 PASS state, INCLUDING the phase-fix commit 16d87ab which addresses findings 1-4; finding 5 docs-reference fixed in the prompt). Docs commits OUT OF SCOPE.

BANNED COMMENT TOKENS (scan comments too — code AND tests): any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

CHECK — CROSS-TASK COHERENCE:
A. SINGLE COMBAT CHAIN: the launch → travel → resolve → casualties → capture → report flow must be ONE consistent chain: attack-orders (launch, DESIGN-locked cost via estimator) → resolution (AP/DP via locked attackPower/defensePower) → casualties (outcome delegation) → conquest-cost (victory) → capture (conquestTransfer delegation + ownership binding) → combat-reports (outcome/ledger binding) → sim-harness (the whole chain replayable) → attack-notifications (the UI projection). Verify each module calls the PREVIOUS module's exported functions (or locked sources) — no module re-derives another's formulas; spot-check every delegation edge (especially: resolution AP/DP, casualties survivors/defenderCasualties, capture transfer, harness chain, reports winner/loser).
B. NUMBER AGREEMENT: AP = troops × shipyardTier (estimator), DP = effects.defensePower (turrets+militia), garrison-inclusive total is the DEFENSE-view total (defense.ts) while the resolver uses the locked DP — no layer conflates them; casualty rates (0.3/0.5/0.2/0.1), conquest curve (2,000/1,000/50,000 × tier, ×1+0.1/conquest cap 2.0), launch cost (200 + 0.2×fleet + 10×pc) — consistent everywhere they appear; the harness fixture numbers internally consistent.
C. GUARD CHAIN: home-world immunity (T08) must be respected through the WHOLE chain — launch (guardLaunch), resolution/capture (assertConquestPermitted + conquestTransfer's protected refusal + capture's ownership binding); a protected home can NEVER be captured through any path; no layer fabricates ownership records (capture receives the real record).
D. TIME SEMANTICS: assertPositiveAt everywhere; ms epoch vs seconds units consistent (movement travelDuration seconds vs launchAt/resolvedAt ms — documented at each boundary); half-open windows (at == arrivalAt → arrived); stalemate boundary AP == DP documented.
E. ID CONVENTIONS: fnv1a the only hash; ids deterministic (attack/order ids, battleId, captureId, reportId, notificationId — hex convention consistent).
F. UI CONTRACTS: attack-notifications follows the P4 notification conventions (unread semantics documented); combat-reports/capture summary strings deterministic.
G. GAP SCAN vs the roadmap's P7 subtask list — READ docs/MASTER-ROADMAP.md's "## T01 — Attack Orders" … "## T11 — Attack Notifications" sections for the authoritative P7 subtask list (the old ROADMAP.md predates Phase 7; MASTER-ROADMAP.md is the canonical phase/task source; docs/ROADMAP-STATUS.md is the completion tracker with per-task evidence) — flag any subtask with NO implementation surface.
H. No duplicated logic across the 11 modules (same formula/validation implemented twice).

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix, implicated task). PASS → phase-level invariants verified. Keep under ~1300 words.
