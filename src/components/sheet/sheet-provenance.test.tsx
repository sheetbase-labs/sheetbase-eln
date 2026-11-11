/**
 * NAV-02 provenance navigation — the Sheet footer provenance line resolves
 * bound provenance to the canonical related object with reconstructable
 * context: Dataset provenance opens the Dataset explorer, Record provenance
 * the owning Record. Destinations are always stable-UUID routes from the
 * canonical destinations, never label-derived paths.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SheetProvenanceLine } from './canonical-sheet-workspace'
import type { BoundColumnProvenance } from '#/lib/sheet-bound-columns'
import { renderSheetRoute } from './sheet-test-router'

afterEach(() => cleanup())

function renderProvenance(provenance: {
  kind: 'present'
  provenance: BoundColumnProvenance
}) {
  return renderSheetRoute(
    <SheetProvenanceLine
      columnLabel="Titer"
      columnOrigin="bound"
      provenance={provenance}
    />,
  )
}

describe('Sheet provenance navigation (NAV-02)', () => {
  it('renders Dataset provenance as a canonical Dataset explorer link', async () => {
    await renderProvenance({
      kind: 'present',
      provenance: {
        sourceKind: 'dataset',
        sourceDatasetId: '770e8400-e29b-41d4-a716-446655440020',
        sourceRowId: null,
        sourceRevision: 3,
        sourceDatasetRevision: 9,
        bindingId: 'binding-1',
        sourceFieldId: 'field-1',
        definitionVersionId: 'def-1',
        definitionColumnId: 'col-1',
      },
    })
    const link = screen.getByRole('link')
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost')
    expect(href.pathname).toBe('/datasets')
    // The link carries only the stable Dataset ID — the explorer resolves
    // the Dataset's lifecycle itself and flips to the archived view when
    // needed, so the link must not claim the active-only filter.
    expect(Object.fromEntries(href.searchParams)).toEqual({
      dataset: '770e8400-e29b-41d4-a716-446655440020',
    })
    expect(link.textContent).toBe('Open dataset')
  })

  it('renders Record provenance as a canonical Record link', async () => {
    await renderProvenance({
      kind: 'present',
      provenance: {
        sourceKind: 'record',
        sourceRecordId: '660e8400-e29b-41d4-a716-446655440010',
        sourceMetadataVersion: 5,
        sourceFieldName: 'titer',
        bindingId: 'binding-1',
        sourceFieldId: 'field-1',
        definitionVersionId: 'def-1',
        definitionColumnId: 'col-1',
      },
    })
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe(
      '/records/660e8400-e29b-41d4-a716-446655440010',
    )
  })

  it('renders plain status for unmatched provenance and local columns', () => {
    render(
      <SheetProvenanceLine
        columnLabel="Notes"
        columnOrigin="local"
        provenance={null}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe(
      'NotesEditing makes a new sheet revision',
    )
    expect(screen.queryByRole('link')).toBeNull()
  })
})
