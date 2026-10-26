import { describe, expect, it } from 'vitest'

import { runNumbers, runSteps } from './run-steps'
import type { PipelineRunLogWire } from './types'

const config = {
  transform: { language: 'sql' as const, statement: 'select 1' },
  steps: [
    { name: 'check_units', language: 'sql' as const, statement: 's' },
    { name: 'deconvolve', language: 'python' as const, statement: 'p' },
    { name: 'save', language: 'sql' as const, statement: 's' },
  ],
}

function log(partial: Partial<PipelineRunLogWire>): PipelineRunLogWire {
  return {
    id: '1',
    workspace_id: 'w',
    run_id: 'r',
    sequence: 1,
    level: 'info',
    stage: 'run',
    message: '',
    detail: {},
    at: '2026-09-25T09:00:00Z',
    ...partial,
  }
}

describe('runSteps', () => {
  it('marks every step done on a succeeded run', () => {
    const steps = runSteps(config, { status: 'succeeded' }, [])
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done'])
  })

  it('stops a failed run at the step its error log names', () => {
    const steps = runSteps(config, { status: 'failed' }, [
      log({ level: 'error', detail: { step: 'deconvolve' } }),
    ])
    expect(steps.map((s) => s.state)).toEqual([
      'done',
      'done',
      'failed',
      'not_started',
    ])
    expect(steps[2].note).toBe('Python · stopped here')
    expect(steps[1].label).toBe('Check units')
  })

  it('pauses a waiting run on its prompt step', () => {
    const steps = runSteps(config, { status: 'waiting' }, [], {
      step_id: 'check_units',
    })
    expect(steps.map((s) => s.state)).toEqual([
      'done',
      'waiting',
      'not_started',
      'not_started',
    ])
  })
})

describe('runNumbers', () => {
  it('numbers the oldest run first', () => {
    const numbers = runNumbers([
      { id: 'b', started_at: '2026-09-02T00:00:00Z' },
      { id: 'a', started_at: '2026-09-01T00:00:00Z' },
    ])
    expect(numbers.get('a')).toBe(1)
    expect(numbers.get('b')).toBe(2)
  })
})
