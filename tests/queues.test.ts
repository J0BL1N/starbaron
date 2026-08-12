import { describe, expect, it } from 'vitest'
import { STRUCTURES, STRUCTURE_IDS } from '../src/sim/structures/data'
import { buildCost } from '../src/sim/structures/framework'
import { fnv1a } from '../src/sim/planets/hash'
import {
  cancelJob,
  completeDueJobs,
  jobsAt,
  queueConstruction,
  queueInvariants,
} from '../src/sim/structures/queues'
import type {
  ConstructionJob,
  ConstructionJobStatus,
  ConstructionQueue,
  QueueConstructionInput,
  QueueConstructionResult,
} from '../src/sim/structures/queues'
import type { WalletState } from '../src/sim/player/types'
import type { StructureGrid } from '../src/sim/player/types'
import type { StructureId } from '../src/sim/structures/types'

const PLANET = 'Gliese 667 Cc'
const AT = 1_700_000_000_000

const RICH: WalletState = { credits: 1e9, alloys: 1e9 }

function emptyGrid(): StructureGrid {
  return {
    oreMine: 0,
    tradeHub: 0,
    housing: 0,
    hydroponics: 0,
    barracks: 0,
    shipyard: 0,
    defenseTurret: 0,
  }
}

function gridWith(overrides: Partial<Record<StructureId, number>>): StructureGrid {
  return { ...emptyGrid(), ...overrides }
}

const PREREQ_GRID: Readonly<
  Record<StructureId, Partial<Record<StructureId, number>>>
> = {
  oreMine: {},
  tradeHub: {},
  housing: {},
  hydroponics: {},
  barracks: { housing: 1 },
  shipyard: { oreMine: 3 },
  defenseTurret: { housing: 1, barracks: 1 },
}

function gridFor(
  structure: StructureId,
  level: number,
  prereqs: Partial<Record<StructureId, number>> = {},
): StructureGrid {
  return gridWith({ ...prereqs, [structure]: level })
}

function wallet(credits: number, alloys: number): WalletState {
  return { credits, alloys }
}

function queueFromJobs(jobs: ConstructionJob[]): ConstructionQueue {
  return { planet: PLANET, jobs }
}

interface BuildOverrides
  extends Partial<Omit<QueueConstructionInput, 'structure' | 'fromLevel'>> {
  structure: StructureId
  fromLevel: number
}

function build(input: BuildOverrides): QueueConstructionResult {
  const { structure, fromLevel, ...rest } = input
  return queueConstruction({
    planet: PLANET,
    structure,
    fromLevel,
    toLevel: fromLevel + 1,
    startedAt: AT,
    wallet: RICH,
    existingJobs: [],
    grid: gridFor(structure, fromLevel),
    ...rest,
  })
}

