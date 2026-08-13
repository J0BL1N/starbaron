READ-ONLY WHOLE-PHASE AUDIT — StarBaron PHASE 6 (Scouting, Sensors & Intelligence), cross-task coherence.

READ LIST (all Phase 6 deliverables):
- src/sim/intel/permissions.ts + tests/permissions.test.ts  (T01 permission model)
- src/sim/intel/levels.ts + tests/levels.test.ts            (T02 intel levels)
- src/sim/intel/scouts.ts + tests/scouts.test.ts            (T03 scout ships)
- src/sim/intel/missions.ts + tests/missions.test.ts        (T04 scout missions)
- src/sim/intel/reports.ts + tests/reports.test.ts          (T05 intel reports)
- src/sim/intel/staleness.ts + tests/staleness.test.ts      (T06 intel staleness)
- src/sim/intel/pvp-gate.ts + tests/pvp-gate.test.ts        (T07 PvP gating)
- src/sim/intel/store.ts + tests/store.test.ts              (T08 intel store)
- src/sim/ui/hover-intel.ts + tests/hover-intel.test.ts     (T09 hover HUD integration)
- src/sim/intel/sensors.ts + tests/sensors.test.ts          (T10 sensor hooks)
- supabase/migrations/0018_intel.sql + supabase/tests/12_intel.sql (write-only)
- Locked sources: ui/info.ts, ui/hover.ts, ui/validate.ts, fleet/* (ships, fleet, movement), planets/hash.ts, world/api.ts

AUDIT TARGET: the whole Phase 6 feature set on staging (through the P6-T10 PASS state). Docs commits OUT OF SCOPE.

BANNED COMMENT TOKENS (scan comments too — code AND tests): any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random.

CHECK — CROSS-TASK COHERENCE:
A. SINGLE INTEL LADDER: levels.ts (none/observed/scanned/scouted/deep recon/full intelligence) is the ONE ladder — scouts.ts maxIntelLevel, reports.ts REVEAL_MATRIX, pvp-gate intelLevel, store intel_level CHECK, sensors hooks ALL use the same 6 values with the same rank semantics (spot-check each cross-reference; no module invents a different ladder or order).
B. PROMOTION/DECAY CONSISTENCY: recordIntel/promoteIntel (never decreases) ↔ mission recordMissionIntel (strictly-higher re-record) ↔ staleness applyDecay (rung degradation) ↔ pvp-gate (decayed level shown) — the same IntelLevel semantics across all four; no drift (e.g. decay vs promotion disagreeing on the ladder).
C. NO-LEAK CHAIN: permissions (granted sets) → pvp-gate (stranger = intel-store-only, strict no-leak) → hover-intel (public-safe blocked base, ownedBy nulled) → store (RLS owner-only) — verify the chain holds end-to-end: a stranger can NEVER see owner data through ANY Phase 6 path; the info.ts contract levels (public/alliance/intel/owner, owner-top) are consistent with permissions' relationship-exclusive sets.
D. TIME SEMANTICS: assertPositiveAt used everywhere (no local copies); ms timestamps uniform (missions arrival/scan, staleness ages, reports observedAt); boundary conventions consistent (half-open windows; at==X lands on the newer state).
E. ID CONVENTIONS: fnv1a the only hash; report/mission ids deterministic; sort conventions consistent (at desc, id tie-break).
F. PERSISTENCE MIRROR: store.ts shapes ↔ 0018_intel.sql (PK owner+target, ladder CHECK matches levels.ts EXACTLY, numeric ms, sources array, RLS owner-gate); SQL write-only.
G. GAP SCAN vs the roadmap's P6 subtask list (permission model/checks; observed/scanned/scouted/deep recon/full intelligence + coverage semantics; scouting power/range/detection/profile; launch/travel/arrival/scan/report lifecycle + outcomes; observer/target/timestamp/revealed fields; age/decay/freshness/rescout; viewer×target gating/never unauthorized hidden truth; server-side projections + permission checks + no-leak; hover integration + intel status; sensor range/stealth/counter-intel) — flag any subtask with NO implementation surface.
H. No duplicated logic across the 10 modules (same formula/validation implemented twice).

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix, implicated task). PASS → phase-level invariants verified. Keep under ~1300 words.
