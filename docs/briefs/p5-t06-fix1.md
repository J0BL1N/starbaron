TASK (StarBaron P5-T06, Codex FAIL round 1 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/fleet/render-state.ts, tests/render-state.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, deterministic.

CODEX FINDINGS (fix exactly these):

1. [render-state.ts:196] Independent Math.round(count × ratio) can exceed the 60 cap (counterexample: {scout:1, corvette:1, frigate:1, cruiser:28, battleship:30} = 61 ships → 61 drawn). Fix: DETERMINISTIC CAPPED APPORTIONMENT after the proportional calculation — the largest-remainder method: (a) floor each class's share = floor(count × ratio); (b) distribute the remaining slots (cap − sum of floors) to classes in DESCENDING fractional remainder order, ties broken by class id ascending (documented fixed tie-breaker); (c) final sum of drawCounts === min(cap, totalShips) exactly. Add the counterexample to the tests.

2. [render-state.test.ts:169] The never-exceeds-cap test covers only a two-class exact-ratio case. Add the five-class rounding-overflow regression (the exact composition from finding 1) asserting summed drawCount <= MAX_RENDERED_SHIPS AND === min(cap, total).

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/render-state.test.ts --pool threads` all pass (report counts). Report changed lines + results + which test covers which finding.
