/**
 * Responsive / touch UI layout contract (P4-T08).
 *
 * PURE module: every function derives only from its arguments — no
 * nondeterministic APIs, no module-level mutable state, no wall-clock. The
 * same inputs always produce the same (deep-equal) LayoutRules and panel
 * layouts. Contract scope: the layout-state model and its projections only —
 * React components consume them in later tasks. No rendering wiring exists
 * here.
 *
 * LOCKED BREAKPOINTS (width is the driver; documented width-only — `height`
 * is accepted for signature symmetry with layoutRulesFor but never influences
 * the class; height only matters for orientation edge cases, which this
 * contract leaves to the caller):
 *   - phone   width < 600px
 *   - tablet  width 600–1023px
 *   - desktop width >= 1024px
 *
 * LOCKED MAPPING (mobile-first UX — phone users are the primary audience):
 *   - panelMode:   phone → 'bottom-sheet' (one stacked sheet over the scene);
 *                  tablet → 'side-panel'; desktop → 'floating'. Documented
 *                  per-class mapping.
 *   - gridColumns: phone 1 · tablet 2 · desktop 3.
 *   - minTouchTargetPx: 44 when isTouch (the standard mobile minimum — the
 *                  roadmap's "touch targets >= 44px"; DESIGN.md pins no
 *                  number, so the common 44px mobile guideline is used),
 *                  else 32 for pointer precision.
 *   - safeInsetsPx default to 0 when not supplied.
 *
 * PANEL LAYOUT CONTRACT (panelLayout):
 *   - phone:   EVERY panel stacks (input order preserved), one is `visible`,
 *              overlay true — bottom-sheet semantics: the stacked sheet
 *              overlays the game scene.
 *   - tablet/desktop: the FIRST panel is persistent side/floating chrome
 *              (overlay false) and is NOT stacked; the REST stack.
 *   - `visible`: the activePanel when it is non-null AND a member of the
 *              stacked set; otherwise null — nothing stacked is open. The
 *              persistent first panel (tablet/desktop) is always present and
 *              is not gated by `visible`.
 *   - Deterministic: identical inputs always yield identical results, and the
 *              input panel array is never mutated.
 *
 * Validation: layoutRulesFor throws a RangeError on a non-finite or
 * non-positive width/height, or a non-finite or negative safe inset.
 * validateLayout collects every inconsistency (viewport vs width, panelMode,
 * gridColumns, minTouchTargetPx, dimensions, safe insets) before returning.
 */

export type ViewportClass = 'phone' | 'tablet' | 'desktop'

export type PanelMode = 'bottom-sheet' | 'side-panel' | 'floating'

export interface LayoutRules {
  viewport: ViewportClass
  width: number
  height: number
  isTouch: boolean
  minTouchTargetPx: number
  panelMode: PanelMode
  gridColumns: number
  safeInsetsPx: { top: number; bottom: number; left: number; right: number }
}

export interface SafeInsetsInput {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

export interface LayoutRulesInput {
  width: number
  height: number
  isTouch: boolean
  safeInsetsPx?: SafeInsetsInput
}

export interface PanelLayoutInput {
  rules: LayoutRules
  panels: readonly string[]
  activePanel: string | null
}

export interface PanelLayoutResult {
  stacked: string[]
  visible: string | null
  overlay: boolean
}

export const PHONE_MAX_WIDTH_PX = 600
export const TABLET_MIN_WIDTH_PX = 600
export const TABLET_MAX_WIDTH_PX = 1024
export const DESKTOP_MIN_WIDTH_PX = 1024
export const MIN_TOUCH_TARGET_TOUCH_PX = 44
export const MIN_TOUCH_TARGET_POINTER_PX = 32

const PANEL_MODE_FOR: Readonly<Record<ViewportClass, PanelMode>> = Object.freeze({
  phone: 'bottom-sheet',
  tablet: 'side-panel',
  desktop: 'floating',
})

const GRID_COLUMNS_FOR: Readonly<Record<ViewportClass, number>> = Object.freeze({
  phone: 1,
  tablet: 2,
  desktop: 3,
})

const INSET_EDGES: readonly ['top', 'bottom', 'left', 'right'] = Object.freeze([
  'top',
  'bottom',
  'left',
  'right',
])

function assertDimension(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number (px), got ${value}`)
  }
}

function assertSafeInset(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0 (px), got ${value}`)
  }
}

/**
 * Classify a viewport by WIDTH only — the locked breakpoints (phone < 600px ·
 * tablet 600–1023px · desktop >= 1024px). `height` is accepted for signature
 * symmetry with layoutRulesFor but deliberately ignored (documented
 * width-only simplification). Pure and deterministic; no validation — a
 * non-positive width simply classifies as phone.
 */
export function classifyViewport(width: number, height: number): ViewportClass {
  void height
  if (width < PHONE_MAX_WIDTH_PX) {
    return 'phone'
  }
  if (width < DESKTOP_MIN_WIDTH_PX) {
    return 'tablet'
  }
  return 'desktop'
}