describe('queueConstruction', () => {
  it('creates a building job with the reserved cost = buildCost(fromLevel)', () => {
    const { queue, job, cost } = build({ structure: 'oreMine', fromLevel: 0 })
    expect(queue.planet).toBe(PLANET)
    expect(queue.jobs).toEqual([job])
    expect(job).toMatchObject({
      structure: 'oreMine',
      fromLevel: 0,
      toLevel: 1,
      startedAt: AT,
      status: 'building',
    })
    expect(cost).toEqual({ credits: buildCost('oreMine', 0), alloys: 0 })
    expect(job.cost).toEqual(cost)
    expect(cost).not.toBe(job.cost)
  })

  it('reservation cost scales with fromLevel via buildCost', () => {
    const cases: Array<[StructureId, number]> = [
      ['housing', 1],
      ['oreMine', 2],
      ['shipyard', 3],
    ]
    for (const [structure, level] of cases) {
      const { cost } = build({
        structure,
        fromLevel: level,
        grid: gridFor(structure, level, PREREQ_GRID[structure]),
      })
      expect(cost.credits, `${structure}@${level}`).toBe(buildCost(structure, level))
      expect(cost.alloys).toBe(0)
    }
  })

  it('reserves the flat alloy cost for defenseTurret alongside credits', () => {
    const { cost } = build({
      structure: 'defenseTurret',
      fromLevel: 0,
      grid: gridFor('defenseTurret', 0, PREREQ_GRID.defenseTurret),
    })
    expect(cost).toEqual({
      credits: buildCost('defenseTurret', 0),
      alloys: STRUCTURES.defenseTurret.alloyCost ?? 0,
    })
    expect(cost.alloys).toBe(1_000)
  })

  it('finishesAt = startedAt + buildTimeSec * 1000 for every structure (positive durations)', () => {
    for (const id of STRUCTURE_IDS) {
      expect(STRUCTURES[id].buildTimeSec, `${id}.buildTimeSec`).toBeGreaterThan(0)
      const { job } = build({
        structure: id,
        fromLevel: 0,
        grid: gridFor(id, 0, PREREQ_GRID[id]),
      })
      expect(job.finishesAt, id).toBe(AT + STRUCTURES[id].buildTimeSec * 1000)
    }
  })

  it('is deterministic: identical input produces identical id, job and cost', () => {
    const a = build({ structure: 'tradeHub', fromLevel: 1 })
    const b = build({ structure: 'tradeHub', fromLevel: 1 })
    expect(a.job.id).toBe(b.job.id)
    expect(a.job).toEqual(b.job)
    expect(a.queue).toEqual(b.queue)
    expect(a.cost).toEqual(b.cost)
  })

  it('ids differ when planet, structure, toLevel, startedAt or position change', () => {
    const base = build({ structure: 'oreMine', fromLevel: 0 })
    const otherPlanet = build({ structure: 'oreMine', fromLevel: 0, planet: 'Kepler-186f' })
    const otherStructure = build({ structure: 'housing', fromLevel: 0 })
    const otherStartedAt = build({ structure: 'oreMine', fromLevel: 0, startedAt: AT + 1000 })
    const higherLevel = build({ structure: 'oreMine', fromLevel: 1 })
    const appended = build({ structure: 'oreMine', fromLevel: 0, existingJobs: [base.job] })
    const ids = [
      base.job.id,
      otherPlanet.job.id,
      otherStructure.job.id,
      otherStartedAt.job.id,
      higherLevel.job.id,
      appended.queue.jobs[1].id,
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('id equals the fnv1a hex of planet|structure|toLevel|startedAt|position', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    expect(job.id).toBe(fnv1a(`${PLANET}|oreMine|1|${AT}|0`).toString(16))
    const appended = build({ structure: 'oreMine', fromLevel: 0, existingJobs: [job] })
    expect(appended.queue.jobs[1].id).toBe(
      fnv1a(`${PLANET}|oreMine|1|${AT}|1`).toString(16),
    )
  })

  it('preserves existing jobs and appends the new one at the end', () => {
    const first = build({ structure: 'oreMine', fromLevel: 0 })
    const second = build({ structure: 'tradeHub', fromLevel: 0, existingJobs: first.queue.jobs })
    const third = build({ structure: 'housing', fromLevel: 0, existingJobs: second.queue.jobs })
    expect(third.queue.jobs).toHaveLength(3)
    expect(third.queue.jobs[0].id).toBe(first.job.id)
    expect(third.queue.jobs[1].id).toBe(second.job.id)
    expect(third.queue.jobs[2].structure).toBe('housing')
    expect(third.queue.jobs[0]).toBe(first.job)
  })

  it('throws when toLevel is not fromLevel + 1', () => {
    expect(() => build({ structure: 'oreMine', fromLevel: 0, toLevel: 2 })).toThrow(
      /single-level/,
    )
    expect(() => build({ structure: 'oreMine', fromLevel: 1, toLevel: 1 })).toThrow(
      /single-level/,
    )
    expect(() => build({ structure: 'oreMine', fromLevel: 0, toLevel: -1 })).toThrow(
      /single-level/,
    )
  })

  it('throws for negative or fractional levels even when the step/grid are consistent', () => {
    expect(() =>
      build({ structure: 'oreMine', fromLevel: -1, toLevel: 0, grid: gridWith({ oreMine: -1 }) }),
    ).toThrow(/fromLevel/)
    expect(() =>
      build({
        structure: 'oreMine',
        fromLevel: 0.5,
        toLevel: 1.5,
        grid: gridWith({ oreMine: 0.5 }),
      }),
    ).toThrow(/fromLevel/)
    expect(() =>
      build({ structure: 'oreMine', fromLevel: 0, grid: gridWith({ oreMine: -1 }) }),
    ).toThrow(/grid/)
  })

  it('throws a descriptive error when credits are insufficient', () => {
    const cost = buildCost('oreMine', 0)
    expect(() =>
      build({ structure: 'oreMine', fromLevel: 0, wallet: wallet(cost - 1, 0) }),
    ).toThrow(new RegExp(`need ${cost} cr, have ${cost - 1} cr`))
  })

  it('throws a descriptive error when alloys are insufficient', () => {
    const cost = STRUCTURES.defenseTurret.alloyCost ?? 0
    expect(() =>
      build({
        structure: 'defenseTurret',
        fromLevel: 0,
        grid: gridFor('defenseTurret', 0, PREREQ_GRID.defenseTurret),
        wallet: wallet(1e9, cost - 1),
      }),
    ).toThrow(new RegExp(`need ${cost} alloys, have ${cost - 1} alloys`))
  })

  it('queues formerly prereq-gated structures with funds only (no prerequisite rung)', () => {
    const shipyard = build({
      structure: 'shipyard',
      fromLevel: 0,
      grid: gridFor('shipyard', 0),
    })
    expect(shipyard.queue.jobs).toHaveLength(1)
    expect(shipyard.job.structure).toBe('shipyard')
    const turret = build({
      structure: 'defenseTurret',
      fromLevel: 0,
      grid: gridFor('defenseTurret', 0),
    })
    expect(turret.queue.jobs).toHaveLength(1)
    expect(turret.job.structure).toBe('defenseTurret')
    expect(turret.job.cost.alloys).toBe(1_000)
  })

  it('throws for a non-finite or non-positive startedAt', () => {
    for (const bad of [0, -100, NaN, Infinity, -Infinity]) {
      expect(() => build({ structure: 'oreMine', fromLevel: 0, startedAt: bad })).toThrow(
        RangeError,
      )
    }
  })

  it('rejects a startedAt whose finishesAt would overflow (not strictly greater)', () => {
    for (const huge of [Number.MAX_VALUE, Number.MAX_VALUE / 2]) {
      expect(() => build({ structure: 'oreMine', fromLevel: 0, startedAt: huge })).toThrow(
        /finishesAt/,
      )
    }
    const large = build({
      structure: 'oreMine',
      fromLevel: 0,
      startedAt: Number.MAX_SAFE_INTEGER,
    })
    expect(large.job.finishesAt).toBe(
      Number.MAX_SAFE_INTEGER + STRUCTURES.oreMine.buildTimeSec * 1000,
    )
    expect(large.job.finishesAt).toBeGreaterThan(large.job.startedAt)
  })

  it('throws for an unknown structure', () => {
    expect(() =>
      queueConstruction({
        planet: PLANET,
        structure: 'nukePlant' as StructureId,
        fromLevel: 0,
        toLevel: 1,
        startedAt: AT,
        wallet: RICH,
        existingJobs: [],
        grid: emptyGrid(),
      }),
    ).toThrow(RangeError)
  })

  it('throws when the grid level does not match fromLevel (reservation consistency)', () => {
    expect(() =>
      build({ structure: 'oreMine', fromLevel: 1, grid: gridWith({ oreMine: 0 }) }),
    ).toThrow(/grid level/)
    expect(() =>
      build({ structure: 'oreMine', fromLevel: 0, grid: gridWith({ oreMine: 3 }) }),
    ).toThrow(/grid level/)
  })

  it('never mutates the wallet, existingJobs, or grid', () => {
    const walletState = wallet(10_000, 500)
    const grid = gridFor('oreMine', 0)
    const existing = [build({ structure: 'housing', fromLevel: 0 }).job]
    const beforeWallet = { ...walletState }
    const beforeGrid = { ...grid }
    const beforeExisting = existing.map((j) => ({ ...j }))
    build({
      structure: 'oreMine',
      fromLevel: 0,
      wallet: walletState,
      grid,
      existingJobs: existing,
    })
    expect(walletState).toEqual(beforeWallet)
    expect(grid).toEqual(beforeGrid)
    expect(existing).toEqual(beforeExisting)
  })

  it('accepts jobs at arbitrarily high levels (levels are UNLIMITED — no max cap)', () => {
    const highLevel = 1_000
    const richWallet = wallet(1e64, 1e9)
    const { job, cost } = queueConstruction({
      planet: PLANET,
      structure: 'housing',
      fromLevel: highLevel,
      toLevel: highLevel + 1,
      startedAt: AT,
      wallet: richWallet,
      existingJobs: [],
      grid: gridWith({ housing: highLevel }),
    })
    expect(job.fromLevel).toBe(highLevel)
    expect(job.toLevel).toBe(highLevel + 1)
    expect(cost.credits).toBe(buildCost('housing', highLevel))
    expect(queueInvariants({ planet: PLANET, jobs: [job] }).ok).toBe(true)
  })

  it('is deterministic at a high level and completes due high-level jobs', () => {
    const highLevel = 500
    const richWallet = wallet(1e64, 1e9)
    const a = queueConstruction({
      planet: PLANET,
      structure: 'housing',
      fromLevel: highLevel,
      toLevel: highLevel + 1,
      startedAt: AT,
      wallet: richWallet,
      existingJobs: [],
      grid: gridWith({ housing: highLevel }),
    })
    const b = queueConstruction({
      planet: PLANET,
      structure: 'housing',
      fromLevel: highLevel,
      toLevel: highLevel + 1,
      startedAt: AT,
      wallet: richWallet,
      existingJobs: [],
      grid: gridWith({ housing: highLevel }),
    })
    expect(a).toEqual(b)
    const done = completeDueJobs(a.queue, AT + 30_000)
    expect(done.completed).toHaveLength(1)
    expect(done.completed[0].toLevel).toBe(highLevel + 1)
    expect(queueInvariants(done.queue).ok).toBe(true)
  })

  it('rejects toLevel below fromLevel and non-adjacent steps', () => {
    expect(() =>
      build({ structure: 'oreMine', fromLevel: 1, toLevel: 0 }),
    ).toThrow(/single-level/)
    expect(() =>
      build({ structure: 'oreMine', fromLevel: 1, toLevel: 3 }),
    ).toThrow(/single-level/)
  })

  it('completeDueJobs is a no-op on an empty queue', () => {
    const result = completeDueJobs(queueFromJobs([]), AT + 1_000_000)
    expect(result.completed).toEqual([])
    expect(result.queue.jobs).toEqual([])
    expect(result.queue.planet).toBe(PLANET)
  })
})

describe('jobsAt', () => {
  it('returns due and still-building jobs, ordered by startedAt then id', () => {
    const a = build({ structure: 'oreMine', fromLevel: 0, startedAt: AT })
    const b = build({ structure: 'housing', fromLevel: 0, startedAt: AT + 100 })
    const c = build({ structure: 'tradeHub', fromLevel: 0, startedAt: AT + 200 })
    const due = jobsAt(queueFromJobs([a.job, c.job, b.job]), AT + 30_000)
    expect(due.map((j) => j.id)).toEqual([a.job.id, b.job.id, c.job.id])
  })

  it('excludes complete and cancelled jobs', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    const completed = completeDueJobs(queueFromJobs([job]), AT + 100_000)
    const cancelled = cancelJob(queueFromJobs([job]), job.id, AT)
    expect(jobsAt(completed.queue, AT + 100_000)).toEqual([])
    expect(jobsAt(cancelled.queue, AT + 100_000)).toEqual([])
  })

  it('still lists a job that is exactly due (inclusive finishesAt boundary)', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    const queue = queueFromJobs([job])
    expect(jobsAt(queue, job.finishesAt - 1).map((j) => j.id)).toEqual([job.id])
    expect(jobsAt(queue, job.finishesAt).map((j) => j.id)).toEqual([job.id])
  })

  it('returns [] for an empty queue', () => {
    expect(jobsAt(queueFromJobs([]), AT)).toEqual([])
  })
})

