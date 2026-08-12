/**
 * Player id generation — the single nondeterministic utility in the game
 * stack, and the BOUNDARY marker for this codebase.
 *
 * A fresh player needs a collision-resistant id that the deterministic
 * models cannot derive, so this module reads the platform RNG BY DESIGN: it
 * is a boundary utility, NOT part of the pure simulation layer. The sim
 * layer never calls it (no module under src/sim/** may import this module —
 * pinned by tests/sim-purity.test.ts), and the RNG tokens (randomUUID,
 * Date.now, Math.random) appear in no src/sim/** file. The UI boundary (the
 * wall clock) consumes it when a new game is created.
 * @boundary
 */
export function generatePlayerId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj != null && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
