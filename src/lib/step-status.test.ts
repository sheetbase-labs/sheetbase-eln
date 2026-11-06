import { describe, expect, it } from 'vitest'

import { currentStep, instrumentNamedBy, stepProgress } from './step-status'

const step = (id: string, payload: Record<string, unknown>) => ({
  id,
  type: 'procedure_step',
  payload: { text: `Step ${id}`, ...payload },
})

describe('stepProgress', () => {
  it('takes status from the evidence and makes the first open step current', () => {
    const steps = stepProgress(
      [
        step('a', { completed: true, completedAt: '2026-11-06T09:00:00Z' }),
        step('b', { completed: false, note: 'plate 4 started' }),
        step('c', { completed: false }),
        step('d', { completed: false }),
        {
          id: 'r1',
          type: 'metric',
          payload: { label: 'OD', value: 1, stepBlockId: 'c' },
        },
      ],
      new Set(['d']),
    )
    expect(steps.map((s) => s.status)).toEqual([
      'done',
      'in_progress',
      'in_progress',
      'in_progress',
    ])
    expect(steps.map((s) => s.current)).toEqual([false, true, false, false])
    expect(steps[2].results).toBe(1)
    expect(currentStep(steps)?.blockId).toBe('b')
  })

  it('has no current step once every step is done, and ignores blank steps', () => {
    const steps = stepProgress([
      step('a', { completed: true }),
      { id: 'x', type: 'procedure_step', payload: { text: '  ' } },
      { id: 'y', type: 'rich_text', payload: {} },
    ])
    expect(steps).toHaveLength(1)
    expect(currentStep(steps)).toBeNull()
  })

  it('keeps a not-started step not started', () => {
    expect(stepProgress([step('a', { note: '  ' })])[0].status).toBe(
      'not_started',
    )
  })
})

describe('instrumentNamedBy', () => {
  const list = [
    { id: '1', name: 'Plate reader', displayId: 'INS-0002' },
    { id: '2', name: 'pH', displayId: null },
  ]
  it('finds the one instrument a step names', () => {
    expect(instrumentNamedBy('Read on the plate reader', list)?.id).toBe('1')
    expect(instrumentNamedBy('Read on INS-0002', list)?.id).toBe('1')
  })
  it('ignores short names and unnamed steps', () => {
    expect(instrumentNamedBy('Adjust pH to 7', list)).toBeNull()
    expect(instrumentNamedBy('Mix gently', list)).toBeNull()
  })
})
