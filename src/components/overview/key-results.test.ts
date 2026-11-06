import { describe, expect, it } from 'vitest'

import { keyResultsFrom } from './key-results'
import type { NotebookBlock } from '#/lib/notebook-data'

const block = (
  order: number,
  type: string,
  payload: Record<string, unknown>,
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
})
