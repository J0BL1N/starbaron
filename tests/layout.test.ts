/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  classifyViewport,
  layoutRulesFor,
  panelLayout,
  touchTargetOk,
  validateLayout,
  DESKTOP_MIN_WIDTH_PX,
  MIN_TOUCH_TARGET_POINTER_PX,
  MIN_TOUCH_TARGET_TOUCH_PX,
  PHONE_MAX_WIDTH_PX,
} from '../src/sim/ui/layout'
import type { LayoutRules, PanelMode } from '../src/sim/ui/layout'

const PHONE = { width: 599, height: 800, isTouch: true }
const TABLET = { width: 900, height: 1200, isTouch: true }
const DESKTOP = { width: 1280, height: 720, isTouch: false }

function baseRules(overrides: Partial<LayoutRules> = {}): LayoutRules {
  return { ...layoutRulesFor(PHONE), ...overrides }
}

describe('P4-T08 classifyViewport — locked breakpoints', () => {
  it('classifies width below 600 as phone', () => {
    expect(classifyViewport(599, 800)).toBe('phone')
  })

  it('classifies width 600 through 1023 as tablet', () => {
    expect(classifyViewport(600, 800)).toBe('tablet')
    expect(classifyViewport(1023, 800)).toBe('tablet')
  })

  it('classifies width 1024 and above as desktop', () => {
    expect(classifyViewport(1024, 800)).toBe('desktop')
    expect(classifyViewport(2000, 800)).toBe('desktop')
  })

  it('is width-only and covers the real line without gaps or overlap', () => {
    for (const width of [0, 1, 599]) {
      expect(classifyViewport(width, 800)).toBe('phone')
    }
    for (const width of [600, 700, 1023]) {
      expect(classifyViewport(width, 800)).toBe('tablet')
    }
    for (const width of [1024, 5000, 100_000]) {
      expect(classifyViewport(width, 800)).toBe('desktop')
    }
    expect(classifyViewport(599, 1)).toBe('phone')
    expect(classifyViewport(599, 5000)).toBe('phone')
    expect(classifyViewport(1024, 1)).toBe('desktop')
  })
})

describe('P4-T08 layoutRulesFor — per-viewport mapping', () => {
  it('phone: bottom-sheet, 1 column, 44px touch target, echoes width/height', () => {
    const rules = layoutRulesFor(PHONE)
    expect(rules.viewport).toBe('phone')
    expect(rules.panelMode).toBe('bottom-sheet')
    expect(rules.gridColumns).toBe(1)
    expect(rules.minTouchTargetPx).toBe(MIN_TOUCH_TARGET_TOUCH_PX)
    expect(rules.isTouch).toBe(true)
    expect(rules.width).toBe(599)
    expect(rules.height).toBe(800)
  })

  it('tablet: side-panel, 2 columns', () => {
    const rules = layoutRulesFor(TABLET)
    expect(rules.viewport).toBe('tablet')
    expect(rules.panelMode).toBe('side-panel')
    expect(rules.gridColumns).toBe(2)
    expect(rules.minTouchTargetPx).toBe(MIN_TOUCH_TARGET_TOUCH_PX)
  })

  it('desktop: floating, 3 columns', () => {
    const rules = layoutRulesFor(DESKTOP)
    expect(rules.viewport).toBe('desktop')
    expect(rules.panelMode).toBe('floating')
    expect(rules.gridColumns).toBe(3)
  })

  it('non-touch viewports get a 32px pointer target instead of 44px', () => {
    const phone = layoutRulesFor({ ...PHONE, isTouch: false })
    const tablet = layoutRulesFor({ ...TABLET, isTouch: false })
    const desktop = layoutRulesFor({ ...DESKTOP, isTouch: true })
    expect(phone.minTouchTargetPx).toBe(MIN_TOUCH_TARGET_POINTER_PX)
    expect(tablet.minTouchTargetPx).toBe(MIN_TOUCH_TARGET_POINTER_PX)
    expect(desktop.minTouchTargetPx).toBe(MIN_TOUCH_TARGET_TOUCH_PX)
  })

  it('safeInsets default to 0 on every edge when omitted', () => {
    const rules = layoutRulesFor(PHONE)
    expect(rules.safeInsetsPx).toEqual({ top: 0, bottom: 0, left: 0, right: 0 })
  })

  it('partial safeInsets fill the missing edges with 0', () => {
    const rules = layoutRulesFor({ ...PHONE, safeInsetsPx: { top: 24, left: 16 } })
    expect(rules.safeInsetsPx).toEqual({ top: 24, bottom: 0, left: 16, right: 0 })
  })

  it('full safeInsets override every edge', () => {
    const rules = layoutRulesFor({
      ...DESKTOP,
      safeInsetsPx: { top: 10, bottom: 20, left: 30, right: 40 },
    })
    expect(rules.safeInsetsPx).toEqual({ top: 10, bottom: 20, left: 30, right: 40 })
  })

  it('is deterministic: identical inputs yield deep-equal rules', () => {
    const input = {
      width: 900,
      height: 1200,
      isTouch: false,
      safeInsetsPx: { top: 24, left: 16 },
    }
    expect(layoutRulesFor(input)).toEqual(layoutRulesFor(input))
  })

  it('throws RangeError on a non-positive or non-finite width/height', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => layoutRulesFor({ ...PHONE, width: bad })).toThrow(RangeError)
      expect(() => layoutRulesFor({ ...PHONE, height: bad })).toThrow(RangeError)
    }
  })

  it('throws RangeError on a negative or non-finite safe inset', () => {
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          layoutRulesFor({ ...PHONE, safeInsetsPx: { [edge]: bad } }),
        ).toThrow(RangeError)
      }
    }
  })
})

