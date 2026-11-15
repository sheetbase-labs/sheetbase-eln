import { describe, expect, it, vi } from 'vitest'

import {
  isDestructiveStep,
  isPersonalStep,
  proposePlanSchema,
  runPlan,
} from './plan'
import type { PlanStep, PlanStepResult, PlanStepState } from './plan'

function step(key: string, tool = 'sheetbase.sample.log'): PlanStep {
  return {
    key,
    title: key,
    tool,
    arguments: {},
    destructive: isDestructiveStep(tool),
  }
}

function harness(results: Record<string, PlanStepResult> = {}) {
  const order: string[] = []
  const states = new Map<number, PlanStepState>()

  return {
    order,
    states,
    execute: vi.fn((s: PlanStep): Promise<PlanStepResult> => {
      order.push(s.key)

      return Promise.resolve(results[s.key] ?? { ok: true })
    }),
    onUpdate: (index: number, state: PlanStepState) => {
      states.set(index, state)
    },
  }
}

describe('runPlan', () => {
  it('runs every step in order', async () => {
    const h = harness()
    const steps = [step('a'), step('b'), step('c')]

    const outcome = await runPlan({
      steps,
      from: 0,
      pauseDestructive: true,
      runAll: false,
      execute: h.execute,
      onUpdate: h.onUpdate,
    })

    expect(outcome).toEqual({ status: 'done' })
    expect(h.order).toEqual(['a', 'b', 'c'])
    expect([...h.states.values()].map((state) => state.phase)).toEqual([
      'done',
      'done',
      'done',
    ])
  })

  it('stops at a failure and leaves the rest not run', async () => {
    const h = harness({ b: { ok: false, message: 'No such box.' } })

    const outcome = await runPlan({
      steps: [step('a'), step('b'), step('c')],
      from: 0,
      pauseDestructive: true,
      runAll: false,
      execute: h.execute,
      onUpdate: h.onUpdate,
    })

    expect(outcome).toEqual({ status: 'failed', at: 1 })
    expect(h.order).toEqual(['a', 'b'])
    expect(h.states.get(0)?.phase).toBe('done')
    expect(h.states.get(1)).toEqual({
      phase: 'failed',
      message: 'No such box.',
    })
    expect(h.states.get(2)?.phase).toBe('skipped')
  })

  it('turns a thrown error into a failed step', async () => {
    const h = harness()

    h.execute.mockImplementationOnce(() => Promise.reject(new Error('boom')))

    const outcome = await runPlan({
      steps: [step('a'), step('b')],
      from: 0,
      pauseDestructive: true,
      runAll: false,
      execute: h.execute,
      onUpdate: h.onUpdate,
    })

    expect(outcome).toEqual({ status: 'failed', at: 0 })
    expect(h.states.get(0)).toEqual({ phase: 'failed', message: 'boom' })
  })

  it('pauses at a destructive step, then runs it once approved', async () => {
    const steps = [step('a'), step('b', 'sheetbase.sample.dispose'), step('c')]
    const h = harness()

    const first = await runPlan({
      steps,
      from: 0,
      pauseDestructive: true,
      runAll: false,
      execute: h.execute,
      onUpdate: h.onUpdate,
    })

    expect(first).toEqual({ status: 'paused', at: 1 })
    expect(h.order).toEqual(['a'])
    expect(h.states.get(1)?.phase).toBe('paused')

    const second = await runPlan({
      steps,
      from: 1,
      approved: 1,
      pauseDestructive: true,
      runAll: false,
      execute: h.execute,
      onUpdate: h.onUpdate,
    })

    expect(second).toEqual({ status: 'done' })
    expect(h.order).toEqual(['a', 'b', 'c'])
  })

  it('pauses again at a second destructive step', async () => {
    const steps = [
      step('a', 'sheetbase.sample.dispose'),
      step('b', 'sheetbase.shipment.cancel'),
    ]

    const h = harness()

    const outcome = await runPlan({
      steps,
      from: 0,
      approved: 0,
      pauseDestructive: true,
      runAll: false,
      execute: h.execute,
      onUpdate: h.onUpdate,
    })

    expect(outcome).toEqual({ status: 'paused', at: 1 })
    expect(h.order).toEqual(['a'])
  })

  it('runs straight through when the workspace does not pause', async () => {
    const h = harness()

    const outcome = await runPlan({
      steps: [step('a', 'sheetbase.sample.dispose'), step('b')],
      from: 0,
      pauseDestructive: false,
      runAll: false,
      execute: h.execute,
      onUpdate: h.onUpdate,
    })

    expect(outcome).toEqual({ status: 'done' })
  })

  it('Run all powers through every pausing step', async () => {
    const h = harness()

    const outcome = await runPlan({
      steps: [step('a', 'sheetbase.sample.dispose'), step('b')],
      from: 0,
      pauseDestructive: true,
      runAll: true,
      execute: h.execute,
      onUpdate: h.onUpdate,
    })

    expect(outcome).toEqual({ status: 'done' })
    expect(h.order).toEqual(['a', 'b'])
  })
})

describe('step kinds', () => {
  it('knows which steps remove or end something', () => {
    for (const tool of [
      'sheetbase.sample.dispose',
      'sheetbase.shipment.cancel',
      'sheetbase.instrument.retire',
      'sheetbase.sample.archive',
      'sheetbase.experiment.delete_draft',
      'sheetbase.retention.apply',
    ]) {
      expect(isDestructiveStep(tool)).toBe(true)
    }

    for (const tool of [
      'sheetbase.sample.log',
      'sheetbase.planner.plan_experiment',
      'sheetbase.plate.analyse',
      'sheetbase.booking.create',
    ]) {
      expect(isDestructiveStep(tool)).toBe(false)
    }
  })

  it('keeps a person’s own decisions out of plans', () => {
    expect(isPersonalStep('sheetbase.agent_request.decide')).toBe(true)
    expect(isPersonalStep('sheetbase.protocol.record_trained')).toBe(true)
    expect(isPersonalStep('sheetbase.sample.log')).toBe(false)
  })
})

describe('plan input', () => {
  const one = { title: 'Do it', tool: 'sheetbase.sample.log', arguments: {} }
  const base = { title: 'T', summary: 'S' }

  it('needs between two and twelve steps', () => {
    expect(proposePlanSchema.safeParse({ ...base, steps: [one] }).success).toBe(
      false,
    )

    expect(
      proposePlanSchema.safeParse({ ...base, steps: [one, one] }).success,
    ).toBe(true)

    expect(
      proposePlanSchema.safeParse({
        ...base,
        steps: Array.from({ length: 13 }, () => one),
      }).success,
    ).toBe(false)
  })
})
