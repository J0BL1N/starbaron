import { describe, expect, it } from 'vitest'
import { starSummaryFor } from '../src/sim/ui/display'

describe('P4 shared display — starSummaryFor', () => {
  it('maps a full spectral type to its leading-letter class label', () => {
    expect(starSummaryFor('G2 V')).toBe('G-class star')
    expect(starSummaryFor('K1 V')).toBe('K-class star')
    expect(starSummaryFor('M5 III')).toBe('M-class star')
    expect(starSummaryFor('O8.5 Iab')).toBe('O-class star')
  })

  it('uppercases a lower-case leading letter', () => {
    expect(starSummaryFor('g2 v')).toBe('G-class star')
    expect(starSummaryFor('k1 v')).toBe('K-class star')
  })

  it('trims surrounding whitespace before picking the class letter', () => {
    expect(starSummaryFor('  G2 V  ')).toBe('G-class star')
    expect(starSummaryFor('\tM3\t')).toBe('M-class star')
  })

  it('uses the first non-whitespace character when the type has leading blanks', () => {
    expect(starSummaryFor('   A1 V')).toBe('A-class star')
  })

  it('falls back to Unknown star for undefined', () => {
    expect(starSummaryFor(undefined)).toBe('Unknown star')
  })

  it('falls back to Unknown star for null', () => {
    expect(starSummaryFor(null)).toBe('Unknown star')
  })

  it('falls back to Unknown star for an empty string', () => {
    expect(starSummaryFor('')).toBe('Unknown star')
  })

  it('falls back to Unknown star for whitespace-only input', () => {
    expect(starSummaryFor('   ')).toBe('Unknown star')
    expect(starSummaryFor('\t\n')).toBe('Unknown star')
  })

  it('preserves the exact fallback string across every blank variant', () => {
    const variants: Array<string | null | undefined> = [
      '',
      '   ',
      '\t',
      '\n',
      null,
      undefined,
    ]
    for (const variant of variants) {
      expect(starSummaryFor(variant)).toBe('Unknown star')
    }
  })

  it('treats an unrecognised leading character like any other letter (no whitelist)', () => {
    expect(starSummaryFor('X3 V')).toBe('X-class star')
    expect(starSummaryFor('?foo')).toBe('?-class star')
  })

  it('never mutates its input', () => {
    const input = '  g2 v  '
    starSummaryFor(input)
    expect(input).toBe('  g2 v  ')
  })

  it('is deterministic — the same input always yields the same label', () => {
    expect(starSummaryFor('G2 V')).toBe(starSummaryFor('G2 V'))
    expect(starSummaryFor('  M3  ')).toBe(starSummaryFor('  M3  '))
    expect(starSummaryFor(null)).toBe(starSummaryFor(null))
    expect(starSummaryFor(undefined)).toBe(starSummaryFor(undefined))
  })
})
