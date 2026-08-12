/**
 * P3-T06 — Production summary layer.
 *
 * Pure module: no nondeterministic APIs, no module-level mutable state, no
 * wall-clock. Every number derives from the LOCKED formulas in
 * src/sim/structures/effects.ts (structureEffect) and the LOCKED composition
 * in src/sim/player/accrual.ts (computePlanetDerived). This module is a
 * SUMMARY/wrapper layer — it never re-derives a formula, it wraps the locked
 * pieces.
 *
 * Scope: structure production only. The planet's passive baseline income
 * (baselinePassiveIncome(tier)) is produced by the planet itself, not by any
 * structure, so it is attributed to NO row; each row is that structure's OWN
 * marginal contribution:
 *   - trade hub -> baselinePassiveIncome(tier) x (multiplier - 1) x binarySystem
 *     (the multiplier increment it adds, exactly the composition accrual uses:
 *     baseline x tradeHub multiplier)
 *   - ore mine  -> (ORE_ALLOYS_PER_MIN / 60) x effectiveLevel x highGravity
 *   - shipyard  -> (SHIPYARD_INCOME_PER_MIN / 60) x effectiveLevel, flat and
 *     NOT tier-scaled (gasGiant only boosts fleet cap, never income)
 *   - housing/hydroponics/barracks/defenseTurret -> zero
 * Consequently summary.total + baselinePassiveIncome(tier) x binarySystemFactor
 * equals the locked computePlanetDerived creditsPerSec for the same
 * tier/quirks/grid (alloys match exactly).
 *
 * Modifier composition is applied per-structure exactly where the locked path
 * applies it (tier + binarySystem on trade hub, highGravity on ore mine, none
 * on shipyard), because a single planet-wide scalar cannot reproduce the
 * locked totals. planetEfficiency exposes the same composition as one
 * aggregate scalar.
 */
import { BASE_INCOME_PER_TIER, baselinePassiveIncome } from '../core/economy'
import { quirkById } from '../planets/quirks'
import { STRUCTURES, STRUCTURE_IDS, isStructureId } from './data'
import { structureEffect } from './effects'
import type { StructureId } from './types'

type QuirkId = Parameters<typeof quirkById>[0]

export interface ProductionRates {
  creditsPerSec: number
  alloysPerSec: number
}

export interface StructureProduction {
  structure: StructureId
  level: number
  creditsPerSec: number
  alloysPerSec: number
  description: string
}

export interface ProductionSummary {
  planet: { name: string; tier: number }
  total: ProductionRates
  perStructure: StructureProduction[]
}

function assertKnownStructure(id: unknown): asserts id is StructureId {
  if (!isStructureId(id)) {
    throw new RangeError(`unknown structure id, got ${String(id)}`)
  }
}

function productionQuirkMultiplier(
  structure: StructureId,
  quirks: readonly QuirkId[],
): number {
  let multiplier = 1
  for (const id of quirks) {
    const quirk = quirkById(id)
    if (quirk.structureId === structure) {
      multiplier *= quirk.multiplier
    }
  }
  return multiplier
}

/**
 * Raw per-level production rate of a single structure, ignoring tier and
 * quirks, expressed as the structure's OWN marginal contribution. Mirrors
 * structureEffect/effects.ts exactly:
 * - ore mine -> (ORE_ALLOYS_PER_MIN / 60) x effectiveLevel alloys
 * - shipyard -> (SHIPYARD_INCOME_PER_MIN / 60) x effectiveLevel credits
 * - trade hub -> reference tier-1 baseline (BASE_INCOME_PER_TIER) x the locked
 *   multiplier increment (structureEffect multiplier - 1, i.e.
 *   TRADE_HUB_INCOME_MULTIPLIER_PER_LEVEL x effectiveLevel). The signature is
 *   tier-free, so the tier-1 baseline is the reference; productionSummaryFor
 *   applies the planet's actual tier exactly where the locked path does
 *   (trade-hub credits).
 * - all other structures produce no credits/alloys.
 */
