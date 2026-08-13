/**
 * POPULATION CASUALTIES (P7-T05) — the casualty application over the battle
 * outcome: the committed attackers lost appropriately (the invasion force is
 * spent whether it wins or loses — DESIGN), the defender losses per the
 * outcome (T03's defenderCasualties), and the casualty ledger on BOTH sides
 * plus the attacker population impact (recruitment drew from population;
 * committed troops are lost; surviving troops return). This is the PURE
 * APPLICATION half over the resolution output — nothing here recomputes a
 * battle; the T03 outcome is the single source.
 *
 * DESIGN.md §5 pins the semantics: "launch invasion of 5,000 troops — those
 * 5,000 are gone whether you win or lose"; §5a's casualty table gives
 * casualties on both sides ("wars leave scars on both sides"). This module
 * maps the T03 BattleOutcome onto a CasualtyLedger with the population and
 * garrison impact for each side.
 *
 * PURE module — deterministic, no time-source reads (`resolvedAt` is an
 * INPUT on the outcome), no nondeterministic APIs, no module-level mutable
 * state (lookup tables are deep-frozen), strictly typed.
 *
 * DESIGN decisions (documented — pinned):
 * - **Attacker survivors (DELEGATED):** `survivors` = outcome.survivingTroops
 *   EXACTLY — the T03 resolver is the single source; never re-derived here.
 * - **Attacker population loss:** `populationLoss = committedTroops −
 *   survivors`. DESIGN's "the 5,000 are gone whether you win or lose" means
 *   the committed force is SPENT (never refunded as a spare reserve), NOT
 *   that every body is dead. Only the dead are a population loss; the
 *   survivors RETURN and are recovered by the attacker population (see
 *   attackerPopulationImpact). Victory worked example: 5,000 committed,
 *   3,500 survivors → 1,500 lost, 3,500 return.
 * - **Fleet:** `fleetLost = (result === 'defeat')` — a repelled landing
 *   force loses its escort fleet too (DESIGN: "or lose the fleet too"); a
 *   victory and a stalemate both keep the fleet (victory: the conquest is
 *   held, the fleet is intact — documented choice; stalemate: the attackers
 *   withdraw and the fleet retreats intact).
 * - **Defender population loss (DELEGATED):** `defender.populationLoss =
 *   outcome.defenderCasualties` EXACTLY from T03. The defender population
 *   never goes negative — if defenderCasualties exceeds
 *   defenderPopulationBefore this throws RangeError (validated, never
 *   clamped).
 * - **Defender garrison losses (PINNED mapping):**
 *   - 'victory' (the attacker wins, the planet falls) → the garrison is
 *     destroyed in the fall — DESIGN §5: "everything survives EXCEPT
 *     defenses"; the garrison is wiped with the fall → garrisonLoss =
 *     defenderGarrisonBefore (ALL).
 *   - 'defeat' (the attacker is repelled, the defender holds) → the garrison
 *     survives mostly; garrisonLoss = floor(defenderGarrisonBefore ×
 *     DEFENDER_GARRISON_LOSS_RATE = 0.2) — defense losses repelling the
 *     assault (draft knob, exported).
 *   - 'stalemate' → garrisonLoss = 0 — the assault withdraws without
 *     breaking the line; the garrison holds intact.
 * - **Ledger identity:** attackerId / targetId / battleId / resolvedAt are
 *   copied from the outcome (battleId and resolvedAt come from T03's
 *   deterministic resolver).
 * - **Report:** `casualtyReport` is a deterministic one-line string with a
 *   plain thousands separator (no environment-sensitive formatting).
 *
 * Validation (each throws RangeError): the outcome shape (battleId /
 * attackerId / targetId non-empty via validate.ts, resolvedAt positive finite
 * via validate.ts, result in the frozen union, survivingTroops and
 * defenderCasualties non-negative integers), committedTroops a positive
 * integer, defenderPopulationBefore / defenderGarrisonBefore finite
 * non-negative, survivors ≤ committedTroops (a returning force cannot exceed
 * the committed force), and defenderCasualties ≤ defenderPopulationBefore
 * (defender population never negative).
 */

import { assertNonEmptyString, assertPositiveAt } from '../ui/validate'
import type { BattleOutcome, BattleResult } from './resolution'

/**
 * The CasualtyResult union (victory / defeat / stalemate) as a deep-frozen
 * lookup table (module-level lookup tables are runtime-immutable — treat as
 * read-only).
 */
export const CASUALTY_RESULTS: readonly BattleResult[] = Object.freeze([
  'victory',
  'defeat',
  'stalemate',
])

/**
 * DEFENDER_GARRISON_LOSS_RATE = 0.2 — the defender garrison lost on a
 * REPELLED (defeat) assault: floor(garrisonBefore × 0.2). The garrison
 * survives mostly when the planet is held; a repelled assault still bleeds
 * the defense. Draft balance input, exported as the knob. (Victory wipes the
 * garrison entirely — the planet falls; stalemate loses none.)
 */
