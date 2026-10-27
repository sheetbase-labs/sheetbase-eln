/**
 * R5-STUDIO-03 — citation list component tests.
 *
 * The list is fed by the canonical citation read model, so these tests cover
 * the presentation contract only: the citing record's identifier/title with a
 * destination, the signed/locked/draft state, and the honest empty, loading and
 * failed-read states.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisViewCitation } from '#/lib/analysis-studio-data'
import { CitationList } from './citation-list'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: Record<string, unknown>
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (href, [key, value]) => href.replace(`$${key}`, String(value)),
        to,
      )}
      {...props}
    >
      {children}
    </a>
  ),
}))

afterEach(() => cleanup())

function citation(
  overrides: Partial<AnalysisViewCitation> = {},
): AnalysisViewCitation {
  return {
    linkId: 'link-1',
    sourceRecordId: 'record-1',
    identifier: 'EXP-0001',
    title: 'Filter train comparison',
    recordStatus: 'in_progress',
    linkedAt: '2026-10-02T09:15:00Z',
    locked: false,
    lockedAt: null,
    signed: false,
    signedAt: null,
    signerUserId: null,
    ...overrides,
  }
}

describe('CitationList', () => {
  it('renders a citing record with a destination and its draft state', () => {
    render(<CitationList citations={[citation()]} />)

    const link = screen.getByRole('link', { name: /EXP-0001/ })
    expect(link.getAttribute('href')).toBe('/records/record-1')
    expect(link.textContent).toContain('Filter train comparison')
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('2 Oct 2026')).toBeTruthy()
  })

  it('reports a locked record and a signed record distinctly', () => {
    render(
      <CitationList
        citations={[
          citation({
            linkId: 'link-locked',
            sourceRecordId: 'record-2',
            identifier: 'EXP-0002',
            locked: true,
            lockedAt: '2026-10-03T09:15:00Z',
          }),
          citation({
            linkId: 'link-signed',
            sourceRecordId: 'record-3',
            identifier: 'EXP-0003',
            locked: true,
            lockedAt: '2026-10-04T09:15:00Z',
            signed: true,
            signedAt: '2026-10-04T09:15:00Z',
            signerUserId: 'user-9',
          }),
        ]}
      />,
    )

    expect(screen.getByText('Locked')).toBeTruthy()
    expect(screen.getByText('Signed')).toBeTruthy()
    // Each citation keeps its own row.
    expect(screen.getByText('EXP-0002')).toBeTruthy()
    expect(screen.getByText('EXP-0003')).toBeTruthy()
  })

  it('states an explicit empty state when nothing cites the analysis', () => {
    render(
      <CitationList
        citations={[]}
        emptyBody="No record cites this analysis yet."
      />,
    )

    expect(screen.getByText('No record cites this analysis yet.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows a loading state and a failed-read state instead of a plausible list', () => {
    const { rerender } = render(<CitationList citations={[]} loading />)
    expect(screen.getByRole('status').textContent).toContain(
      'Reading citations',
    )

    rerender(<CitationList citations={[]} error="Analysis denied" />)
    expect(screen.getByRole('alert').textContent).toContain('Analysis denied')
  })
})
