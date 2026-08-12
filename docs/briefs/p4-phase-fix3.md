TASK (StarBaron PHASE 4 phase audit round 3 — FIX ALL 3 FINDINGS, no broadening):

ALLOWED FILES: src/sim/ui/info.ts, src/sim/ui/planet-panel.ts, src/sim/ui/data-sources.ts, tests/info.test.ts, tests/planet-panel.test.ts, tests/data-sources.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS. The shared level semantics move to info.ts as the SINGLE source.

FINDINGS (fix exactly these):

1. [T03/T04 — duplicate level logic + wrong owner semantics] planet-panel.ts defines its own PANEL_LEVEL_RANK (owner-top). CONTRACT CORRECTION with rationale: the CORRECT single-source hierarchy is `public < alliance < intel < owner` — the OWNER is the highest authority for an owned object (they must see their own defense/intel-tier data), intel/scouting is the mid tier for OTHER players' objects, alliance is shared-member data, public is everything else. The current info.ts order (`public < owner < alliance < intel`) is semantically wrong: an intel viewer would outrank the object's owner, and the owner could never see their own intel-gated defense. Fix: update info.ts's LEVEL_RANK to `public: 0, alliance: 1, intel: 2, owner: 3` (keep canViewLevel cumulative over it — export it if not exported); DELETE planet-panel's PANEL_LEVEL_RANK/canViewPanelSection and use the info.ts single source (import canViewLevel). Update info.test.ts's rank/level tests to the corrected order (public viewer sees public only; alliance sees public+alliance; intel sees public+alliance+intel but NOT owner fields; owner sees EVERYTHING incl. intel-gated fields). Update planet-panel tests: owner viewer sees all sections incl. defense; intel viewer sees defense but no owner sections; alliance viewer sees no owner sections; public sees none.

2. [T03 — info.ts:49,53-58] INFO_KINDS and INFO_LEVELS are readonly-typed but not runtime-frozen. Wrap both in Object.freeze([...]). Extend the info deep-freeze test to cover them.

3. [T09 — data-sources.ts:217-218] realDataSource delegates bypass assertPositiveAt (mock validates; real doesn't — 0/NaN/Infinity could reach live getters). Fix: call assertPositiveAt(at) in BOTH real-source delegates BEFORE invoking the supplied getters. Add tests: real adapter with at 0/NaN/Infinity throws; valid at passes through to the getter.

VERIFY: `npx tsc -b` exit 0; run the 3 test files with --pool threads — all pass (report per-file counts). DO NOT run the full suite.

REPORT: per-finding changed lines + which test covers which finding.