/**
 * Build the full layout rules for a viewport. panelMode / gridColumns /
 * minTouchTargetPx follow the LOCKED per-class mapping; safeInsetsPx default
 * to 0 when omitted. width and height must be positive finite numbers, and
 * every supplied safe inset a finite number >= 0 — otherwise a RangeError is
 * thrown. Pure and deterministic.
 */
export function layoutRulesFor(input: LayoutRulesInput): LayoutRules {
  assertDimension(input.width, 'width')
  assertDimension(input.height, 'height')
  const viewport = classifyViewport(input.width, input.height)
  const panelMode = PANEL_MODE_FOR[viewport]
  const gridColumns = GRID_COLUMNS_FOR[viewport]
  const minTouchTargetPx = input.isTouch
    ? MIN_TOUCH_TARGET_TOUCH_PX
    : MIN_TOUCH_TARGET_POINTER_PX
  for (const edge of INSET_EDGES) {
    const value = input.safeInsetsPx?.[edge]
    if (value !== undefined) {
      assertSafeInset(value, `safeInsetsPx.${edge}`)
    }
  }
  return {
    viewport,
    width: input.width,
    height: input.height,
    isTouch: input.isTouch,
    minTouchTargetPx,
    panelMode,
    gridColumns,
    safeInsetsPx: {
      top: input.safeInsetsPx?.top ?? 0,
      bottom: input.safeInsetsPx?.bottom ?? 0,
      left: input.safeInsetsPx?.left ?? 0,
      right: input.safeInsetsPx?.right ?? 0,
    },
  }
}

/**
 * Resolve the panel stack for the current rules. Phone stacks EVERY panel in
 * input order with overlay true (bottom-sheet semantics); tablet/desktop keep
 * the FIRST panel as persistent side/floating chrome (overlay false) and stack
 * the REST. `visible` is the activePanel when it is a stacked member
 * (non-null), else null. Deterministic; the input panels array is never
 * mutated.
 */
export function panelLayout(input: PanelLayoutInput): PanelLayoutResult {
  const { rules, panels, activePanel } = input
  if (rules.viewport === 'phone') {
    const stacked = [...panels]
    return {
      stacked,
      visible: activePanel !== null && stacked.includes(activePanel) ? activePanel : null,
      overlay: true,
    }
  }
  const stacked = panels.slice(1)
  return {
    stacked,
    visible: activePanel !== null && stacked.includes(activePanel) ? activePanel : null,
    overlay: false,
  }
}

/**
 * True when a target of the given size meets the rules' minimum touch target
 * (width AND height >= minTouchTargetPx).
 */
export function touchTargetOk(rules: LayoutRules, widthPx: number, heightPx: number): boolean {
  return widthPx >= rules.minTouchTargetPx && heightPx >= rules.minTouchTargetPx
}

/**
 * Validate a LayoutRules, catching tamper classes a well-behaved builder would
 * never produce: a viewport inconsistent with its width, non-finite or
 * non-positive width/height, a negative minTouchTargetPx, a gridColumns
 * outside 1..3, a panelMode that does not match the viewport class, and
 * non-finite or negative safe insets. Collects ALL problems before returning.
 */
export function validateLayout(rules: LayoutRules): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  if (!Number.isFinite(rules.width) || rules.width <= 0) {
    problems.push(`width must be a positive finite number (px), got ${rules.width}`)
  } else {
    const expectedViewport = classifyViewport(rules.width, rules.height)
    if (rules.viewport !== expectedViewport) {
      problems.push(
        `viewport ${rules.viewport} does not match width ${rules.width} (expected ${expectedViewport})`,
      )
    }
  }
  if (!Number.isFinite(rules.height) || rules.height <= 0) {
    problems.push(`height must be a positive finite number (px), got ${rules.height}`)
  }
  if (!Number.isFinite(rules.minTouchTargetPx) || rules.minTouchTargetPx < 0) {
    problems.push(
      `minTouchTargetPx must be a finite number >= 0 (px), got ${rules.minTouchTargetPx}`,
    )
  }
  if (
    !Number.isInteger(rules.gridColumns) ||
    rules.gridColumns < 1 ||
    rules.gridColumns > 3
  ) {
    problems.push(`gridColumns must be an integer in 1..3, got ${rules.gridColumns}`)
  }
  const expectedPanelMode = PANEL_MODE_FOR[rules.viewport]
  if (rules.panelMode !== expectedPanelMode) {
    problems.push(
      `panelMode ${rules.panelMode} does not match viewport ${rules.viewport} (expected ${expectedPanelMode})`,
    )
  }
  for (const edge of INSET_EDGES) {
    const value = rules.safeInsetsPx[edge]
    if (!Number.isFinite(value) || value < 0) {
      problems.push(
        `safeInsetsPx.${edge} must be a finite number >= 0 (px), got ${value}`,
      )
    }
  }

  return { ok: problems.length === 0, problems }
}
