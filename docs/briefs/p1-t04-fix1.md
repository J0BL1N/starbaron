TASK (StarBaron P1-T04, Codex FAIL round 1 — FIX ONLY THESE 3 FINDINGS, no broadening):

ALLOWED FILES: src/sim/world/body.ts, tests/body-model.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity (no banned tokens even in comments), no `any`, strict TS, no signature/format changes, deterministic.

CODEX FINDINGS (fix exactly these):

1. [src/sim/world/body.ts:231] Orbit overrides can violate canonical invariants — e.g. `{ semiMajorAxis: -1 }`, `{ eccentricity: 1 }`, or `{ period: NaN }` merge into the record producing non-finite fields, negative `a`, or `e` outside [0,1). Fix: validate the MERGED orbit and throw a descriptive Error on invalid values (semiMajorAxis finite >= 0; eccentricity finite in [0,1); inclination/LAN/argPeriapsis/meanAnomaly finite; period finite > 0). Add negative-path tests for each invalid override.

2. [src/sim/world/body.ts:116] The Roman-numeral `while` loop is input-dependent — a huge moon ordinal can hang. Fix: bound it — validate ordinal is a finite non-negative integer <= 3999 before conversion (throw descriptive Error otherwise), and make the conversion bounded (standard Roman algorithm with fixed tables, no input-dependent loop).

3. [tests/body-model.test.ts:117, :185] Add negative-path tests matching the new validation: orbit overrides with negative a, e>=1, NaN period, non-finite angle, period<=0 all throw; moon ordinal 4000 throws; valid overrides still pass.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/body-model.test.ts` all pass (report counts, now ~36+). Report changed lines + results + which test covers which finding.
