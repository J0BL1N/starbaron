READ-ONLY AUDIT — StarBaron P4-T02 (master roadmap): Contextual Hover Intelligence HUD.

READ LIST:
- src/sim/ui/hover.ts          (NEW — under audit)
- tests/hover.test.ts          (NEW — test suite)
- src/sim/world/api.ts         (queryGalaxy/querySystem/queryBody)
- src/sim/world/identity.ts    (parseCanonicalId, parentOf)
- src/sim/world/body.ts        (BodyRecord)
- src/sim/core/format.ts       (formatNumber — locked)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 851cdb10d9294c7c7aadf2c89f58cf137e7a223d (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p4-t02-brief.md + master roadmap P4-T02):
1. HoverTarget { kind galaxy|system|body, id }; HoverInfo | null (null on query miss/unparseable); resolveHoverTarget round-trip; smoothSwitch { from, to, at, immediate } (immediate = from null or cross-kind).
2. hoverInfoFor per kind: galaxy (class subtitle, systems count, real-data, ownedBy null); system (star subtitle, body count, position magnitude, ownedBy null); body (type, radius via formatNumber, period, ownedBy from overlay map).
3. Purity: no nondeterministic APIs/module mutable state/wall-clock/locale; no `any`; imports ⊆ world/api + world/identity + world/body (types) + core/format + stdlib, PLUS (CONTRACT CORRECTION — pure type imports): ../world/galaxy + ../world/reconstruct (type-only).

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Null on miss/unparseable; kind-specific fields correct; ownedBy resolution (owned/unowned/absent).
C. smoothSwitch immediate/smooth classification + determinism.
D. Stats formatting via locked formatNumber (no locale); validation (bad at).
E. Tests ~31 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
