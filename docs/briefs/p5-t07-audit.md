READ-ONLY AUDIT — StarBaron P5-T07 (master roadmap): Fleet Orders.

READ LIST:
- src/sim/fleet/orders.ts     (NEW — under audit)
- tests/orders.test.ts        (NEW — test suite)
- src/sim/fleet/fleet.ts      (P5-T03: Fleet status union)
- src/sim/planets/hash.ts     (fnv1a)
- src/sim/ui/validate.ts      (assertPositiveAt)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT 9654db3c45df3ca01bb55a1316105a59abac0c5e (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p5-t07-brief.md + master roadmap P5-T07):
1. FleetOrderType move|attack|defend|return; FleetOrder { id (fnv1a(fleetId|type|issuedAt|index)), fleetId, type, target|null (null ONLY for return), issuedAt, status issued|active|done|cancelled, expiresAt|null (null allowed for return; > issuedAt when present) }.
2. FleetOrders { fleetId, orders, activeOrderId|null }; ONE-ACTIVE semantics (issueOrder throws while active; multiple issued may queue).
3. Lifecycle: issueOrder (enqueue 'issued'; pairing validation: move/attack/defend require target, return requires null; index default orders.length) → activateNext (FIFO; NO-OP immutable when active exists or queue empty) → completeOrder (active→done only) / cancelOrder (issued|active→cancelled; done throws).
4. ordersInvariants: activeOrderId matches exactly one active; unique ids; valid statuses; pairing; expiresAt > issuedAt.
5. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ fleet/* + planets/hash + ui/validate + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Pairing per type; one-active enforcement; FIFO activation; NO-OP reference semantics.
C. Lifecycle transitions (valid/invalid each); expiresAt validation; id determinism + index handling.
D. ordersInvariants tamper classes; immutability; determinism.
E. Tests ~34 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
