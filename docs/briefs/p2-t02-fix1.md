TASK (StarBaron P2-T02, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/player/assignment.ts, tests/assignment.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDINGS (fix exactly these):

1. [src/sim/player/assignment.ts:113-122] The hash-probing offsets do not guarantee coverage within 3 × eligible.length — a free body can be missed and the result falsely reports 'exhausted' (e.g. 19 eligible entries, player 'coverage-probe', default salt: the 57 candidates omit index 12; with every other ID taken it returns exhausted despite a free ID). Fix: within the 3×n attempt budget, add a bounded complete-coverage fallback — after the hash probes are exhausted, do a deterministic LINEAR scan of the eligible set (starting at a deterministic offset derived from the player hash) returning the first non-taken id; the total work stays within the documented budget (linear scan bounded by eligible.length, and only runs when hash probes failed). Add the regression test from the finding ('coverage-probe' with 19 eligible entries, all-but-12 taken → must return ok with id 12).

2. [src/sim/player/assignment.ts:43-46, 152-153] The spec'd repeat-login state label is 'home-not-in-taken' but the implementation returns reason: 'taken'. Fix: change the result union member and the return value to 'home-not-in-taken' (and the inverse states as already documented), and update tests/assignment.test.ts:321-326 accordingly.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/assignment.test.ts` all pass (report counts). Report changed lines + results + which test covers which finding.