describe('completeDueJobs', () => {
  it('completes due jobs and returns exactly those as newly completed', () => {
    const a = build({ structure: 'oreMine', fromLevel: 0, startedAt: AT })
    const b = build({ structure: 'tradeHub', fromLevel: 0, startedAt: AT })
    const { queue, completed } = completeDueJobs(queueFromJobs([a.job, b.job]), AT + 120_000)
    expect(completed.map((j) => j.id).sort()).toEqual([a.job.id, b.job.id].sort())
    expect(queue.jobs.map((j) => j.status)).toEqual(['complete', 'complete'])
  })

  it('leaves still-building jobs untouched', () => {
    const a = build({ structure: 'oreMine', fromLevel: 0, startedAt: AT })
    const b = build({
      structure: 'shipyard',
      fromLevel: 0,
      startedAt: AT,
      grid: gridFor('shipyard', 0, PREREQ_GRID.shipyard),
    })
    const { queue, completed } = completeDueJobs(queueFromJobs([a.job, b.job]), AT + 60_000)
    expect(completed.map((j) => j.id)).toEqual([a.job.id])
    expect(queue.jobs.map((j) => j.status)).toEqual(['complete', 'building'])
  })

  it('is idempotent: a second run completes nothing new', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    const first = completeDueJobs(queueFromJobs([job]), AT + 100_000)
    expect(first.completed).toHaveLength(1)
    const second = completeDueJobs(first.queue, AT + 200_000)
    expect(second.completed).toEqual([])
    expect(second.queue.jobs).toEqual(first.queue.jobs)
    expect(second.queue.jobs[0].status).toBe('complete')
  })

  it('leaves cancelled jobs untouched', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    const cancelled = cancelJob(queueFromJobs([job]), job.id, AT)
    const { queue, completed } = completeDueJobs(cancelled.queue, AT + 100_000)
    expect(completed).toEqual([])
    expect(queue.jobs[0].status).toBe('cancelled')
  })

  it('does not mutate the input queue', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    const queue = queueFromJobs([job])
    const before = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) }
    const result = completeDueJobs(queue, AT + 100_000)
    expect(queue).toEqual(before)
    expect(queue.jobs[0].status).toBe('building')
    expect(result.completed[0]).not.toBe(job)
    expect(result.queue.jobs[0].status).toBe('complete')
  })

  it('completes the right slice as time advances across many jobs (parallel builds)', () => {
    let current: ConstructionQueue = queueFromJobs([])
    for (let i = 0; i < 5; i++) {
      const result = queueConstruction({
        planet: PLANET,
        structure: 'oreMine',
        fromLevel: 0,
        toLevel: 1,
        startedAt: AT + i * 40_000,
        wallet: RICH,
        existingJobs: current.jobs,
        grid: gridWith({ oreMine: 0 }),
      })
      current = result.queue
    }
    expect(current.jobs).toHaveLength(5)
    const slice = completeDueJobs(current, AT + 130_000)
    expect(slice.completed).toHaveLength(3)
    const finished = completeDueJobs(slice.queue, AT + 500_000)
    expect(finished.completed).toHaveLength(2)
    expect(finished.queue.jobs.every((j) => j.status === 'complete')).toBe(true)
  })
})

