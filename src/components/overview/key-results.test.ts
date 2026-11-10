import { describe, expect, it } from 'vitest'

import { keyResultsFrom } from './key-results'
import type { NotebookBlock } from '#/lib/notebook-data'

const block = (
  order: number,
  type: string,
  payload: NotebookBlock['payload'],
): NotebookBlock => ({
  id: `b${order}`,
  recordId: 'r',
  type,
  payload,
  payloadSchemaVersion: 1,
  order,
  version: 1,
})

describe('keyResultsFrom', () => {
  it('takes the metrics and the conclusion, in notebook order', () => {
    const { metrics, conclusions } = keyResultsFrom([
      block(5, 'conclusion', { text: 'Move on.', verdict: 'supported' }),
      block(1, 'rich_text', {}),
      block(4, 'metric', {
        label: 'Best peak cell density',
        value: '43.3',
        unit: '× 10⁶/mL',
        provenance: '0.45 µm, mean of three replicates',
      }),
    ])

    expect(metrics).toEqual([
      {
        id: 'b4',
        label: 'Best peak cell density',
        value: '43.3',
        unit: '× 10⁶/mL',
        provenance: '0.45 µm, mean of three replicates',
      },
    ])
    expect(conclusions.map((c) => c.text)).toEqual(['Move on.'])
  })

  it('leaves out a metric with no value and a conclusion with no text', () => {
    const { metrics, conclusions } = keyResultsFrom([
      block(1, 'metric', { label: 'Empty', value: ' ' }),
      block(2, 'conclusion', { verdict: 'supported' }),
    ])

    expect(metrics).toEqual([])
    expect(conclusions).toEqual([])
  })

  it('accepts only primitive text without coercing native values', () => {
    const cannotCoerce = {
      toString() {
        throw new Error('must not stringify metadata')
      },
    }

    const result = keyResultsFrom([
      block(1, 'metric', { value: 0 }),
      block(2, 'metric', { value: 1n }),
      block(3, 'metric', { value: Symbol('value') }),
      block(4, 'metric', { value: cannotCoerce }),
      block(5, 'conclusion', { text: ['not primitive'] }),
      block(6, 'metric', {
        value: ' 0 ',
        label: '\tYield ',
        unit: ' mg/mL ',
        provenance: cannotCoerce,
      }),
    ])

    expect(result).toEqual({
      metrics: [
        { id: 'b6', value: '0', label: 'Yield', unit: 'mg/mL', provenance: '' },
      ],
      conclusions: [],
    })
  })

  it('retains document order ties without mutating the input array', () => {
    const blocks = [
      { id: 'late', type: 'metric', order: 2, payload: { value: '9' } },
      { id: 'first', type: 'metric', payload: { value: '1' } },
      { id: 'second', type: 'metric', order: 0, payload: { value: '2' } },
    ]

    expect(keyResultsFrom(blocks).metrics.map((metric) => metric.id)).toEqual([
      'first',
      'second',
      'late',
    ])
    expect(blocks.map((entry) => entry.id)).toEqual(['late', 'first', 'second'])
  })

  it('reads only the selected block members, preserving getter order and throws', () => {
    const reads: string[] = []

    const payload = {
      get value() {
        reads.push('value')

        return ' 4.7 '
      },
      get label() {
        reads.push('label')

        return 'Titre'
      },
      get unit() {
        reads.push('unit')

        return 'PFU/mL'
      },
      get provenance() {
        reads.push('provenance')

        return 'measured'
      },
      get unrelated() {
        throw new Error('must remain unread')
      },
    }

    expect(keyResultsFrom([block(1, 'metric', payload)]).metrics[0].value).toBe(
      '4.7',
    )
    expect(reads).toEqual(['value', 'label', 'unit', 'provenance'])
    const failure = new Error('native value getter failed')

    expect(() =>
      keyResultsFrom([
        block(2, 'metric', {
          get value() {
            throw failure
          },
        }),
      ]),
    ).toThrow(failure)
  })
})
