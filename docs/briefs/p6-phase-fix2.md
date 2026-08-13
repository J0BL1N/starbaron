TASK (StarBaron PHASE 6 phase audit round 2 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/intel/pvp-gate.ts, src/sim/intel/staleness.ts, src/sim/ui/hover-intel.ts, tests/pvp-gate.test.ts, tests/staleness.test.ts, tests/hover-intel.test.ts, tests/sensors.test.ts. NEW file allowed: src/sim/intel/intel-ui.ts (the shared helpers) + tests/intel-ui.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens (and NO banned token LITERALS in code/tests — construct any needed scan-test strings via concatenation).

CODEX FINDINGS (fix exactly these):

1. [tests/sensors.test.ts:344-356] A source-scan regression test embeds the banned tokens AS LITERAL STRINGS (Math.random, Date.now, locale, wall, random, any). Fix: build those strings via concatenation of safe fragments (e.g. `'Math' + '.random'`) so the file itself never contains the banned substrings, while the scan assertion still works.

2. [T06/T07/T09 — duplicated helpers] (a) pvp-gate.ts:107-112 + hover-intel.ts:100-105 independently define the same InfoLevel rank table and highest-visible-tier algorithm (pvp-gate.ts:306-314, hover-intel.ts:183-191); (b) staleness.ts:170-182 + hover-intel.ts:119-131 independently implement the same floored s/m/h/d age-label formula. Fix: create src/sim/intel/intel-ui.ts exporting (i) `infoLevelRank(level: InfoLevel): number` + `highestVisibleTier(levels: readonly InfoLevel[]): InfoLevel` (one shared implementation, deep-frozen rank table) and (ii) `flooredAgeLabel(ageSeconds: number): string` (the shared s/m/h/d floored label — moved from staleness.ts/hover-intel.ts; staleness.ts re-exports it for backward compat OR updates its consumers — pick the cleanest: staleness.ts keeps its public surface by re-exporting from intel-ui.ts); pvp-gate.ts + hover-intel.ts import the shared helpers and DELETE their local copies. Tests: intel-ui.test.ts (~14-18: rank, highest-visible-tier incl. ties/empty, age-label floors at every unit boundary); update the affected pvp-gate/hover-intel/staleness tests if they pinned local behavior (identical outputs — should pass unchanged).

VERIFY: `npx tsc -b` exit 0; run tests/pvp-gate.test.ts tests/staleness.test.ts tests/hover-intel.test.ts tests/sensors.test.ts tests/intel-ui.test.ts with --pool threads — all pass (report per-file counts). DO NOT run the full suite.

REPORT: per-finding changed lines + which test covers which finding.
