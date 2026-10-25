import { describe, expect, it } from 'vitest'

import { explainRunError } from './run-errors'

describe('explainRunError', () => {
  it('points a SQL failure at the Steps editor and says a retry will not help', () => {
    const guidance = explainRunError('transform_failed')
    expect(guidance.fix).toBe('steps')
    expect(guidance.retryHelps).toBe(false)
  })

  it('points an output problem at the Output section', () => {
    expect(explainRunError('output_column_mapping').fix).toBe('output')
  })

  it('lets a timeout or internal fault be retried', () => {
    expect(explainRunError('transform_timed_out').retryHelps).toBe(true)
    expect(explainRunError('pipeline_internal').retryHelps).toBe(true)
  })

  it('explains a temporary-storage failure and keeps retry available after the fix', () => {
    const guidance = explainRunError('PL003')
    expect(guidance.title).toContain('temporary storage')
    expect(guidance.hint).toContain('Free or expand')
    expect(guidance.fix).toBeNull()
    expect(guidance.retryHelps).toBe(true)
  })

  it('treats an unknown or missing code as retryable and never throws', () => {
    expect(explainRunError('python_runtime_unavailable').retryHelps).toBe(true)
    expect(explainRunError(null).title).toBe('The run failed')
  })
})
