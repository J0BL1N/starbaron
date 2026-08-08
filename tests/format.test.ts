import { describe, expect, it } from 'vitest'
import { formatNumber } from '../src/sim/core/format'

describe('formatNumber', () => {
  it('formats numbers under 1000 without a suffix', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(42)).toBe('42')
    expect(formatNumber(999)).toBe('999')
  })

  it('formats thousands as K', () => {
    expect(formatNumber(1_000)).toBe('1K')
    expect(formatNumber(12_500)).toBe('12.5K')
  })

  it('formats millions as M', () => {
    expect(formatNumber(2_000_000)).toBe('2M')
    expect(formatNumber(3_500_000)).toBe('3.5M')
  })

  it('formats billions as B', () => {
    expect(formatNumber(1_000_000_000)).toBe('1B')
    expect(formatNumber(2_700_000_000)).toBe('2.7B')
  })

  it('handles non-finite values', () => {
    expect(formatNumber(Infinity)).toBe('∞')
    expect(formatNumber(NaN)).toBe('∞')
  })
})
