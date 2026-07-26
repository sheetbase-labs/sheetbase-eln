import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  changedRevisionFixture,
  revisionFixture,
} from '#/lib/revision-diff.test-fixtures'

import { RevisionDiffReview } from './revision-diff-review'

afterEach(cleanup)

describe('RevisionDiffReview', () => {
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