describe('P4-T08 panelLayout — stacking per viewport class', () => {
  it('phone: stacks every panel in input order with overlay true', () => {
    const rules = layoutRulesFor(PHONE)
    const result = panelLayout({
      rules,
      panels: ['build', 'empire', 'notifications'],
      activePanel: 'empire',
    })
    expect(result.stacked).toEqual(['build', 'empire', 'notifications'])
    expect(result.visible).toBe('empire')
    expect(result.overlay).toBe(true)
  })

  it('phone: visible is the active panel only when it is a stacked member', () => {
    const rules = layoutRulesFor(PHONE)
    const panels = ['build', 'empire']
    expect(panelLayout({ rules, panels, activePanel: 'build' }).visible).toBe(
      'build',
    )
    expect(
      panelLayout({ rules, panels, activePanel: 'not-present' }).visible,
    ).toBeNull()
  })

  it('phone: visible is null when activePanel is null', () => {
    const rules = layoutRulesFor(PHONE)
    const result = panelLayout({
      rules,
      panels: ['build', 'empire'],
      activePanel: null,
    })
    expect(result.visible).toBeNull()
    expect(result.stacked).toHaveLength(2)
    expect(result.overlay).toBe(true)
  })

  it('phone: an empty panel set yields an empty stack, visible null, overlay true', () => {
    const rules = layoutRulesFor(PHONE)
    const result = panelLayout({ rules, panels: [], activePanel: null })
    expect(result.stacked).toEqual([])
    expect(result.visible).toBeNull()
    expect(result.overlay).toBe(true)
  })

  it('tablet/desktop: first panel stays side/floating, the rest stack, overlay false', () => {
    for (const input of [TABLET, DESKTOP]) {
      const rules = layoutRulesFor(input)
      const result = panelLayout({
        rules,
        panels: ['build', 'empire', 'notifications'],
        activePanel: 'empire',
      })
      expect(result.stacked).toEqual(['empire', 'notifications'])
      expect(result.visible).toBe('empire')
      expect(result.overlay).toBe(false)
    }
  })

  it('tablet/desktop: visible is null when the active panel is the side panel or absent', () => {
    const rules = layoutRulesFor(TABLET)
    const panels = ['build', 'empire']
    expect(
      panelLayout({ rules, panels, activePanel: 'build' }).visible,
    ).toBeNull()
    expect(
      panelLayout({ rules, panels, activePanel: 'not-present' }).visible,
    ).toBeNull()
    expect(panelLayout({ rules, panels, activePanel: null }).visible).toBeNull()
    expect(panelLayout({ rules, panels, activePanel: 'build' }).stacked).toEqual([
      'empire',
    ])
  })

  it('is deterministic and never mutates the input panels or rules', () => {
    const rules = layoutRulesFor(PHONE)
    const panels = ['build', 'empire', 'notifications']
    Object.freeze(rules)
    Object.freeze(panels)
    const snapshot = JSON.stringify(panels)
    const first = panelLayout({ rules, panels, activePanel: 'empire' })
    const second = panelLayout({ rules, panels, activePanel: 'empire' })
    expect(second).toEqual(first)
    expect(JSON.stringify(panels)).toBe(snapshot)
  })
})

