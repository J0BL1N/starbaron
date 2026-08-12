/**
 * Player id generation — the single nondeterministic utility in the player
 * stack, and the BOUNDARY marker for this codebase.
 *
 * A fresh player needs a collision-resistant id that the deterministic
 * models cannot derive, so this module reads the platform RNG BY DESIGN: it
 * is a boundary utility, NOT part of the pure sim layer. The sim layer never
 * calls it — the UI boundary (the wall clock) consumes it when a new game is
 * created — and player.ts re-exports it unchanged to keep the public API (the
 * boundary marker is the contract). The phase-2 audit pins this in tests: no
 * sim module other than player.ts may import this module, and the RNG tokens
 * appear in no other sim file.
 * @boundary
 */
export function generatePlayerId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj != null && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
