/**
 * In linked panes a grid reports the row it has selected and takes the row the
 * pane it follows selects, when it has that row.
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaneContext } from '#/components/workspace/workspace-navigation'
import { useBulkSelection } from './bulk-selection'
import { RegistryGrid } from './registry-grid'
import type { RegistryColumn } from './registry-grid'

for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

interface Row {
  id: string
  name: string
}

const rows: Row[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
]

const columns: RegistryColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
]

afterEach(cleanup)

function renderGrid(options: {
  followed?: string
  selection?: Record<string, true>
  onChange?: (next: unknown) => void
  report?: (id: string | undefined) => void
}) {
  return render(
    <PaneContext.Provider
      value={{
        paneId: 'p',
        readOnly: false,
        reportNewer: () => {},
        reportFrozen: () => {},
        reportSelection: options.report ?? (() => {}),
        followedSelection: options.followed,
      }}
    >
      <RegistryGrid
        label="Rows"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        rowSelection={options.selection ?? {}}
        onRowSelectionChange={options.onChange as never}
      />
    </PaneContext.Provider>,
  )
}

describe('RegistryGrid in linked panes', () => {
  it('takes the row the followed pane selects', async () => {
    const onChange = vi.fn()
    renderGrid({ followed: 'b', onChange })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ b: true }))
  })

  it('ignores a row it does not have', () => {
    const onChange = vi.fn()
    renderGrid({ followed: 'zzz', onChange })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports the row it has selected', async () => {
    const report = vi.fn()
    renderGrid({ selection: { a: true }, report })
    await waitFor(() => expect(report).toHaveBeenCalledWith('a'))
  })
})

describe('RegistryGrid pinned edges', () => {
  const pinnedHeaders = (cols: RegistryColumn<Row>[]) => {
    const { container } = render(
      <RegistryGrid
        label="Rows"
        rows={rows}
        columns={cols}
        getRowId={(row) => row.id}
      />,
    )

    return [...container.querySelectorAll('thead th')].map((th) => [
      th.textContent,
      th.getAttribute('data-pinned'),
    ])
  }

  const cell = (id: string, header: string): RegistryColumn<Row> => ({
    id,
    header,
    cell: ({ row }) => row.original.name,
  })

  it('keeps the first column and a trailing Status in view', () => {
    expect(
      pinnedHeaders([
        cell('identifier', 'ID'),
        cell('name', 'Name'),
        cell('status', 'Status'),
      ]),
    ).toEqual([
      ['ID', 'start'],
      ['Name', null],
      ['Status', 'end'],
    ])
  })

  it('never moves a Status column that is not already last', () => {
    expect(
      pinnedHeaders([
        cell('identifier', 'ID'),
        cell('status', 'Status'),
        cell('updated', 'Updated'),
      ]),
    ).toEqual([
      ['ID', 'start'],
      ['Status', null],
      ['Updated', null],
    ])
  })
})

describe('RegistryGrid tick boxes', () => {
  function BulkHarness({
    onTicked,
  }: {
    onTicked?: (ids: readonly string[]) => void
  }) {
    const bulk = useBulkSelection()
    onTicked?.(bulk.ids)

    return (
      <PaneContext.Provider
        value={{
          paneId: 'p',
          readOnly: false,
          reportNewer: () => {},
          reportFrozen: () => {},
          reportSelection: () => {},
          followedSelection: undefined,
        }}
      >
        <RegistryGrid
          label="Rows"
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          bulk={bulk}
        />
      </PaneContext.Provider>
    )
  }

  it('ticks one row, then every row from the header', async () => {
    const seen: (readonly string[])[] = []

    const { getByLabelText } = render(
      <BulkHarness onTicked={(ids) => seen.push(ids)} />,
    )

    await userEvent.click(getByLabelText('Select a'))
    expect(seen.at(-1)).toEqual(['a'])
    await userEvent.click(getByLabelText('Select all rows'))
    expect(new Set(seen.at(-1))).toEqual(new Set(['a', 'b']))
    await userEvent.click(getByLabelText('Select all rows'))
    expect(seen.at(-1)).toEqual([])
  })

  it('does not open the row when a box is ticked', async () => {
    const onRowClick = vi.fn()

    const { getByLabelText } = render(
      <PaneContext.Provider
        value={{
          paneId: 'p',
          readOnly: false,
          reportNewer: () => {},
          reportFrozen: () => {},
          reportSelection: () => {},
          followedSelection: undefined,
        }}
      >
        <TickOnly onRowClick={onRowClick} />
      </PaneContext.Provider>,
    )

    await userEvent.click(getByLabelText('Select b'))
    expect(onRowClick).not.toHaveBeenCalled()
  })
})

function TickOnly({ onRowClick }: { onRowClick: () => void }) {
  const bulk = useBulkSelection()

  return (
    <RegistryGrid
      label="Rows"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      bulk={bulk}
      onRowClick={onRowClick}
    />
  )
}
