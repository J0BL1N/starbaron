/**
 * CONQUEST COST (P7-T06) — the escalating price of taking a planet: a base
 * cost per target tier (DESIGN §5: "Taking a planet costs a large, escalating
 * cost in population + fleet + credits — not easy, not spammable") scaled by
 * the attacker's empire size (each prior conquest raises the next one's price
 * — the "not spammable" knob). This module is the PURE COST MODEL only —
 * T07 applies it to a real conquest handover.
 *
 * The estimator (src/sim/player/estimator.ts) locks NO conquest-cost today:
 * launchCost is a credits-only LAUNCH fee (200 + fleet × 0.2 + distancePc ×
 * 10) paid before a battle begins, not the conquest cost itself. So this module
 * DRAFTS the DESIGN-true escalating curve as a balance harness (P10): the
 * exported base constants are tunable inputs, not derived numbers.
 *
 * PURE module — deterministic, no time-source reads, no nondeterministic
 * APIs, no module-level mutable state (the constant tables below are
 * deep-frozen and read-only), strictly typed.
 *
 * DESIGN decisions (documented):
 * - **Base cost (draft curve):** population = CONQUEST_BASE_POPULATION ×
 *   tier, fleet = CONQUEST_BASE_FLEET × tier, credits = CONQUEST_BASE_CREDITS
 *   × tier. "Large" per DESIGN — a T4 target costs 8,000 population, 4,000
 *   fleet and 200,000 credits before escalation. Tier comes from the
 *   catalogue (PlanetTier 1..5); the functions accept every integer tier >= 1.
 * - **Empire escalation:** each SUCCESSFUL conquest the attacker has landed
 *   raises the NEXT conquest's cost by EMPIRE_ESCALATION_PER_CONQUEST (0.1),
 *   so N prior conquests cost ×(1 + 0.1N) — 3 prior conquests face ×1.3, and
 *   spamming the same target compounds its own price. Capped at
 *   CONQUEST_ESCALATION_CAP (2.0) — escalation is a deterrent, never a total
 *   lockout. The reason reads 'recent conquest #N' (or 'none').
 * - **Totals:** total = floor(base × multiplier) per component — a
 *   fractional product can never understate the price.
 * - **Identity:** id-free by design — targetId is carried through (a cost
 *   record needs no hash; a deterministic battleId belongs to the resolution
 *   model, T03). targetId is trimmed by the shared validator.
 * - **Escalation by conquests, not launches:** the counter is SUCCESSFUL
 *   conquests (the empire-size knob from DESIGN §5), distinct from the
 *   estimator's war-weariness (launches within a window, the T03-era force
 *   tax). Both stack in a real conquest; this module only prices the cost.
 */

import { assertNonEmptyString } from '../ui/validate'

export interface ResourceCost {
  population: number
  fleet: number
  credits: number
}

export interface ConquestCost {
  targetId: string
  tier: number
  base: ResourceCost
  escalation: {
    multiplier: number
    reason: string
  }
  total: ResourceCost
}

/**
 * CONQUEST_BASE_POPULATION = 2000 — base population cost of taking a planet,
 * before the empire-size multiplier. Balance-harness input (P10): 2,000 ×
 * tier, so a T4 world costs 8,000 population.
 */
export const CONQUEST_BASE_POPULATION = 2000

/**
 * CONQUEST_BASE_FLEET = 1000 — base fleet (deployed soldiers) cost of taking
 * a planet. Balance-harness input (P10): 1,000 × tier.
 */
export const CONQUEST_BASE_FLEET = 1000

/**
 * CONQUEST_BASE_CREDITS = 50000 — base credit cost of taking a planet.
 * Balance-harness input (P10): 50,000 × tier, so a T4 world costs 200,000
 * credits — "large" per DESIGN §5.
 */
export const CONQUEST_BASE_CREDITS = 50000

/**
 * EMPIRE_ESCALATION_PER_CONQUEST = 0.1 — each successful conquest raises the
 * next conquest's cost multiplier by 0.1 (the "not spammable" knob). 3 prior
 * conquests face ×1.3; 10 face the cap.
 */
export const EMPIRE_ESCALATION_PER_CONQUEST = 0.1

/**
 * CONQUEST_ESCALATION_CAP = 2.0 — the maximum empire-escalation multiplier.
 * Escalation deters spam but never locks conquest out entirely: the worst a
 * serial conqueror faces is a doubled cost.
 */
export const CONQUEST_ESCALATION_CAP = 2.0

/** The exported draft constants as one deep-frozen table (read-only). */
export const CONQUEST_COST_CONSTANTS: Readonly<{
  basePopulation: number
  baseFleet: number
  baseCredits: number
  perConquest: number
  cap: number
}> = Object.freeze({
  basePopulation: CONQUEST_BASE_POPULATION,
  baseFleet: CONQUEST_BASE_FLEET,
  baseCredits: CONQUEST_BASE_CREDITS,
  perConquest: EMPIRE_ESCALATION_PER_CONQUEST,
  cap: CONQUEST_ESCALATION_CAP,
})

