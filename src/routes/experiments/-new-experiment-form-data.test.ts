import { describe, expect, it } from 'vitest'

import { t } from '#/copy'

import { createErrorMessage } from './-new-experiment-form-data'

describe('createErrorMessage', () => {
  it('says what to do when a template’s own contents are refused', () => {
    const refusal = new Error('invalid materials payload')

    expect(createErrorMessage(refusal, true)).toBe(
      t('projects.newExperiment.errors.template'),
    )
  })

  it('leaves other refusals as they were', () => {
    expect(createErrorMessage(new Error('invalid materials payload'))).toBe(
      'invalid materials payload',
    )
    expect(createErrorMessage(new Error('project is archived'), true)).toBe(
      t('projects.newExperiment.errors.archived'),
    )
  })
})