describe('cancelJob', () => {
  it('refunds the full reserved cost, marks cancelled, and hides it from jobsAt', () => {
    const built = build({
      structure: 'defenseTurret',
      fromLevel: 0,
      grid: gridFor('defenseTurret', 0, PREREQ_GRID.defenseTurret),
    })
    const { queue, refund } = cancelJob(queueFromJobs([built.job]), built.job.id, AT)
    expect(refund).toEqual(built.cost)
    expect(queue.jobs[0].status).toBe('cancelled')
    expect(jobsAt(queue, AT + 1_000_000)).toEqual([])
  })

  it('throws for an unknown job id', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    expect(() => cancelJob(queueFromJobs([job]), 'nope', AT)).toThrow(/unknown job id/)
  })

  it('throws when cancelling a completed job (cancel-after-complete)', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    const done = completeDueJobs(queueFromJobs([job]), AT + 100_000)
    expect(() => cancelJob(done.queue, job.id, AT)).toThrow(/cannot cancel completed/)
  })

  it('throws when cancelling an already-cancelled job', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    const cancelled = cancelJob(queueFromJobs([job]), job.id, AT)
    expect(() => cancelJob(cancelled.queue, job.id, AT + 1000)).toThrow(/already cancelled/)
  })

  it('validates the cancellation time and never mutates the input queue', () => {
    const { job } = build({ structure: 'oreMine', fromLevel: 0 })
    const queue = queueFromJobs([job])
    expect(() => cancelJob(queue, job.id, 0)).toThrow(RangeError)
    expect(() => cancelJob(queue, job.id, NaN)).toThrow(RangeError)
    const before = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) }
    const result = cancelJob(queue, job.id, AT)
    expect(queue).toEqual(before)
    expect(queue.jobs[0].status).toBe('building')
    expect(result.queue.jobs[0].status).toBe('cancelled')
  })
})

