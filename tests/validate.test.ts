import { describe, expect, it } from 'vitest'
import { assertNonEmptyString, assertPositiveAt } from '../src/sim/ui/validate'

describe('P4 shared validator — assertPositiveAt', () => {
  it('accepts a positive finite timestamp', () => {
    expect(() => assertPositiveAt(1)).not.toThrow()
    expect(() => assertPositiveAt(1_700_000_000_000)).not.toThrow()
    expect(() => assertPositiveAt(0.5)).not.toThrow()
  })

  it('throws RangeError for zero and negative timestamps', () => {
    for (const bad of [0, -1, -1_700_000_000_000]) {
      expect(() => assertPositiveAt(bad)).toThrow(RangeError)
    }
  })

  it('throws RangeError for non-finite timestamps', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => assertPositiveAt(bad)).toThrow(RangeError)
    }
  })

  it('uses the established byte-identical message', () => {
    expect(() => assertPositiveAt(0)).toThrow(
      'at must be a positive finite number (milliseconds), got 0',
    )
    expect(() => assertPositiveAt(Number.NaN)).toThrow(
      /at must be a positive finite number \(milliseconds\)/,
    )
  })

  it('is deterministic — the same input always throws or returns', () => {
    expect(() => assertPositiveAt(0)).toThrow(RangeError)
    expect(() => assertPositiveAt(0)).toThrow(RangeError)
    expect(() => assertPositiveAt(42)).not.toThrow()
  })
})

describe('P4 shared validator — assertNonEmptyString', () => {
  it('returns the trimmed value for a non-empty string', () => {
    expect(assertNonEmptyString('  demo  ', 'label')).toBe('demo')
    expect(assertNonEmptyString('seed-a', 'seed')).toBe('seed-a')
  })

  it('throws RangeError for an empty or blank string', () => {
    for (const bad of ['', '   ', '\t', '\n']) {
      expect(() => assertNonEmptyString(bad, 'label')).toThrow(RangeError)
    }
  })

  it('names the offending argument in the message', () => {
    expect(() => assertNonEmptyString('', 'seed')).toThrow(
      'seed must be a non-empty string, got ""',
    )
    expect(() => assertNonEmptyString('   ', 'label')).toThrow(/label must be a non-empty string/)
  })

  it('echoes the raw (untrimmed) value via JSON.stringify', () => {
    expect(() => assertNonEmptyString('  ', 'name')).toThrow(
      'name must be a non-empty string, got "  "',
    )
  })
})
