/**
 * Shared UI display projections (P4 phase-fix 4).
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock.
 *
 * STAR SUMMARY (single source of truth): the `starType → '<letter>-class
 * star'` mapping with the unknown/blank fallback 'Unknown star', deduplicating
 * the identical helpers the hover and system-overview contracts each defined
 * independently. The first non-whitespace character is upper-cased and
 * surrounding whitespace is trimmed, so 'g2 v' and ' G2 V ' both project to
 * 'G-class star' — trimming and capitalisation preserved byte-for-byte.
 */

const UNKNOWN_STAR_LABEL = 'Unknown star'

/** 'G2 V' → 'G-class star'; missing or blank types fall back to 'Unknown star'. */
export function starSummaryFor(starType: string | null | undefined): string {
  if (starType === null || starType === undefined || starType.trim() === '') {
    return UNKNOWN_STAR_LABEL
  }
  return `${starType.trim().charAt(0).toUpperCase()}-class star`
}
