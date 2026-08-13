READ-ONLY AUDIT — StarBaron P7-T07 (master roadmap): Planet Capture.

READ LIST:
- src/sim/combat/capture.ts      (NEW — under audit)
- tests/capture.test.ts          (NEW — test suite)
- src/sim/player/transfer.ts     (P2-T07: conquestTransfer — the LOCKED handover)
- src/sim/combat/resolution.ts   (P7-T03: BattleOutcome)
- src/sim/combat/casualties.ts   (P7-T05: CasualtyLedger)
- src/sim/combat/conquest-cost.ts (P7-T06: ConquestCost)
- src/sim/world/api.ts           (queryBody — universe anchoring)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = the CURRENT state of src/sim/combat/capture.ts + tests/capture.test.ts on staging (HEAD; the feat commit cc1e33c68d3a3d104e46b2062eca49e5fd5f6bdf covers exactly these two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p7-t07-brief.md + master roadmap P7-T07):
1. CaptureResult { captureId (fnv1a(attackerId|targetId|capturedAt)), attackerId, defenderId, targetId, capturedAt, outcome captured|repelled, transfer TransferEvent|null, cost ConquestCost|null, casualties CasualtyLedger|null }.
2. capturePlanet: victory → DELEGATES the handover to transfer.conquestTransfer (attacker new owner + survival fraction + universe + capturedAt); result 'captured' with the transfer event; defeat/stalemate → 'repelled', transfer null (cost/casualties still recorded — the price was paid); validation: terminal outcome required, structureSurvival in [0,1], capturedAt positive.
3. captureSummary deterministic; captureInvariants: captured ⇒ transfer non-null + new owner = attacker; repelled ⇒ transfer null; cost/casualties present; structureSurvival respected (turret absent — the locked transfer's contract).
4. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ player/transfer + combat/resolution + combat/casualties + combat/conquest-cost + world/api (type-only where possible) + ui/validate + stdlib; banned comment tokens absent; tables frozen.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Victory → conquestTransfer DELEGATED (the transfer event comes from the locked function; attacker becomes owner; turrets absent; survival fraction applied).
C. Repelled paths (defeat/stalemate → no transfer, cost/casualties recorded); victory onto a protected/home target → refused (the T08 guard's contract).
D. captureId determinism; summary; invariants; validation; immutability; determinism.
E. Tests ~33 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
