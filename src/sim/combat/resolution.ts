/**
 * COMBAT RESOLUTION (P7-T03) — the deterministic battle outcome: attack power
 * vs defense power decides victory / stalemate / defeat, the surviving troops,
 * and the defender casualties. DESIGN.md §5 / §5a lock the model: AP =
 * deployed soldiers × shipyard tier; DP = turret defense power + militia
 * (0.15 × population); "taking a planet costs a large, escalating cost in
 * population + fleet + credits — not easy, not spammable". This module is the
 * pure, deterministic RESOLUTION half — the launch/commit lifecycle is T01/T02
 * and the who-takes-the-planet handover is T07 (escalation/tech modifiers are
 * T09/T11).
 *
 * PURE module — deterministic, no time-source reads (`resolvedAt` is an
 * INPUT), no nondeterministic APIs, no mutable module-level state (lookup
 * tables are deep-frozen), strictly typed.
 *
 * DESIGN decisions (all documented — pinned deterministic rates):
 * - **Attack Power (DELEGATED):** `battlePowers` delegates AP to the locked
 *   estimator `attackPower(soldiers, shipyardTier)` (src/sim/player/
 *   estimator.ts) — the applied resolver form of DESIGN's "troops × shipyard
 *   tier": the shipyard contributes its EFFECTIVE level (half-after-10), so a
 *   tier-2 shipyard multiplies AP by exactly 2 and a tier-15 by 12.5. The
 *   estimator is the single locked source — never re-derived here.
 * - **Defense Power (DELEGATED):** `battlePowers` delegates DP to the locked
 *   `defensePower(turretLevels, population)` (src/sim/structures/effects.ts) —
 *   `500 × effectiveLevel(turrets) + 0.15 × population`. Never re-derived.
 * - **Result:** victory when AP > DP; STALEMATE when AP == DP (documented
 *   boundary: DESIGN §5a's ratio table treats ≥ 1.0 as a pyrrhic win, but the
 *   3-way deterministic model assigns exact equality to stalemate — no planet
 *   changes hands on exactly equal force, the defenders hold); defeat when
 *   AP < DP.
 * - **Surviving troops:** victory → floor(troops × (1 − casualtyRate)) with
 *   BATTLE_CASUALTY_RATE = 0.3 default — committed troops are lost whether
 *   the attack wins or loses (§5); the 30% loss is a flat mid-point between
 *   DESIGN's decisive 40% and pyrrhic 70% (pinned draft). defeat → 0 — a
 *   repelled landing force is destroyed (DESIGN's crushed bucket loses 90%;
 *   the 3-way model pins ALL committed troops lost). stalemate →
 *   floor(troops × 0.5) — the attackers WITHDRAW on exact equality and bring
 *   half their force home (STALEMATE_SURVIVOR_RATE = 0.5, documented draft —
 *   the cost of a failed landing).
 * - **Defender casualties:** defenders take casualties on an attack that
 *   lands: victory → floor(population × DEFENDER_CASUALTY_RATE_VICTORY = 0.1)
 *   (a smaller draft — the defenders lose to the assault); defeat →
 *   floor(population × DEFENDER_CASUALTY_RATE = 0.2) (a repelled assault
 *   still bleeds the defenders, mirroring DESIGN's repelled 30% as a lower
 *   draft); stalemate → 0 (the attack withdraws without breaking the line —
 *   defenders hold intact, documented). Both rates are pinned balance inputs.
 * - **casualtyRate:** optional per-battle override in [0,1], default
 *   BATTLE_CASUALTY_RATE — only scales VICTORY survivors (stalemate keeps its
 *   fixed 0.5 withdrawal rate, defeat keeps 0).
 * - **Id:** `fnv1a(`${attackerId}|${targetId}|${resolvedAt}`).toString(16)` —
 *   deterministic, no time-source reads (`resolvedAt` is an input), matching
 *   the launch model's id convention (attack-orders.ts).
 * - **Report:** `battleReport` is a deterministic one-line string. The
 *   committed-troop count is NOT part of the locked BattleOutcome shape, so
 *   the 'of N troops' clause takes the committed count as an OPTIONAL second
 *   argument; when omitted the clause is dropped.
 * - **Home-world guard (T08 wired):** `resolveBattle` consults the locked
 *   `assertConquestPermitted` guard (home-immunity.ts) with the REAL target
 *   owner (`targetOwner` — null for an unowned target) and the resolution
 *   time. A resolution touching the owner's protected home world throws the
 *   guard's Error — the downstream capture transfer refusal (P7-T07) is
 *   never reached for a protected home.
 *
 * Validation (each throws RangeError, delegated where noted): attackerId /
 * targetId non-empty (validate.ts); resolvedAt positive finite
 * (validate.ts assertPositiveAt); casualtyRate in [0,1]; troops / tier /
 * turrets / population via the two locked helpers (estimator's attackPower:
 * troops > 0, tier integer 0..100; effects' defensePower: turrets a
 * non-negative integer, population finite ≥ 0). The home-immunity guard
 * (assertConquestPermitted) throws its own Error on a protected home world.
 */