describe('P4-T08 touchTargetOk — target-size math', () => {
  it('passes at exactly the minimum and for larger targets', () => {
    const touch = layoutRulesFor(PHONE)
    expect(touchTargetOk(touch, 44, 44)).toBe(true)
    expect(touchTargetOk(touch, 200, 100)).toBe(true)
    const pointer = layoutRulesFor({ ...PHONE, isTouch: false })
    expect(touchTargetOk(pointer, 32, 32)).toBe(true)
  })

  it('fails when either dimension is below the minimum', () => {
    const touch = layoutRulesFor(PHONE)
    expect(touchTargetOk(touch, 43, 44)).toBe(false)
    expect(touchTargetOk(touch, 44, 43)).toBe(false)
    const pointer = layoutRulesFor({ ...PHONE, isTouch: false })
    expect(touchTargetOk(pointer, 31, 200)).toBe(false)
  })
})

describe('P4-T08 validateLayout — tamper detection', () => {
  it('passes well-formed rules for every viewport class', () => {
    for (const input of [PHONE, TABLET, DESKTOP]) {
      const result = validateLayout(layoutRulesFor(input))
      expect(result.ok).toBe(true)
      expect(result.problems).toEqual([])
    }
  })

  it('flags a viewport that does not match its width', () => {
    expect(validateLayout(baseRules({ viewport: 'phone', width: 600 })).ok).toBe(
      false,
    )
    expect(
      validateLayout(baseRules({ viewport: 'tablet', width: 599 })).ok,
    ).toBe(false)
    expect(
      validateLayout(baseRules({ viewport: 'tablet', width: 1024 })).ok,
    ).toBe(false)
    expect(
      validateLayout(baseRules({ viewport: 'desktop', width: 1023 })).ok,
    ).toBe(false)
  })

  it('flags a non-positive or non-finite width and height', () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateLayout(baseRules({ width: bad })).ok).toBe(false)
      expect(validateLayout(baseRules({ height: bad })).ok).toBe(false)
    }
  })

  it('flags a negative minTouchTargetPx', () => {
    const result = validateLayout(baseRules({ minTouchTargetPx: -1 }))
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('minTouchTargetPx'))).toBe(true)
  })

  it('flags gridColumns outside 1..3', () => {
    for (const bad of [0, 4, 1.5]) {
      const result = validateLayout(baseRules({ gridColumns: bad }))
      expect(result.ok).toBe(false)
      expect(result.problems.some((p) => p.includes('gridColumns'))).toBe(true)
    }
  })

  it('flags a panelMode that does not match the viewport class', () => {
    for (const bad of ['floating', 'side-panel'] as PanelMode[]) {
      const result = validateLayout(baseRules({ panelMode: bad }))
      expect(result.ok).toBe(false)
      expect(result.problems.some((p) => p.includes('panelMode'))).toBe(true)
    }
  })

  it('collects every problem at once, not just the first', () => {
    const result = validateLayout(
      baseRules({
        viewport: 'desktop',
        width: 599,
        minTouchTargetPx: -1,
        gridColumns: 0,
        panelMode: 'bottom-sheet',
        safeInsetsPx: { top: -5, bottom: 0, left: 0, right: 0 },
      }),
    )
    expect(result.ok).toBe(false)
    for (const needle of ['viewport', 'minTouchTargetPx', 'gridColumns', 'panelMode', 'safeInsetsPx.top']) {
      expect(result.problems.some((p) => p.includes(needle))).toBe(true)
    }
  })
})

describe('P4-T08 module purity — no mutable module-scope lookup containers', () => {
  const layoutSource = readFileSync(
    fileURLToPath(new URL('../src/sim/ui/layout.ts', import.meta.url)),
    'utf8',
  )

  it.each(['PANEL_MODE_FOR', 'GRID_COLUMNS_FOR', 'INSET_EDGES'])(
    'wraps the module-scope lookup %s in Object.freeze',
    (binding) => {
      const declaration = layoutSource
        .split('\n')
        .find((line) => line.trim().startsWith(`const ${binding}`))
      expect(declaration).toBeDefined()
      expect(declaration).toContain('Object.freeze(')
    },
  )
})

describe('P4-T08 cross-checks — exported constants stay in sync', () => {
  it('the exported breakpoints and touch targets match the locked mapping', () => {
    expect(PHONE_MAX_WIDTH_PX).toBe(600)
    expect(DESKTOP_MIN_WIDTH_PX).toBe(1024)
    expect(MIN_TOUCH_TARGET_TOUCH_PX).toBe(44)
    expect(MIN_TOUCH_TARGET_POINTER_PX).toBe(32)
    expect(classifyViewport(PHONE_MAX_WIDTH_PX - 1, 800)).toBe('phone')
    expect(classifyViewport(DESKTOP_MIN_WIDTH_PX - 1, 800)).toBe('tablet')
    expect(classifyViewport(DESKTOP_MIN_WIDTH_PX, 800)).toBe('desktop')
  })
})