export function structureRates(
  structure: StructureId,
  level: number,
): ProductionRates {
  assertKnownStructure(structure)
  const effect = structureEffect(structure, level)
  switch (structure) {
    case 'oreMine':
      return {
        creditsPerSec: 0,
        alloysPerSec: effect.kind === 'alloys' ? effect.alloysPerSec : 0,
      }
    case 'tradeHub':
      return {
        creditsPerSec:
          BASE_INCOME_PER_TIER *
          (effect.kind === 'incomeMultiplier' ? effect.multiplier - 1 : 0),
        alloysPerSec: 0,
      }
    case 'shipyard':
      return {
        creditsPerSec:
          effect.kind === 'shipyard' ? effect.shipbuildingIncomePerSec : 0,
        alloysPerSec: 0,
      }
    default:
      return { creditsPerSec: 0, alloysPerSec: 0 }
  }
}

function structureEfficiencyFor(
  structure: StructureId,
  tier: number,
  quirks: readonly QuirkId[],
): number {
  switch (structure) {
    case 'tradeHub':
      return (
        (baselinePassiveIncome(tier) / BASE_INCOME_PER_TIER) *
        productionQuirkMultiplier('tradeHub', quirks)
      )
    case 'oreMine':
      return productionQuirkMultiplier('oreMine', quirks)
    default:
      return 1
  }
}

/**
 * Aggregate planet production efficiency: the tier factor
 * (baselinePassiveIncome(tier) / BASE_INCOME_PER_TIER) combined with the
 * multipliers of every production-relevant quirk (binarySystem -> tradeHub,
 * highGravity -> oreMine). Non-production quirks (denseCore, hotStar,
 * coldStar, massiveWorld, gasGiant) do not touch credits/alloys in the locked
 * path and are excluded.
 *
 * INFORMATIONAL APPROXIMATION — NOT an exact accrual value. This scalar
 * combines modifiers that the locked path applies to DIFFERENT structures
 * (the tier factor and binarySystem apply only to trade-hub credits,
 * highGravity only to ore-mine alloys), so multiplying it uniformly across a
 * planet would NOT reproduce the locked totals. Do NOT apply it as a single
 * uniform multiplier. productionSummaryFor's per-structure path is the exact
 * accrual mirror and is authoritative; use that for any exact figure.
 */
export function planetEfficiency(
  tier: number,
  quirks: readonly QuirkId[],
): number {
  const tierFactor = baselinePassiveIncome(tier) / BASE_INCOME_PER_TIER
  return (
    tierFactor *
    productionQuirkMultiplier('tradeHub', quirks) *
    productionQuirkMultiplier('oreMine', quirks)
  )
}

/**
 * Per-planet production summary. Every per-structure row is
 * structureRates(structure, level) scaled by the modifiers the locked accrual
 * path applies to THAT structure (tier factor + binarySystem for tradeHub,
 * highGravity for oreMine, none for shipyard and the non-production
 * structures). Totals reconcile with the locked computePlanetDerived up to the
 * constant passive baseline: summary.total + baselinePassiveIncome(tier) x
 * binarySystemFactor == locked creditsPerSec (alloys match exactly).
 * perStructure is sorted by structure id; description comes from data.ts.
 */
export function productionSummaryFor(input: {
  name: string
  tier: number
  quirks?: readonly QuirkId[]
  grid: Record<StructureId, number>
}): ProductionSummary {
  baselinePassiveIncome(input.tier)
  const quirks = input.quirks ?? []
  for (const id of quirks) {
    quirkById(id)
  }
  for (const key of Object.keys(input.grid)) {
    assertKnownStructure(key)
  }

  const perStructure = STRUCTURE_IDS.map((structure) => {
    const level = input.grid[structure] ?? 0
    const rates = structureRates(structure, level)
    const efficiency = structureEfficiencyFor(structure, input.tier, quirks)
    return {
      structure,
      level,
      creditsPerSec: rates.creditsPerSec * efficiency,
      alloysPerSec: rates.alloysPerSec * efficiency,
      description: STRUCTURES[structure].name,
    }
  })
  perStructure.sort((a, b) => a.structure.localeCompare(b.structure))

  let creditsPerSec = 0
  let alloysPerSec = 0
  for (const entry of perStructure) {
    creditsPerSec += entry.creditsPerSec
    alloysPerSec += entry.alloysPerSec
  }

  return {
    planet: { name: input.name, tier: input.tier },
    total: { creditsPerSec, alloysPerSec },
    perStructure,
  }
}
