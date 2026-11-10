import { describe, expect, it } from 'vitest'

import { validatePipelineActions } from './actions'
import { t } from '#/copy'

describe('validatePipelineActions boundary diagnostics', () => {
  it('accumulates independent errors in order across actions', () => {
    expect(
      validatePipelineActions([
        {
          name: 'Bad Name',
          operation: 'plugin.example.step',
          arguments: {},
          mode: 'unsupported',
          forEach: { $ref: 'secrets.rows' },
        },
        null,
        {
          name: 'next',
          operation: 'plugin.example.step',
          arguments: {},
          mode: 'propose',
        },
      ]),
    ).toEqual([
      t('data.pipelineActions.actionNeedsUniqueName', { value: 1 }),
      t('data.pipelineActions.actionHasUnknownMode', { value: 1 }),
      t('data.pipelineActions.actionRowLoopNeedsList', { value: 1 }),
      t('data.pipelineActions.actionMustObject', { value: 2 }),
      t('data.pipelineActions.actionCannotProposeHas', {
        value: 3,
        operation: 'plugin.example.step',
      }),
    ])
  })

  it('preserves optional undefined authoring values before JSON serialization', () => {
    expect(
      validatePipelineActions([
        {
          name: 'first',
          operation: 'plugin.example.step',
          arguments: { optional: undefined },
          mode: undefined,
          forEach: undefined,
        },
      ]),
    ).toEqual([])
  })

  it('does not treat an array item as a non-object diagnostic', () => {
    expect(validatePipelineActions([[]])).toEqual([
      t('data.pipelineActions.actionNeedsUniqueName', { value: 1 }),
      t('data.pipelineActions.actionUsesUnsupportedOperation', { value: 1 }),
    ])
  })

  it.each([
    null,
    'previous',
    {},
    { $ref: 'previous', extra: undefined },
    { $ref: 'previous', ['__proto__']: 'extra' },
    { $ref: 'previous.' },
  ])('rejects malformed row-loop references without throwing', (forEach) => {
    expect(
      validatePipelineActions([
        {
          name: 'first',
          operation: 'plugin.example.step',
          arguments: {},
          forEach,
        },
      ]),
    ).toEqual([t('data.pipelineActions.actionRowLoopNeedsList', { value: 1 })])
  })
})
