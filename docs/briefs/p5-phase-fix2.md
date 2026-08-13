TASK (StarBaron PHASE 5 phase audit round 2 — FIX ONLY THESE 2 FINDINGS, no broadening):

ALLOWED FILES: src/sim/fleet/render-state.ts, tests/render-state.test.ts, src/sim/fleet/orders.ts, tests/orders.test.ts. Do NOT touch any other file.

RESTRICTIONS: unchanged — purity, no `any`, strict TS, no banned comment tokens (list: any, Math.random, Date.now, performance.now, localeCompare, locale, wall, clock, scene, Three.js, global state, shared mutable data, random).

CODEX FINDINGS (fix exactly these):

1. [render-state.ts:86-94,228-260] The render-state surface lacks ORIENTATION (the roadmap requires draw data, LOD, orientation, labels). Fix: add `orientation: { headingDegrees: number; headingRadians: number; hasHeading: boolean }` to FleetRenderState (or a documented equivalent shape — pick and document): derived deterministically from the active leg's origin→destination vector (atan2 of the 2D projection — document which plane: use the xz-plane heading like the existing 3D renderer convention? READ how planetgen3d orients things — PREFER yaw around the Y axis: headingDegrees = (atan2(dx, dz) * 180/π + 360) % 360); IDLE/ZERO-VECTOR fallback: when the fleet is not traveling (leg null / at-origin / at-destination) or the vector is zero-length → hasHeading false, headingDegrees 0 (documented fallback). Boundary tests: heading at 0°/90°/180°/270° cardinal vectors (hand-computed atan2 values); negative-vector wrap (> 360 → modulo); zero-vector + idle fallbacks.

2. [orders.ts:287-291,323-327] Unknown order IDs throw generic Error('no such order …') instead of the shared unknown-ID convention (RangeError, one message style). Fix: both paths (completeOrder/cancelOrder unknown id) throw RangeError with the established style: `unknown order id ${JSON.stringify(id)}` (match the other modules' message convention). Update the tests that assert the old message/type to assert RangeError + the new message.

VERIFY: `npx tsc -b` exit 0; run the 2 test files with --pool threads — all pass (report per-file counts). DO NOT run the full suite.

REPORT: per-finding changed lines + which test covers which finding.
