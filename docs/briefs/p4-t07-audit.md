READ-ONLY AUDIT — StarBaron P4-T07 (master roadmap): Notifications Framework.

READ LIST:
- src/sim/ui/notifications.ts   (NEW — under audit)
- tests/notifications.test.ts   (NEW — test suite)
- src/sim/planets/hash.ts       (fnv1a — canonical hash)

AUTHORISED SCOPE: ONLY the two new files. AUDIT TARGET = COMMIT ad39698d77c0d392d78d24f135b2e9a0ae161643 (`git show --stat` adds exactly those two). Docs commits OUT OF SCOPE. No existing file modified.

TASK SPEC (docs/briefs/p4-t07-brief.md + master roadmap P4-T07):
1. Notification { id = fnv1a(title|message|at) — the DEDUP key, type (info|warning|danger|success), title, message, at, read, reactions }; NotificationsState { items, unreadCount }.
2. addNotification (dedup by id — same content+time never added twice; at validated); markRead (unknown throws; idempotent); markAllRead; react (no dup emoji; empty throws); sortedNotifications (at desc, id tie-break, no mutation); expired (older than maxAge removed; EXACTLY-maxAge kept — documented boundary); validateNotifications (collects ALL tamper classes incl. unreadCount mismatch).
3. Purity: no nondeterministic APIs/module mutable state/wall-clock; no `any`; imports ⊆ planets/hash + stdlib.

CHECK:
A. Purity + imports; no banned tokens in comments.
B. Dedup semantics (same input twice → one item; first wins); id determinism.
C. unreadCount recompute everywhere (incl. expired/react); markRead idempotence (reference-identical no-op); unknown id throws.
D. react dedup + empty emoji; sorted order; expiry boundary; validate tamper classes.
E. Tests ~34 covering; vitest conventions; imports resolve.

DO NOT: modify anything; run suites; invent capabilities.

REPLY FORMAT: PASS or FAIL. FAIL → numbered findings (file:line, deterministic fix). PASS → key invariants verified.