import { attackPower } from '../player/estimator'
import { defensePower } from '../structures/effects'
import { fnv1a } from '../planets/hash'
import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'
import { assertConquestPermitted } from './home-immunity'
import type { PlayerState } from '../player/types'

export type BattleResult = 'victory' | 'defeat' | 'stalemate'

/** The BattleResult union as a deep-frozen lookup table (runtime-immutable). */
export const BATTLE_RESULTS: readonly BattleResult[] = Object.freeze([
  'victory',
  'defeat',
  'stalemate',
])

/**
 * BATTLE_CASUALTY_RATE = 0.3 — the default committed-troop loss on a victory.
 * Committed troops are lost whether the attack wins or loses (§5); the 30%
 * loss is a flat mid-point between DESIGN's decisive 40% and pyrrhic 70%.
 */
export const BATTLE_CASUALTY_RATE = 0.3

/**
 * STALEMATE_SURVIVOR_RATE = 0.5 — on exact force equality the attackers
 * withdraw and bring half their committed troops home (documented draft — the
 * cost of a failed landing).
 */
export const STALEMATE_SURVIVOR_RATE = 0.5

/**
 * DEFENDER_CASUALTY_RATE = 0.2 — defender population lost on a repelled
 * (defeat) assault: floor(population × 0.2). A repelled assault still bleeds
 * the defenders, mirroring DESIGN's repelled 30% as a lower pinned draft.
 */
export const DEFENDER_CASUALTY_RATE = 0.2

/**
 * DEFENDER_CASUALTY_RATE_VICTORY = 0.1 — defender population lost when the
 * attack wins: floor(population × 0.1). Defenders take casualties on an
 * attack that lands; a winning assault costs a smaller draft (pinned input).
 */
export const DEFENDER_CASUALTY_RATE_VICTORY = 0.1

export interface BattlePowersInput {
  troops: number
  shipyardTier: number
  turretLevels: number
  population: number
}

export interface BattlePowers {
  attackPower: number
  defensePower: number
}

export interface ResolveBattleInput {
  attackerId: string
  targetId: string
  troops: number
  shipyardTier: number
  turretLevels: number
  population: number
  resolvedAt: number
  casualtyRate?: number
  /**
   * The REAL target owner (null when the target is unowned). Wired into the
   * locked home-immunity guard (P7-T08): no resolution touching the owner's
   * protected home world is permitted.
   */
  targetOwner: PlayerState | null
}

export interface BattleOutcome {
  battleId: string
  attackerId: string
  targetId: string
  resolvedAt: number
  attackPower: number
  defensePower: number
  victory: boolean
  survivingTroops: number
  defenderCasualties: number
  result: BattleResult
}

/**
 * THE two battle powers (DESIGN §5a). Attack Power DELEGATES to the locked
 * estimator `attackPower(troops, shipyardTier)` (the applied resolver form of
 * DESIGN's "troops × shipyard tier" — the shipyard contributes its effective
 * level). Defense Power DELEGATES to the locked `defensePower(turretLevels,
 * population)` from effects.ts (`500 × effectiveLevel(turrets) + 0.15 ×
 * population`). Never re-derived. Validation is the helpers' own (RangeError).
 */
export function battlePowers(input: BattlePowersInput): BattlePowers {
  return {
    attackPower: attackPower(input.troops, input.shipyardTier),
    defensePower: defensePower(input.turretLevels, input.population),
  }
}

