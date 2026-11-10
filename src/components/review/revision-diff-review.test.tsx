import { Suspense, startTransition } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  changedRevisionFixture,
  revisionFixture,
} from '#/lib/revision-diff.test-fixtures'

import { RevisionDiffReview } from './revision-diff-review'
import type { CanonicalRevisionEnvelope } from '#/lib/revision-diff'

afterEach(cleanup)

const suspended = new Promise<void>(() => undefined)

function SuspendReview({ blocked }: { blocked: boolean }) {
  if (blocked) throw suspended

  return null
}

describe('RevisionDiffReview', () => {
  it('does not claim unchanged scientific content when historical Sheet row identities are unavailable', () => {
    const snapshot = revisionFixture()
    snapshot.sheetEvidence = [
      {
        blockId: 'historical-sheet',
        instanceId: 'instance',
        instanceRevision: 1,
        sourceDefinitionVersionId: 'definition',
        datasetBindings: [],
        instanceState: {},
        composedGrid: { columns: [{ id: 'titer' }], rows: [[5.9]] },
      },
    ]
    render(
      <RevisionDiffReview
        before={snapshot}
        after={structuredClone(snapshot)}
      />,
    )

    const unavailable = screen
      .getByText('Cell comparison unavailable')
      .closest('[role="status"]')

    expect(unavailable?.textContent).toContain('Cell comparison unavailable')
    expect(unavailable?.textContent).toContain('can’t be compared cell by cell')
    expect(
      screen.queryByText(/submitted scientific content is unchanged/),
    ).toBeNull()
  })

  it('labels every change kind in text and supports change-type filtering', () => {
    render(
      <RevisionDiffReview
        before={revisionFixture()}
        after={changedRevisionFixture()}
        beforeLabel="Revision 1"
        afterLabel="Revision 2"
      />,
    )

    expect(screen.getByText('Revision 1')).toBeTruthy()
    expect(screen.getByText('Revision 2')).toBeTruthy()
    expect(screen.getAllByText('Added').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Removed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Modified').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Moved').length).toBeGreaterThan(0)
    expect(
      screen.getByRole('group', { name: 'Change type filters' }),
    ).toBeTruthy()
    expect(screen.getByText('=ROUND([titer] * 1.000E+00, 4)')).toBeTruthy()
    expect(screen.getByText('=ROUND([titer] * 1.250E+00, 4)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /hide modified/i }))
    expect(screen.queryAllByText('Modified')).toHaveLength(0)
    expect(
      screen
        .getByRole('button', { name: /show modified/i })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('focuses by change area so reviewers can isolate a single area', () => {
    render(
      <RevisionDiffReview
        before={revisionFixture()}
        after={changedRevisionFixture()}
      />,
    )

    // The multi-area fixture exposes an area filter group covering every area
    // that has changes. Table changes start collapsed behind a summary card.
    expect(
      screen.getByRole('group', { name: 'Change area filters' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /show changes for timepoints/i }),
    ).toBeTruthy()

    const total = screen.getByText(/^Change 1 of /).textContent

    // Hiding the scientific-table area removes the table summary card and
    // drops every table cell change from the navigation stream.
    fireEvent.click(
      screen.getByRole('button', { name: /hide scientific table changes/i }),
    )
    expect(
      screen.queryByRole('button', { name: /show changes for timepoints/i }),
    ).toBeNull()
    const remaining = screen.getByText(/^Change 1 of /).textContent
    expect(Number(remaining.match(/of (\d+)/)![1])).toBeLessThan(
      Number(total.match(/of (\d+)/)![1]),
    )

    // Restoring the area brings the table summary card back.
    fireEvent.click(
      screen.getByRole('button', { name: /show scientific table changes/i }),
    )
    expect(
      screen.getByRole('button', { name: /show changes for timepoints/i }),
    ).toBeTruthy()
  })

  it('navigates between visible changes with labelled controls', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(
      <RevisionDiffReview
        before={revisionFixture()}
        after={changedRevisionFixture()}
      />,
    )

    expect(screen.getByText(/^Change 1 of /)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    expect(screen.getByText(/^Change 2 of /)).toBeTruthy()
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('keeps large-table detail collapsed until requested', () => {
    render(
      <RevisionDiffReview
        before={revisionFixture()}
        after={changedRevisionFixture()}
      />,
    )

    expect(screen.queryByText('9.5000E+05')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: /show changes for timepoints/i }),
    )
    expect(screen.getByText('9.5000E+05')).toBeTruthy()
    expect(screen.getByText('1.0250E+06')).toBeTruthy()
    expect(screen.getAllByText('TU/mL').length).toBeGreaterThanOrEqual(2)
  })

  it('batches large table details and navigates individual cell changes', () => {
    const before = revisionFixture()
    const after = revisionFixture()

    const beforeRows = Array.from({ length: 150 }, (_, index) => ({
      id: `row-large-${index}`,
      timepoint: String(index),
      titer: `1.${String(index).padStart(4, '0')}E+06`,
    }))

    const afterRows = beforeRows.map((row, index) => ({
      ...row,
      titer: `2.${String(index).padStart(4, '0')}E+06`,
    }))

    before.scientificTables[0].rows = beforeRows
    after.scientificTables[0].rows = afterRows

    render(<RevisionDiffReview before={before} after={after} />)

    expect(screen.getByText('Change 1 of 150')).toBeTruthy()
    expect(screen.getByText('1.0000E+06')).toBeTruthy()
    expect(screen.queryByText('1.0099E+06')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    expect(screen.getByText('Change 2 of 150')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Show 50 more changes' }),
    )
    expect(screen.getByText('1.0099E+06')).toBeTruthy()
  })

  it('retains manual collapse and loaded batches until selecting another detail', () => {
    const before = revisionFixture()
    const after = revisionFixture()
    before.scientificTables[0].rows = Array.from(
      { length: 150 },
      (_, index) => ({
        id: `row-${String(index).padStart(3, '0')}`,
        timepoint: String(index),
        titer: `before-${index}`,
      }),
    )
    after.scientificTables[0].rows = Array.from(
      { length: 150 },
      (_, index) => ({
        id: `row-${String(index).padStart(3, '0')}`,
        timepoint: String(index),
        titer: `after-${index}`,
      }),
    )
    const view = render(<RevisionDiffReview before={before} after={after} />)
    expect(screen.getByText('before-0')).toBeTruthy()
    expect(screen.queryByText('before-149')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Show 50 more changes' }),
    )
    expect(screen.getByText('before-149')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: /hide changes for timepoints/i }),
    )
    expect(screen.queryByText('before-0')).toBeNull()

    view.rerender(<RevisionDiffReview before={before} after={after} />)
    expect(screen.queryByText('before-0')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    expect(screen.getByText('before-149')).toBeTruthy()
    expect(document.activeElement?.getAttribute('aria-current')).toBe('step')
    expect(document.activeElement?.textContent).toContain('before-1')
    fireEvent.click(
      screen.getByRole('button', { name: /hide changes for timepoints/i }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: /show changes for timepoints/i }),
    )
    expect(screen.getByText('before-149')).toBeTruthy()
  })

  it('keeps a clamped selection after the available change list grows again', () => {
    const before = revisionFixture()
    const after = changedRevisionFixture()
    const shortened = revisionFixture()
    shortened.record.title = 'Only the title changed'
    const view = render(<RevisionDiffReview before={before} after={after} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    expect(screen.getByText(/^Change 3 of /)).toBeTruthy()
    view.rerender(<RevisionDiffReview before={before} after={shortened} />)
    expect(screen.getByText('Change 1 of 1')).toBeTruthy()
    view.rerender(<RevisionDiffReview before={before} after={after} />)
    expect(screen.getByText(/^Change 1 of /)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Previous change' }),
    ).toHaveProperty('disabled', true)
  })

  it('does not commit selection or table expansion from an abandoned render', async () => {
    const before = revisionFixture()
    const after = changedRevisionFixture()
    const shortened = revisionFixture()
    shortened.record.title = 'Suspended title change'

    function frame(revision: CanonicalRevisionEnvelope, blocked: boolean) {
      return (
        <Suspense fallback={<p>Review pending</p>}>
          <RevisionDiffReview before={before} after={revision} />
          <SuspendReview blocked={blocked} />
        </Suspense>
      )
    }

    const view = render(frame(after, false))
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    await act(async () => {
      startTransition(() => view.rerender(frame(shortened, true)))
    })
    expect(screen.queryByText('Review pending')).toBeNull()
    expect(screen.getByText(/^Change 3 of /)).toBeTruthy()
    view.rerender(frame(after, false))
    expect(screen.getByText(/^Change 3 of /)).toBeTruthy()

    cleanup()
    const tableBefore = revisionFixture()
    const tableAfter = revisionFixture()
    tableAfter.scientificTables[0].rows = [
      { id: 'row-1', timepoint: '0', titer: 'Native changed value' },
      { id: 'row-2', timepoint: '7', titer: '9.5000E+05' },
    ]
    const shifted = structuredClone(tableAfter)
    shifted.record.title = 'Suspended metadata before table'

    function tableFrame(revision: CanonicalRevisionEnvelope, blocked: boolean) {
      return (
        <Suspense fallback={<p>Review pending</p>}>
          <RevisionDiffReview before={tableBefore} after={revision} />
          <SuspendReview blocked={blocked} />
        </Suspense>
      )
    }

    const tableView = render(tableFrame(tableAfter, false))
    expect(screen.getByText('Native changed value')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: /hide changes for timepoints/i }),
    )
    await act(async () => {
      startTransition(() => tableView.rerender(tableFrame(shifted, true)))
    })
    expect(screen.queryByText('Review pending')).toBeNull()
    expect(screen.queryByText('Native changed value')).toBeNull()
    tableView.rerender(tableFrame(tableAfter, false))
    expect(screen.queryByText('Native changed value')).toBeNull()
    expect(
      screen
        .getByRole('button', { name: /show changes for timepoints/i })
        .getAttribute('aria-expanded'),
    ).toBe('false')
  })

  it('renders an honest unchanged state', () => {
    render(
      <RevisionDiffReview
        before={revisionFixture()}
        after={revisionFixture()}
      />,
    )
    expect(screen.getByText('No meaningful changes')).toBeTruthy()
  })
})