describe('queueInvariants', () => {
  it('reports ok for a healthy queue', () => {
    const a = build({ structure: 'oreMine', fromLevel: 0 })
    const b = build({ structure: 'tradeHub', fromLevel: 0, existingJobs: [a.job] })
    const result = queueInvariants(b.queue)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('catches tampering: duplicates, bad status, bad times, bad levels, negative cost', () => {
    const base = build({ structure: 'oreMine', fromLevel: 0 })
    const join = (problems: string[]): string => problems.join('\n')

    const dup = queueInvariants(queueFromJobs([base.job, { ...base.job }]))
    expect(dup.ok).toBe(false)
    expect(join(dup.problems)).toMatch(/duplicate job id/)

    const badStatus = queueInvariants(
      queueFromJobs([{ ...base.job, status: 'paused' as ConstructionJobStatus }]),
    )
    expect(join(badStatus.problems)).toMatch(/invalid status/)

    const badTime = queueInvariants(
      queueFromJobs([{ ...base.job, finishesAt: base.job.startedAt }]),
    )
    expect(join(badTime.problems)).toMatch(/finishesAt/)

    const badStep = queueInvariants(queueFromJobs([{ ...base.job, toLevel: 5 }]))
    expect(join(badStep.problems)).toMatch(/single-level/)

    const negative = queueInvariants(
      queueFromJobs([{ ...base.job, cost: { credits: -1, alloys: 0 } }]),
    )
    expect(join(negative.problems)).toMatch(/cost.credits/)

    const unknown = queueInvariants(
      queueFromJobs([{ ...base.job, structure: 'nukePlan' as StructureId }]),
    )
    expect(join(unknown.problems)).toMatch(/unknown structure/)

    const combined = queueInvariants(
      queueFromJobs([
        { ...base.job, id: 'x' },
        {
          ...base.job,
          id: 'x',
          status: 'paused' as ConstructionJobStatus,
          finishesAt: 1,
          toLevel: 9,
          structure: 'nukePlan' as StructureId,
          cost: { credits: -5, alloys: -2 },
        },
      ]),
    )
    expect(combined.ok).toBe(false)
    expect(combined.problems.length).toBeGreaterThanOrEqual(5)
  })

  it('keeps every job level a finite non-negative integer with toLevel === fromLevel + 1', () => {
    const base = build({ structure: 'oreMine', fromLevel: 0 })
    const fractional = queueInvariants(
      queueFromJobs([{ ...base.job, fromLevel: 1.5, toLevel: 2.5 }]),
    )
    expect(fractional.ok).toBe(false)
    expect(fractional.problems.join('\n')).toMatch(/fromLevel/)
    const negative = queueInvariants(
      queueFromJobs([{ ...base.job, fromLevel: -1, toLevel: 0 }]),
    )
    expect(negative.ok).toBe(false)
    expect(negative.problems.join('\n')).toMatch(/fromLevel/)
    const nonFinite = queueInvariants(
      queueFromJobs([{ ...base.job, fromLevel: Number.NaN, toLevel: Number.NaN }]),
    )
    expect(nonFinite.ok).toBe(false)
    expect(nonFinite.problems.join('\n')).toMatch(/fromLevel/)
    const step = queueInvariants(
      queueFromJobs([{ ...base.job, toLevel: 5 }]),
    )
    expect(step.problems.join('\n')).toMatch(/single-level/)
    const healthyHigh = build({
      structure: 'housing',
      fromLevel: 999,
      grid: gridWith({ housing: 999 }),
      wallet: wallet(1e64, 1e9),
    })
    expect(queueInvariants(queueFromJobs([healthyHigh.job])).ok).toBe(true)
  })

  it('rejects a non-finite toLevel alongside a healthy job', () => {
    const base = build({ structure: 'oreMine', fromLevel: 0 })
    const bad = queueInvariants(
      queueFromJobs([{ ...base.job, toLevel: Number.NaN }]),
    )
    expect(bad.ok).toBe(false)
    expect(bad.problems.join('\n')).toMatch(/toLevel/)
  })
})
