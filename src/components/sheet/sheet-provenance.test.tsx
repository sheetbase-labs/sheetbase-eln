/**
 * NAV-02 provenance navigation — the Sheet footer provenance line resolves
 * bound provenance to the canonical related object with reconstructable
 * context: Dataset provenance opens the Dataset explorer, Record provenance
 * the owning Record. Destinations are always stable-UUID routes from the
 * canonical destinations, never label-derived paths.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SheetProvenanceLine } from './canonical-sheet-workspace'
import type { BoundColumnProvenance } from '#/lib/sheet-bound-columns'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    params,
    children,
  }: {
    to: string
    search?: Record<string, unknown>
    params?: Record<string, string>
    children: React.ReactNode
  }) => (
    <a
      href={to}
      data-search={JSON.stringify(search ?? null)}
      data-params={JSON.stringify(params ?? null)}
    >
      {children}
    </a>
  ),
}))

afterEach(() => cleanup())

function renderProvenance(provenance: {
  kind: 'present'
  provenance: BoundColumnProvenance
}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SheetProvenanceLine
        columnLabel="Titer"
        columnOrigin="bound"
        provenance={provenance}
      />
    </QueryClientProvider>,
  )
}

describe('Sheet provenance navigation (NAV-02)', () => {
  it('renders Dataset provenance as a canonical Dataset explorer link', () => {
    renderProvenance({
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
      } as unknown as BoundColumnProvenance,
    })
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/datasets')
    expect(JSON.parse(link.getAttribute('data-search')!)).toEqual({
      dataset: '770e8400-e29b-41d4-a716-446655440020',
      archived: false,
    })
    expect(link.textContent).toContain('770e8400-e29b-41d4-a716-446655440020')
  })

  it('renders Record provenance as a canonical Record link', () => {
    renderProvenance({
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
      } as unknown as BoundColumnProvenance,
    })
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/records/$recordId')
    expect(JSON.parse(link.getAttribute('data-params')!)).toEqual({
      recordId: '660e8400-e29b-41d4-a716-446655440010',
    })
  })

  it('renders plain status for unmatched provenance and local columns', () => {
    render(
      <SheetProvenanceLine
        columnLabel="Notes"
        columnOrigin="local"
        provenance={null}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('Notes · local')
    expect(screen.queryByRole('link')).toBeNull()
  })
})