export const DEFENDER_GARRISON_LOSS_RATE = 0.2

/** The attacker side of the casualty ledger. */
export interface AttackerCasualties {
  troopsCommitted: number
  survivors: number
  populationLoss: number
  fleetLost: boolean
}

/** The defender side of the casualty ledger. */
export interface DefenderCasualties {
  populationLoss: number
  garrisonLoss: number
}

/** The full casualty ledger for one resolved battle. */
export interface CasualtyLedger {
  attackerId: string
  targetId: string
  battleId: string
  resolvedAt: number
  attacker: AttackerCasualties
  defender: DefenderCasualties
  result: BattleResult
}

export interface ApplyCasualtiesInput {
  outcome: BattleOutcome
  committedTroops: number
  defenderPopulationBefore: number
  defenderGarrisonBefore: number
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer, got ${value}`)
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer, got ${value}`)
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} must be a finite non-negative number, got ${value}`,
    )
  }
}

function assertOutcomeShape(outcome: BattleOutcome): void {
  assertNonEmptyString(outcome.battleId, 'outcome.battleId')
  assertNonEmptyString(outcome.attackerId, 'outcome.attackerId')
  assertNonEmptyString(outcome.targetId, 'outcome.targetId')
  assertPositiveAt(outcome.resolvedAt)
  if (!(CASUALTY_RESULTS as readonly string[]).includes(outcome.result)) {
    throw new RangeError(
      `outcome.result must be 'victory'|'defeat'|'stalemate', got ${String(
        outcome.result,
      )}`,
    )
  }
  assertNonNegativeInteger(outcome.survivingTroops, 'outcome.survivingTroops')
  assertNonNegativeInteger(
    outcome.defenderCasualties,
    'outcome.defenderCasualties',
  )
}

/**
 * Applies the casualties of a resolved battle (P7-T05) over the T03 outcome.
 * Attacker survivors and defender population loss DELEGATE to the outcome
 * EXACTLY — never recomputed. Attacker populationLoss = committedTroops −
 * survivors (the committed troops are spent whether the invasion wins or
 * loses; the survivors return). fleetLost = defeat (a repelled force loses
 * its escort fleet). Defender garrisonLoss follows the PINNED mapping:
 * victory → the full garrison is destroyed in the fall (garrisonLoss =
 * defenderGarrisonBefore); defeat → floor(garrisonBefore × 0.2); stalemate →
 * 0. Validation order (each throws RangeError): outcome shape → committedTroops
 * positive integer → defenderPopulationBefore / defenderGarrisonBefore finite
 * non-negative → survivors ≤ committedTroops → defenderCasualties ≤
 * defenderPopulationBefore. The input is never mutated; a fresh ledger is
 * returned.
 */
export function applyCasualties(input: ApplyCasualtiesInput): CasualtyLedger {
  assertOutcomeShape(input.outcome)
  assertPositiveInteger(input.committedTroops, 'committedTroops')
  assertFiniteNonNegative(
    input.defenderPopulationBefore,
    'defenderPopulationBefore',
  )
  assertFiniteNonNegative(
    input.defenderGarrisonBefore,
    'defenderGarrisonBefore',
  )

  if (input.outcome.survivingTroops > input.committedTroops) {
    throw new RangeError(
      `survivors ${input.outcome.survivingTroops} exceed committed troops ` +
        `${input.committedTroops} (the returning force cannot exceed the ` +
        'committed force)',
    )
  }
  if (input.outcome.defenderCasualties > input.defenderPopulationBefore) {
    throw new RangeError(
      `defender casualties ${input.outcome.defenderCasualties} exceed the ` +
        `defender population before ${input.defenderPopulationBefore} ` +
        '(defender population would go negative)',
    )
  }

  const result = input.outcome.result
  const survivors = input.outcome.survivingTroops
  const populationLoss = input.committedTroops - survivors

  let garrisonLoss: number
  if (result === 'victory') {
    garrisonLoss = input.defenderGarrisonBefore
  } else if (result === 'defeat') {
    garrisonLoss = Math.floor(
      input.defenderGarrisonBefore * DEFENDER_GARRISON_LOSS_RATE,
    )
  } else {
    garrisonLoss = 0
  }

  return {
    attackerId: input.outcome.attackerId,
    targetId: input.outcome.targetId,
    battleId: input.outcome.battleId,
    resolvedAt: input.outcome.resolvedAt,
    attacker: {
      troopsCommitted: input.committedTroops,
      survivors,
      populationLoss,
      fleetLost: result === 'defeat',
    },
    defender: {
      populationLoss: input.outcome.defenderCasualties,
      garrisonLoss,
    },
    result,
  }
}

/**
 * Structural invariants of a CasualtyLedger: attackerId / targetId / battleId
 * non-empty strings; resolvedAt positive finite; result in the frozen union;
 * attacker.troopsCommitted a positive integer; attacker.survivors a
 * non-negative integer no larger than troopsCommitted; attacker.populationLoss
 * the exact difference troopsCommitted − survivors; attacker.fleetLost a
 * boolean; defender.populationLoss and defender.garrisonLoss non-negative
 * integers.
 */
export function casualtyLedgerInvariants(ledger: CasualtyLedger): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []

  for (const field of ['attackerId', 'targetId', 'battleId'] as const) {
    if (typeof ledger[field] !== 'string' || ledger[field].trim().length === 0) {
      problems.push(`${field} must be a non-empty string, got ${String(ledger[field])}`)
    }
  }

  if (!Number.isFinite(ledger.resolvedAt) || ledger.resolvedAt <= 0) {
    problems.push(
      `resolvedAt must be a finite number > 0, got ${ledger.resolvedAt}`,
    )
  }

  if (!(CASUALTY_RESULTS as readonly string[]).includes(ledger.result)) {
    problems.push(
      `result must be 'victory'|'defeat'|'stalemate', got ${String(ledger.result)}`,
    )
  }

  if (!Number.isInteger(ledger.attacker.troopsCommitted) || ledger.attacker.troopsCommitted <= 0) {
    problems.push(
      `attacker.troopsCommitted must be a positive integer, got ${ledger.attacker.troopsCommitted}`,
    )
  }

  if (!Number.isInteger(ledger.attacker.survivors) || ledger.attacker.survivors < 0) {
    problems.push(
      `attacker.survivors must be a non-negative integer, got ${ledger.attacker.survivors}`,
    )
  }

  if (ledger.attacker.survivors > ledger.attacker.troopsCommitted) {
    problems.push(
      `attacker.survivors ${ledger.attacker.survivors} exceed troopsCommitted ` +
        `${ledger.attacker.troopsCommitted}`,
    )
  }

  if (ledger.attacker.populationLoss !==
    ledger.attacker.troopsCommitted - ledger.attacker.survivors) {
    problems.push(
      `attacker.populationLoss must equal troopsCommitted − survivors ` +
        `(${ledger.attacker.troopsCommitted} − ${ledger.attacker.survivors}), ` +
        `got ${ledger.attacker.populationLoss}`,
    )
  }

  if (typeof ledger.attacker.fleetLost !== 'boolean') {
    problems.push(
      `attacker.fleetLost must be a boolean, got ${String(ledger.attacker.fleetLost)}`,
    )
  }

  if (
    !Number.isInteger(ledger.defender.populationLoss) ||
    ledger.defender.populationLoss < 0
  ) {
    problems.push(
      `defender.populationLoss must be a non-negative integer, got ${ledger.defender.populationLoss}`,
    )
  }

  if (
    !Number.isInteger(ledger.defender.garrisonLoss) ||
    ledger.defender.garrisonLoss < 0
  ) {
    problems.push(
      `defender.garrisonLoss must be a non-negative integer, got ${ledger.defender.garrisonLoss}`,
    )
  }

  return { ok: problems.length === 0, problems }
}

function assertLedgerShape(ledger: CasualtyLedger): void {
  const { ok, problems } = casualtyLedgerInvariants(ledger)
  if (!ok) {
    throw new RangeError(`malformed casualty ledger: ${problems[0]}`)
  }
}

/**
 * The attacker population impact of a resolved battle: totalPopulationLost =
 * attacker.populationLoss (the dead — the recruited population that is
 * GONE); survivorsReturned = attacker.survivors (they survived the battle and
 * go home, recovering the attacker population — the RETURNING troops are the
 * inverse of the population loss). Delegated entirely from the ledger; the
 * ledger must satisfy its invariants (RangeError otherwise).
 */
export function attackerPopulationImpact(ledger: CasualtyLedger): {
  totalPopulationLost: number
  survivorsReturned: number
} {
  assertLedgerShape(ledger)
  return {
    totalPopulationLost: ledger.attacker.populationLoss,
    survivorsReturned: ledger.attacker.survivors,
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
 * Deterministic one-line casualty report, e.g.
 * `2,000 troops lost · 3,000 returned home · defenders lost 850` — the
 * attacker population loss, the returning survivors, and the defender
 * population loss. Numbers use a plain thousands separator (no
 * environment-sensitive formatting — deterministic everywhere). The ledger
 * must satisfy its invariants (RangeError otherwise).
 */
export function casualtyReport(ledger: CasualtyLedger): string {
  assertLedgerShape(ledger)
  return (
    `${formatInteger(ledger.attacker.populationLoss)} troops lost · ` +
    `${formatInteger(ledger.attacker.survivors)} returned home · ` +
    `defenders lost ${formatInteger(ledger.defender.populationLoss)}`
  )
}
