import { describe, expect, it } from 'vitest'

import type { CanonicalDatasetSource } from '#/lib/chart-data'

import { startDefinitionDraft } from './analysis-draft'

// SAFETY: only the fields the draft reads are present.
const source = {
  datasetId: 'd1',
  columns: [
    { id: 'c1', label: 'compound', logicalType: 'text' },
    { id: 'c2', label: 'concentration_nM', logicalType: 'decimal' },
    { id: 'c3', label: 'inhibition_pct', logicalType: 'decimal' },
  ],
} as CanonicalDatasetSource

describe('startDefinitionDraft', () => {
  it('starts a dose-response curve with one fit per compound', () => {
    const { definition } = startDefinitionDraft({
      kind: 'curve',
      source,
      snapshotId: null,
    })

    expect(definition?.kind === 'curve' && definition.group).toEqual({
      fieldId: 'c1',
    })
  })

  it('leaves one fit when no column names a compound', () => {
    const { definition } = startDefinitionDraft({
      kind: 'curve',
      source: {
        ...source,
        columns: source.columns.map((column) => ({
          ...column,
          label: column.id === 'c1' ? 'well' : column.label,
        })),
      },
      snapshotId: null,
    })

    expect(definition?.kind === 'curve' && definition.group).toBeNull()
  })
})