function assertIntegerAtLeast(value: number, minimum: number, field: string): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${field} must be an integer >= ${minimum}, got ${value}`)
  }
  return value
}

function assertFiniteNumber(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} must be a finite number, got ${value}`)
  }
  return value
}

/**
 * The base conquest cost for a target's catalogue tier: population = 2,000 ×
 * tier, fleet = 1,000 × tier, credits = 50,000 × tier (draft balance-harness
 * curve — the DESIGN-required "large" base before empire escalation). tier
 * must be an integer >= 1 (RangeError otherwise).
 */
export function baseConquestCost(tier: number): ResourceCost {
  assertIntegerAtLeast(tier, 1, 'tier')
  return {
    population: CONQUEST_BASE_POPULATION * tier,
    fleet: CONQUEST_BASE_FLEET * tier,
    credits: CONQUEST_BASE_CREDITS * tier,
  }
}

/**
 * The empire-size escalation: multiplier = min(1 + 0.1 × attackerConquests,
 * 2.0) — each successful conquest raises the next conquest's cost by 10%
 * (anti-spam), capped at CONQUEST_ESCALATION_CAP. The reason is
 * 'recent conquest #N' when attackerConquests > 0, else 'none'. attackerConquests
 * must be an integer >= 0 (RangeError otherwise).
 */
export function empireEscalation(attackerConquests: number): {
  multiplier: number
  reason: string
} {
  assertIntegerAtLeast(attackerConquests, 0, 'attackerConquests')
  const multiplier = Math.min(
    1 + EMPIRE_ESCALATION_PER_CONQUEST * attackerConquests,
    CONQUEST_ESCALATION_CAP,
  )
  return {
    multiplier,
    reason:
      attackerConquests > 0 ? `recent conquest #${attackerConquests}` : 'none',
  }
}

/**
 * The full conquest cost for a target: base (per tier) × empire escalation
 * (per prior conquest), each total component floored. targetId is carried
 * through (trimmed by the shared validator); tier must be an integer >= 1 and
 * attackerConquests an integer >= 0. The input object is never mutated — a
 * fresh cost is returned.
 */
export function conquestCostFor(input: {
  targetId: string
  tier: number
  attackerConquests: number
}): ConquestCost {
  const targetId = assertNonEmptyString(input.targetId, 'targetId')
  const tier = assertIntegerAtLeast(input.tier, 1, 'tier')
  const attackerConquests = assertIntegerAtLeast(
    input.attackerConquests,
    0,
    'attackerConquests',
  )
  const base = baseConquestCost(tier)
  const escalation = empireEscalation(attackerConquests)
  const total: ResourceCost = {
    population: Math.floor(base.population * escalation.multiplier),
    fleet: Math.floor(base.fleet * escalation.multiplier),
    credits: Math.floor(base.credits * escalation.multiplier),
  }
  return { targetId, tier, base, escalation, total }
}

function formatInteger(value: number): string {
  const digits = String(value)
  let out = ''
  let count = 0
  for (let i = digits.length - 1; i >= 0; i--) {
    out = digits[i] + out
    count++
    if (count % 3 === 0 && i > 0) {
      out = ',' + out
    }
  }
  return out
}

/**
 * Deterministic one-line conquest-cost summary, e.g.
 * `Conquest cost (T4 · ×1.3): 10,400 population · 5,200 fleet · 260K cr`.
 * Numbers use a plain thousands separator and a fixed one-decimal multiplier
 * (deterministic everywhere — no environment-sensitive formatting). The
 * cost's tier must be an integer >= 1, its multiplier finite, and its total
 * components finite non-negative integers (RangeError otherwise).
 */
export function conquestCostSummary(cost: ConquestCost): string {
  const tier = assertIntegerAtLeast(cost.tier, 1, 'cost.tier')
  assertFiniteNumber(cost.escalation.multiplier, 'cost.escalation.multiplier')
  const total = cost.total
  for (const key of ['population', 'fleet', 'credits'] as const) {
    if (!Number.isInteger(total[key]) || total[key] < 0) {
      throw new RangeError(
        `cost.total.${key} must be a non-negative integer, got ${total[key]}`,
      )
    }
  }
  return (
    `Conquest cost (T${tier} · ×${cost.escalation.multiplier.toFixed(1)}): ` +
    `${formatInteger(total.population)} population · ` +
    `${formatInteger(total.fleet)} fleet · ` +
    `${formatInteger(Math.floor(total.credits / 1000))}K cr`
  )
}
