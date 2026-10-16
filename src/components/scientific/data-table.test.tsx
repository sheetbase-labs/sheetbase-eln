/**
 * The data table's v9 feature bundles are declared per table, so the four
 * enabled interactions each have to keep working: sorting, paging, column
 * visibility and selection. jsdom only; the screen that drives it
 * (`RecordModelRecords`) is exercised in the browser layer.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { DataTable } from './data-table'
import type { DataTableColumnDef } from './data-table'

interface Row {
  id: string
  name: string
  group: string
}

/** 25 rows: ids ascending, names descending, so a sort is unambiguous. */
const rows: Row[] = Array.from({ length: 25 }, (_, index) => ({
  id: `R-${String(index + 1).padStart(2, '0')}`,
  name: `Name ${String(25 - index).padStart(2, '0')}`,
  group: index % 2 === 0 ? 'Even' : 'Odd',
}))

const columns: DataTableColumnDef<Row>[] = [
  { accessorKey: 'id', header: 'ID', meta: { className: 'w-24' } },
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'group', header: 'Group' },
]

afterEach(() => {
  cleanup()
})

/** The rows the checkbox selection marks, as the table renders them. */
function selectedRowCount(): number {
  return document.querySelectorAll('tbody tr[data-state="selected"]').length
}

function bodyRowIds(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)
}

describe('DataTable', () => {
  it('sorts on a header click and reports the direction to assistive tech', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={rows} label="Rows" />)
    expect(bodyRowIds()[0]).toBe('R-01')

    const header = screen.getByRole('columnheader', { name: /^Name/ })
    await user.click(within(header).getByRole('button'))

    expect(header.getAttribute('aria-sort')).toBe('ascending')
    const ids = bodyRowIds()
    expect(ids[0]).toBe('R-25')
    expect(ids[24]).toBe('R-01')

    await user.click(within(header).getByRole('button'))
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(bodyRowIds()[0]).toBe('R-01')
  })

  it('pages at the page size and follows the pager controls', async () => {
    const user = userEvent.setup()
    render(
      <DataTable columns={columns} data={rows} label="Rows" enablePagination />,
    )

    expect(bodyRowIds()).toHaveLength(20)
    expect(screen.getByRole('status').textContent).toContain('Page 1 of 2')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(bodyRowIds()).toHaveLength(5)
    expect(screen.getByRole('status').textContent).toContain('Page 2 of 2')

    await user.selectOptions(screen.getByRole('combobox'), '50')
    expect(bodyRowIds()).toHaveLength(25)
    expect(screen.getByRole('status').textContent).toContain('Page 1 of 1')
  })

  it('shows every row when the pager is off', () => {
    render(<DataTable columns={columns} data={rows} label="Rows" />)
    expect(bodyRowIds()).toHaveLength(25)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders only the visible columns when one starts hidden', () => {
    // The visibility menu itself is Base UI and is not driven in jsdom; the
    // browser layer covers the menu, this covers the feature it writes to.
    render(
      <DataTable
        columns={columns}
        data={rows.slice(0, 2)}
        label="Rows"
        enableColumnVisibility
        initialColumnVisibility={{ group: false }}
      />,
    )

    expect(screen.queryByRole('columnheader', { name: 'Group' })).toBeNull()
    expect(
      within(screen.getAllByRole('row')[1]).getAllByRole('cell'),
    ).toHaveLength(2)
  })

  it('reveals the indeterminate select-all state when part of the page is selected', async () => {
    const user = userEvent.setup()
    render(
      <DataTable
        columns={columns}
        data={rows.slice(0, 3)}
        label="Rows"
        enableRowSelection
      />,
    )

    const selectAll = screen.getByRole('checkbox', { name: 'Select all rows' })
    await user.click(selectAll)
    expect(selectedRowCount()).toBe(3)
    expect(selectAll.getAttribute('aria-checked')).toBe('true')

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0])
    expect(selectedRowCount()).toBe(2)
    expect(selectAll.getAttribute('aria-checked')).toBe('mixed')
  })

  it('renders the empty message across every column', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        label="Rows"
        emptyMessage="No samples."
      />,
    )
    const cell = screen.getByRole('cell', { name: 'No samples.' })
    expect(cell.getAttribute('colspan')).toBe('3')
  })
})
