import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CanonicalRevisionEnvelope } from '#/lib/revision-diff'
import { buildRevisionDocument } from '#/lib/revision-document'
import {
  DOCUMENT_REVISION_ID,
  EARLIER_REVISION_ID,
  commentFixture,
  documentFixtures,
} from '#/lib/revision-document.test-fixtures'

import { RevisionDocumentReview } from './revision-document-review'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children?: ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

function renderDocument(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function blockSection(container: HTMLElement, blockId: string) {
  const section = container.querySelector<HTMLElement>(
    `[data-doc-block="${blockId}"]`,
  )
  if (!section) throw new Error(`no document block ${blockId}`)
  return section
}

describe('RevisionDocumentReview', () => {
  it('marks insertions and deletions inline and leaves unchanged content unmarked', () => {
    const { before, after } = documentFixtures()
    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
      />,
    )

    // Insertion: the added block reads inside <ins>.
    const inserted = screen.getByText(
      'Harvest at 72 h and measure genome titre.',
    )
    expect(inserted.closest('ins')).not.toBeNull()

    // Deletion: the removed block keeps its frozen text inside <del>.
    const deleted = screen.getByText('Remove after review.')
    expect(deleted.closest('del')).not.toBeNull()

    // Inline marks for the changed sentence.
    expect(screen.getByLabelText('Removed text').textContent).toBe(
      'Cells were seeded at 2.0 × 10⁶ cells/mL.',
    )
    expect(screen.getByLabelText('Inserted text').textContent).toBe(
      'Cells were seeded at 2.0 × 10⁶ cells/mL and transfected at 1.0 µg DNA/mL.',
    )

    // Unchanged content renders plainly: no marks, no change gutter.
    const unchanged = blockSection(container, 'block-objective')
    expect(unchanged.querySelector('ins, del, [data-doc-gutter]')).toBeNull()
    expect(screen.getByText('Measure virus stability at 4 °C.')).toBeTruthy()

    // One Δ per changed block, and the change card sits inside the block.
    expect(container.querySelectorAll('[data-doc-gutter]')).toHaveLength(3)
    expect(
      blockSection(container, 'block-method').querySelector(
        '[data-doc-location]',
      ),
    ).not.toBeNull()
    expect(screen.getAllByText('Δ').length).toBe(3)
  })

  it('anchors a comment to its block and keeps it navigable both ways', () => {
    const { before, after } = documentFixtures()
    const comment = commentFixture({
      id: 'comment-block',
      target_kind: 'block',
      target: { blockId: 'block-method' },
      body: 'This seeding density needs a citation.',
    })
    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[comment]}
      />,
    )

    // Location → comment: the block's marker focuses the comment card.
    const marker = screen.getByRole('button', {
      name: /Show 1 comment on/,
    })
    fireEvent.click(marker)
    expect((document.activeElement as HTMLElement).dataset.commentId).toBe(
      'comment-block',
    )

    // Comment → location: the card's action focuses the block it is about.
    fireEvent.click(
      screen.getByRole('button', { name: /Show the place this comment/ }),
    )
    expect((document.activeElement as HTMLElement).dataset.docLocation).toBe(
      'block-method',
    )
    expect(blockSection(container, 'block-method').className).toContain(
      'ring-2',
    )
  })

  it('reports a comment that no longer applies instead of re-anchoring it', () => {
    const { before, after } = documentFixtures()
    const textChange = buildRevisionDocument(before, after).diff.changes.find(
      (change) => change.area === 'text',
    )!
    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[
          commentFixture({
            id: 'comment-earlier-round',
            revision_id: 'rev-first-round',
            target_kind: 'block',
            target: { blockId: 'block-method' },
            body: 'Reword this method line.',
          }),
          commentFixture({
            id: 'comment-other-comparison',
            target_kind: 'diff',
            target: {
              comparisonRevisionId: 'rev-third-round',
              changeId: textChange.id,
            },
            body: 'This change is too large.',
          }),
        ]}
      />,
    )

    const region = screen.getByRole('region', {
      name: 'Comments that no longer apply to this revision',
    })
    expect(region.textContent).toContain('Reword this method line.')
    expect(region.textContent).toContain('This change is too large.')
    expect(region.textContent).toContain(
      'Anchored to an earlier revision of this record.',
    )
    expect(region.textContent).toContain(
      'Written against a different comparison revision.',
    )
    // Nothing is re-anchored: neither thread renders beside the block or change
    // it was originally written against.
    expect(container.querySelectorAll('[data-comment-id]')).toHaveLength(2)
    expect(
      blockSection(container, 'block-method').querySelector(
        '[data-comment-id]',
      ),
    ).toBeNull()
    expect(screen.queryByRole('group', { name: /Comments on/ })).toBeNull()
  })

  it('reads a change-anchored comment beside the change it was written against', () => {
    const { before, after } = documentFixtures()
    const textChange = buildRevisionDocument(before, after).diff.changes.find(
      (change) => change.area === 'text',
    )!
    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[
          commentFixture({
            id: 'comment-change',
            target_kind: 'diff',
            target: {
              comparisonRevisionId: EARLIER_REVISION_ID,
              changeId: textChange.id,
              area: textChange.area,
              identity: textChange.identity,
            },
            body: 'Name the transfection reagent here.',
          }),
        ]}
      />,
    )

    const change = container.querySelector<HTMLElement>(
      `[data-doc-location="${textChange.id}"]`,
    )
    expect(change).not.toBeNull()
    expect(change?.querySelector('[data-comment-id]')).not.toBeNull()
    expect(
      screen.getByRole('group', { name: 'Comments on this change' })
        .textContent,
    ).toContain('Name the transfection reagent here.')
  })

  it('keeps a comment on an unmarked part of the revision instead of dropping it', () => {
    const { before, after } = documentFixtures()
    renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[
          commentFixture({
            id: 'comment-table',
            target_kind: 'table_region',
            target: { tableId: 'table-1', columnId: 'col-1' },
            body: 'Confirm the titre unit.',
          }),
        ]}
      />,
    )

    const region = screen.getByRole('region', {
      name: 'Comments anchored to unmarked parts of this revision',
    })
    expect(region.textContent).toContain('Confirm the titre unit.')
    expect(
      screen.queryByRole('region', {
        name: 'Comments that no longer apply to this revision',
      }),
    ).toBeNull()
  })

  it('renders frozen facts instead of reading live content', () => {
    const { after } = documentFixtures()
    const frozen: CanonicalRevisionEnvelope = {
      ...after,
      blocks: [
        ...after.blocks,
        {
          id: 'block-sheet',
          type: 'sheet',
          order: 5,
          version: 1,
          payloadSchemaVersion: 1,
          payload: { instanceId: 'instance-1' },
        },
        {
          id: 'block-file',
          type: 'file',
          order: 6,
          version: 1,
          payloadSchemaVersion: 1,
          payload: {
            fileRecordId: 'file-1',
            displayName: 'raw-data.csv',
            mediaType: 'text/csv',
            byteSize: 2048,
          },
        },
      ],
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderDocument(<RevisionDocumentReview after={frozen} before={after} />)

    expect(
      screen.getByText(/no frozen Sheet evidence for this block/i),
    ).toBeTruthy()
    expect(screen.getByText('Media type')).toBeTruthy()
    expect(screen.getByText('text/csv')).toBeTruthy()
    expect(
      screen.getAllByText(/A frozen revision never loads live content/i).length,
    ).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('hides the change marks on request but keeps the anchored comments', () => {
    const { before, after } = documentFixtures()
    const { container } = renderDocument(
      <RevisionDocumentReview
        after={after}
        before={before}
        revisionId={DOCUMENT_REVISION_ID}
        comparisonRevisionId={EARLIER_REVISION_ID}
        comments={[
          commentFixture({
            id: 'comment-block',
            target_kind: 'block',
            target: { blockId: 'block-method' },
          }),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hide change marks' }))

    expect(container.querySelectorAll('[data-doc-gutter]')).toHaveLength(0)
    expect(container.querySelector('ins')).toBeNull()
    expect(screen.queryByLabelText('Removed text')).toBeNull()
    expect(container.querySelector('[data-comment-id]')).not.toBeNull()
  })
})
