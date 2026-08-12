TASK (StarBaron P3-T10, Codex FAIL round 2 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/balance/harness.ts, tests/harness.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDINGS (fix exactly these):

1. [src/sim/balance/harness.ts:8] A comment contains the banned token `any`. Rephrase without the literal token (e.g. "strict typing throughout").

2. [src/sim/balance/harness.ts:481] `timeToFirstUpgradeSeconds` is validated only for finiteness/range + the zero-upgrade sentinel — a run WITH upgrades can have the field tampered to an arbitrary positive value and still pass invariants. Fix: derive the EXPECTED first completion from the run's points (the first point whose cumulative upgrades exceed 0 → that point's atSeconds; the exact first-completion semantics: use the point where totalUpgrades first increments — document which field the derivation uses), and validate summary.timeToFirstUpgradeSeconds === derived value (add a problem entry on mismatch). Add a negative test: tamper timeToFirstUpgradeSeconds to a different positive value → invariants report the problem.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/harness.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which finding.