function assertCasualtyRate(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be in [0,1], got ${value}`)
  }
}

function classify(ap: number, dp: number): BattleResult {
  if (ap > dp) {
    return 'victory'
  }
  if (ap === dp) {
    return 'stalemate'
  }
  return 'defeat'
}

function survivingTroopsFor(
  troops: number,
  result: BattleResult,
  casualtyRate: number,
): number {
  if (result === 'victory') {
    return Math.floor(troops * (1 - casualtyRate))
  }
  if (result === 'stalemate') {
    return Math.floor(troops * STALEMATE_SURVIVOR_RATE)
  }
  return 0
}

function defenderCasualtiesFor(population: number, result: BattleResult): number {
  if (result === 'victory') {
    return Math.floor(population * DEFENDER_CASUALTY_RATE_VICTORY)
  }
  if (result === 'defeat') {
    return Math.floor(population * DEFENDER_CASUALTY_RATE)
  }
  return 0
}

/**
 * Resolves a battle deterministically (DESIGN §5 / §5a). Powers via
 * `battlePowers` (both locked formulas, delegated). The home-immunity guard
 * runs first (assertConquestPermitted — throws Error on a protected home
 * world). Classification: victory when AP > DP, stalemate when AP == DP
 * (defenders hold — documented boundary), defeat when AP < DP. Surviving
 * troops: victory → floor(troops × (1 − casualtyRate)) (default
 * BATTLE_CASUALTY_RATE = 0.3), stalemate → floor(troops × 0.5) (withdrawal),
 * defeat → 0 (all committed troops lost). Defender casualties: victory →
 * floor(population × 0.1), defeat → floor(population × 0.2), stalemate → 0.
 * The battleId is `fnv1a(`${attackerId}|${targetId}|${resolvedAt}`)
 * .toString(16)`. The input is never mutated; a fresh outcome is returned.
 */
export function resolveBattle(input: ResolveBattleInput): BattleOutcome {
  assertNonEmptyString(input.attackerId, 'attackerId')
  assertNonEmptyString(input.targetId, 'targetId')
  assertPositiveAt(input.resolvedAt)
  assertConquestPermitted({
    targetId: input.targetId,
    ownerPlayer: input.targetOwner,
    attemptedAt: input.resolvedAt,
  })
  const casualtyRate = input.casualtyRate ?? BATTLE_CASUALTY_RATE
  assertCasualtyRate(casualtyRate, 'casualtyRate')

  const powers = battlePowers(input)
  const result = classify(powers.attackPower, powers.defensePower)

  return {
    battleId: fnv1a(
      `${input.attackerId}|${input.targetId}|${input.resolvedAt}`,
    ).toString(16),
    attackerId: input.attackerId,
    targetId: input.targetId,
    resolvedAt: input.resolvedAt,
    attackPower: powers.attackPower,
    defensePower: powers.defensePower,
    victory: result === 'victory',
    survivingTroops: survivingTroopsFor(input.troops, result, casualtyRate),
    defenderCasualties: defenderCasualtiesFor(input.population, result),
    result,
  }
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
 * Deterministic one-line battle report, e.g.
 * `Victory: 3,500 of 5,000 troops survived · defenders lost 4,000`. The
 * committed-troop count is not part of the locked BattleOutcome shape, so the
 * 'of N troops' clause takes the committed count as an OPTIONAL second
 * argument; omitted, the clause is dropped (`Victory: 3,500 troops survived ·
 * defenders lost 4,000`). Numbers are formatted with a plain thousands
 * separator (no environment-sensitive formatting — deterministic everywhere).
 */
export function battleReport(outcome: BattleOutcome, troops?: number): string {
  if (troops !== undefined && (!Number.isInteger(troops) || troops < 0)) {
    throw new RangeError(`troops must be a non-negative integer, got ${troops}`)
  }
  const word =
    outcome.result === 'victory'
      ? 'Victory'
      : outcome.result === 'defeat'
        ? 'Defeat'
        : 'Stalemate'
  const survived = formatInteger(outcome.survivingTroops)
  const troopClause =
    troops === undefined
      ? `${survived} troops survived`
      : `${survived} of ${formatInteger(troops)} troops survived`
  return `${word}: ${troopClause} · defenders lost ${formatInteger(outcome.defenderCasualties)}`
}
