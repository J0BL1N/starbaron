const SUFFIX_THRESHOLDS: ReadonlyArray<{ threshold: number; suffix: string }> = [
  { threshold: 1e21, suffix: 'Sx' },
  { threshold: 1e18, suffix: 'Qi' },
  { threshold: 1e15, suffix: 'Qa' },
  { threshold: 1e12, suffix: 'T' },
  { threshold: 1e9, suffix: 'B' },
  { threshold: 1e6, suffix: 'M' },
  { threshold: 1e3, suffix: 'K' },
]

const SCIENTIFIC_THRESHOLD = 1e22

export function formatNumber(value: number | null | undefined): string {
  if (value == null) {
    return '0'
  }
  if (!Number.isFinite(value)) {
    return '∞'
  }

  const abs = Math.abs(value)
  if (abs >= SCIENTIFIC_THRESHOLD) {
    return scientific(value)
  }

  for (const { threshold, suffix } of SUFFIX_THRESHOLDS) {
    if (abs >= threshold) {
      return `${trim(value / threshold)}${suffix}`
    }
  }
  return trim(value)
}

function scientific(value: number): string {
  const [mantissa, exponent] = value.toExponential(2).split('e')
  const trimmedMantissa = mantissa.replace(/\.?0+$/, '')
  return `${trimmedMantissa}e${exponent}`
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
