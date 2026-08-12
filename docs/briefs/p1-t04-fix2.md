TASK (StarBaron P1-T04, Codex FAIL round 2 — FIX ONLY THESE FINDINGS, no broadening):

ALLOWED FILES: src/sim/world/body.ts, tests/body-model.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic, no signature/format changes.

CODEX FINDINGS (fix exactly these):

1. [src/sim/world/body.ts:266-267] A star's supplied partial `orbit` merges over ZERO_ORBIT and validateOrbit imposes no zero-orbit rule for stars — `buildBodyRecord({ type: 'star', orbit: { semiMajorAxis: 1 } })` returns a nonzero star orbit, violating the required "star body → zero orbit" invariant. Fix: for type === 'star', REJECT any nonzero orbit override (throw descriptive Error — consistent with the other validation), and always return ZERO_ORBIT for stars. Apply the zero check in validateOrbit (star + any nonzero field → throw).

2. [tests/body-model.test.ts:178-183, 208-252] Add a negative-path test: a star orbit override with a nonzero field throws; a star override that is exactly all-zeros is accepted (or ignored) — match your chosen fix.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/body-model.test.ts` all pass (report counts). Report changed lines + results + which test covers which finding.
