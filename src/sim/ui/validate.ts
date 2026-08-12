/**
 * Shared validation helpers for the UI-state modules (P4 whole-phase fix).
 *
 * PURE module: pure functions only — no nondeterministic APIs, no
 * module-level mutable state, no wall-clock. The exact RangeError messages
 * are the ESTABLISHED ones from the modules this centralises (hud, hover,
 * planet-panel, system-overview, empire-overview, notifications,
 * data-sources), so behaviour is byte-identical after deduplication.
 */

export function assertPositiveAt(at: number): void {
  if (!Number.isFinite(at) || at <= 0) {
    throw new RangeError(
      `at must be a positive finite number (milliseconds), got ${at}`,
    )
  }
}

export function assertNonEmptyString(value: string, name: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new RangeError(
      `${name} must be a non-empty string, got ${JSON.stringify(value)}`,
    )
  }
  return trimmed
}
