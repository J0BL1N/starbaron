TASK (StarBaron PHASE 6 phase audit round 4 — FIX ONLY THIS FINDING, no broadening):

ALLOWED FILES: src/sim/intel/levels.ts, src/sim/intel/reports.ts, src/sim/intel/staleness.ts, src/sim/intel/missions.ts, src/sim/intel/sensors.ts, src/sim/intel/intel-ui.ts (the shared-helper home), tests/levels.test.ts, tests/reports.test.ts, tests/staleness.test.ts, tests/missions.test.ts, tests/sensors.test.ts, tests/intel-ui.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDING (fix exactly this):
Duplicated shared validation across intel modules, violating no-duplication:
- levels.ts:108 + reports.ts:189 + staleness.ts:78 each reimplement the same IntelLevel membership assertion over INTEL_LEVELS.
- missions.ts:157 + sensors.ts:86 each reimplement the same finite-positive-number assertion.
Fix: move BOTH into src/sim/intel/intel-ui.ts (the shared pure helper module): export `assertIntelLevel(value: unknown): asserts value is IntelLevel` (RangeError with the established message listing the ladder) and `assertFinitePositive(value: number, label: string): void` (RangeError); all 5 modules import them and DELETE their local copies; tests: intel-ui.test.ts gains ~6-8 cases (assertIntelLevel accept/reject, assertFinitePositive accept/reject + message); the existing module tests keep passing (identical messages).

VERIFY: `npx tsc -b` exit 0; run the 6 test files with --pool threads — all pass (report per-file counts). DO NOT run the full suite.

REPORT: changed lines + which test covers the shared helpers.
