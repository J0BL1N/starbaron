export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '∞'
  }

  const abs = Math.abs(value)
  if (abs >= 1e9) {
    return `${trim(value / 1e9)}B`
  }
  if (abs >= 1e6) {
    return `${trim(value / 1e6)}M`
  }
  if (abs >= 1e3) {
    return `${trim(value / 1e3)}K`
  }
  return trim(value)
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
