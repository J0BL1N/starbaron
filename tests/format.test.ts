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

  it('formats trillions as T', () => {
    expect(formatNumber(1_000_000_000_000)).toBe('1T')
    expect(formatNumber(1_500_000_000_000)).toBe('1.5T')
  })

  it('formats very large numbers in scientific notation', () => {
    expect(formatNumber(1e30)).toBe('1e+30')
    expect(formatNumber(3.456e32)).toBe('3.46e+32')
    expect(formatNumber(1e15)).toBe('1e+15')
    expect(formatNumber(-1e30)).toBe('-1e+30')
  })

  it('formats decimals with one decimal place', () => {
    expect(formatNumber(0.5)).toBe('0.5')
    expect(formatNumber(12.34)).toBe('12.3')
    expect(formatNumber(1234.5)).toBe('1.2K')
  })

  it('formats negative values', () => {
    expect(formatNumber(-42)).toBe('-42')
    expect(formatNumber(-0.5)).toBe('-0.5')
    expect(formatNumber(-1_000)).toBe('-1K')
  })

  it('handles non-finite values', () => {
    expect(formatNumber(Infinity)).toBe('∞')
    expect(formatNumber(NaN)).toBe('∞')
  })

  it('safely defaults null and undefined to 0', () => {
    expect(formatNumber(null)).toBe('0')
    expect(formatNumber(undefined)).toBe('0')
  })
})
