TASK (StarBaron P4-T07, master roadmap): NOTIFICATIONS FRAMEWORK — notification types, creation, deduplication, ordering, expiry, unread count, read/reaction state. (Pure state model — the P10 channel wiring is out of scope.)

CONTEXT — existing code you may READ but NOT modify:
- src/sim/ui/hud.ts (P4-T01): HudAlert pattern (id via fnv1a, severity, sort by at then id).
- src/sim/planets/hash.ts: fnv1a (canonical hash).
- src/sim/core/offline-model.ts (P3-T08): anti-duplication contract pattern (delta semantics, caller advances).

ALLOWED FILES (create ONLY):
- src/sim/ui/notifications.ts
- tests/notifications.test.ts

RESTRICTIONS: pure module — no nondeterministic APIs, no module-level mutable state, no wall-clock (timestamps INPUTS); no `any`; strict TS; NO modification of existing files; no React wiring.

DESIGN SPEC:
1. `NotificationType = 'info' | 'warning' | 'danger' | 'success'`.
2. `Notification = { id: string; type: NotificationType; title: string; message: string; at: number; read: boolean; reactions: readonly string[] }` — id deterministic: fnv1a(`${title}|${message}|${at}`) — same content at the same time = same id (dedup key).
3. `NotificationsState = { items: Notification[]; unreadCount: number }`.
4. Pure functions:
   - `addNotification(state: NotificationsState, input: { type; title; message; at }): NotificationsState` — immutable; DEDUPLICATION: an existing item with the SAME id (same title|message|at) is NOT added twice; new items appended; unreadCount recomputed; at validated finite > 0.
   - `markRead(state: NotificationsState, id: string): NotificationsState` — immutable; unknown id throws; read flag set; unreadCount recomputed (idempotent: already-read markRead → same state).
   - `markAllRead(state: NotificationsState): NotificationsState` — immutable; all read; unreadCount 0.
   - `react(state: NotificationsState, id: string, emoji: string): NotificationsState` — immutable; adds a reaction to the reactions list (no duplicates of the same emoji; empty emoji throws); unknown id throws.
   - `sortedNotifications(state: NotificationsState): Notification[]` — newest first (at desc, id tie-break); does not mutate.
   - `expired(state: NotificationsState, at: number, maxAgeSeconds: number): NotificationsState` — removes items with at < at - maxAgeSeconds*1000 (older than maxAge); unreadCount recomputed; maxAge validated > 0.
   - `validateNotifications(state: NotificationsState): { ok: boolean; problems: string[] }` — unique ids; at finite > 0; read boolean; unreadCount === items.filter(!read).length; reactions unique per item.
5. Invariants (test): dedup (same input twice → one item); id determinism; markRead/markAllRead + unreadCount; react (add, dedup same emoji, empty throws); sorted order; expiry semantics (boundary: exactly maxAge old → kept or removed? — document + test the boundary); validate catches tamper classes; immutability everywhere; determinism.

TESTS (vitest, tests/notifications.test.ts, ~28-34): all invariants + edges.

VERIFY: `npx tsc -b` exit 0; `npx vitest run tests/notifications.test.ts --pool threads` all pass (counts) — DO NOT run the full suite. Report changed files, commands + results, limitations (P10 delivery channel out of scope).
