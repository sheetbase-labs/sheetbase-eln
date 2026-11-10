/**
 * Row / RowList — the row chrome primitive (JH-1).
 *
 * The contract under test is the one ≈30 hand-rolled rows kept re-deciding:
 * which element a row is (link, anchor, button, or read-only), that a row in a
 * list is a list item, that a list with no rows says what it has instead, and
 * that a heavy list can window itself.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Row, RowList } from './row'

/** Render a row inside a real router, which is where its `to` links resolve. */
function renderRow(ui: React.ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(<RouterProvider router={router} />)
}

afterEach(cleanup)

describe('Row forms', () => {
  it('is a router link when it has a destination', async () => {
    renderRow(<Row to="/samples/s-1" title="Cell line" meta="SMP-0002" />)

    expect(
      (await screen.findByRole('link', { name: /Cell line/ })).getAttribute(
        'href',
      ),
    ).toBe('/samples/s-1')
    expect(screen.getByText('SMP-0002')).toBeTruthy()
  })

  it('is an anchor for a URL the router does not own', () => {
    render(<Row href="/api/files/f-1" title="report.pdf" />)

    expect(
      screen.getByRole('link', { name: 'report.pdf' }).getAttribute('href'),
    ).toBe('/api/files/f-1')
  })

  it('is a button when it acts rather than navigates', () => {
    const onClick = vi.fn()
    render(<Row onClick={onClick} title="Discard draft" trailing="2" />)

    const row = screen.getByRole('button', { name: /Discard draft/ })
    expect(row.textContent).toContain('2')
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is read-only, not a broken link, when it has no destination', () => {
    render(<Row title="Deleted sample" meta="Deleted" />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Deleted sample')).toBeTruthy()
  })

  it('keeps the trailing slot out of the row it explains', async () => {
    renderRow(
      <Row
        to="/records/r-1"
        title="Cell line"
        trailing={<span aria-label="3 identical links">×3</span>}
      />,
    )

    expect(await screen.findByText('×3')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Cell line/ })).toBeTruthy()
  })
})

describe('RowList', () => {
  const rows = [
    <Row key="1" to="/records/1" title="Record 1" />,
    <Row key="2" to="/records/2" title="Record 2" />,
  ]

  it('renders its rows as list items in a list', async () => {
    renderRow(<RowList>{rows}</RowList>)

    expect((await screen.findByRole('list')).children).toHaveLength(2)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('says what it has instead of rows when it has none', () => {
    render(<RowList empty={<p>No linked records</p>}>{[]}</RowList>)

    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText('No linked records')).toBeTruthy()
  })

  it('renders nothing when it is empty and has nothing to say', () => {
    const { container } = render(<RowList>{[]}</RowList>)

    expect(container.textContent).toBe('')
  })

  it('windows a long list and opens it on demand', async () => {
    renderRow(
      <RowList limit={2}>
        {['1', '2', '3', '4'].map((n) => (
          <Row key={n} to={`/records/${n}`} title={`Record ${n}`} />
        ))}
      </RowList>,
    )

    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText('Record 4')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show all 4' }))

    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('leaves a short list alone', async () => {
    renderRow(
      <RowList limit={25}>
        {['1', '2'].map((n) => (
          <Row key={n} to={`/records/${n}`} title={`Record ${n}`} />
        ))}
      </RowList>,
    )

    expect(await screen.findByText('Record 2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('shows the row detail as hover text on the row it belongs to', async () => {
    renderRow(
      <RowList>
        <Row to="/records/1" title="Record 1" detail="Linked by user-1" />
      </RowList>,
    )

    expect((await screen.findByRole('listitem')).getAttribute('title')).toBe(
      'Linked by user-1',
    )
  })
})
