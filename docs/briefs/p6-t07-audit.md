READ-ONLY AUDIT — StarBaron P6-T07 (master roadmap): PvP Information Gating.

READ LIST:
- src/sim/intel/pvp-gate.ts     (NEW — under audit)
- tests/pvp-gate.test.ts        (NEW — test suite)
- src/sim/intel/permissions.ts  (P6-T01: permissionFor/effectiveLevelFor)
- src/sim/intel/levels.ts       (P6-T02: TargetIntel, IntelLevel)
- src/sim/intel/staleness.ts    (P6-T06: freshnessFor, decayedLevel)
- src/sim/intel/reports.ts      (P6-T05: REVEAL_MATRIX, buildIntelReport pipeline)
- src/sim/ui/info.ts            (projectInfo, InfoField)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 1a60c1229928e10e14f8e22987bcf532653a2251 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p6-t07-brief.md + master roadmap P6-T07):
1. GatedView { targetId, viewerId, visible InfoField[], intelLevel, freshness, shownFromIntel, blocked|null }.
2. Gate order: owner (all fields, never intel-blocked, intelLevel echoes store or 'full intelligence'); alliance tier; STRANGER = intel-store-only (delegates reveal via REVEAL_MATRIX + projectInfo; expired intel → blocked 'expired-intel' + visible []; NO intel → blocked 'no-intel' + visible [] — NOT even public fields on an OWNED target; decayed-to-none → shown-but-empty (not blocked)); unowned → public tier (never blocked — 'unowned-public-only' reason never occurs, documented); admin → owner tier.
3. pvpSummary deterministic; validation up front on every path.
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ intel/* + ui/info + ui/validate + stdlib; banned comment tokens absent.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Owner path (never blocked, all fields, store-echo); alliance path.
C. STRANGER strict no-leak: owned target + no intel → [] (no public leak); expired → blocked + []; decayed-to-none → empty shown (not blocked); intel reveal at decayedLevel via the report machinery.
D. Unowned → public (not blocked); admin → owner; blocked views' fields (visible [], level none, freshness expired).
E. pvpSummary; validation; determinism; tests ~33 covering; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
