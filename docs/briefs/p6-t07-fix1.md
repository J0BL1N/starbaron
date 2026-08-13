TASK (StarBaron P6-T07, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/intel/pvp-gate.ts, tests/pvp-gate.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens.

CODEX FINDINGS (fix exactly these):

1. [pvp-gate.ts:211-249] The gate never validates that a supplied intel.targetId matches target.targetId — a stranger can supply a valid fresh record for a DIFFERENT target and receive THIS target's fields. Fix: before the tier branching, when intel !== null, require its non-empty targetId to EQUAL target.targetId (throw RangeError on mismatch); add mismatch coverage tests (stranger + owner paths).

2. [pvp-gate.ts:218-247] Intel records are validated only in the stranger branch — owner/alliance/unowned paths return successfully with an invalid stored intel.level, and the owner echoes it. Fix: validate a non-null record UP FRONT before the tier switch (level is a valid IntelLevel; targetId non-empty + matches target.targetId; lastUpdatedAt null-or-positive-finite) irrespective of viewer tier; add invalid-record tests for owner/admin/alliance/unowned paths (each throws RangeError).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/pvp-gate.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which finding.
