/**
 * In linked panes a grid reports the row it has selected and takes the row the
 * pane it follows selects, when it has that row.
 */
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Suspense, startTransition, use, useEffect } from 'react'
import type { OnChangeFn, RowSelectionState } from '@tanstack/react-table'

import { PaneContext } from '#/components/workspace/workspace-navigation'
import { useBulkSelection } from './bulk-selection'
import { compareCells, RegistryGrid } from './registry-grid'
import type { RegistryColumn, RegistryGridProps } from './registry-grid'

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

/** A list shows no tick boxes until a row is ticked; Space on the focused row ticks it. */
async function startTicking(cell: HTMLElement) {
  const tr = cell.closest('tr')

  if (!tr) throw new Error('cell is not in a row')
  tr.focus()
  await userEvent.keyboard(' ')
}

function renderGrid(options: {
  followed?: string
  selection?: Record<string, true>
  onChange?: OnChangeFn<RowSelectionState>
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
        onRowSelectionChange={options.onChange}
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
    useEffect(() => {
      onTicked?.(bulk.ids)
    }, [onTicked, bulk.ids])

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

    const { getByLabelText, getByText } = render(
      <BulkHarness onTicked={(ids) => seen.push(ids)} />,
    )

    await startTicking(getByText('Alpha'))
    expect(seen.at(-1)).toEqual(['a'])
    await userEvent.click(getByLabelText('Select all rows'))
    expect(new Set(seen.at(-1))).toEqual(new Set(['a', 'b']))
    await userEvent.click(getByLabelText('Select all rows'))
    expect(seen.at(-1)).toEqual([])
  })

  it('does not open the row when a box is ticked', async () => {
    const onRowClick = vi.fn()

    const { getByLabelText, getByText } = render(
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

    await startTicking(getByText('Alpha'))
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

const pendingRender = new Promise<void>(() => {})

function SuspendRender({ pending }: { pending: boolean }) {
  if (pending) use(pendingRender)

  return null
}

function LifecycleGrid({
  report,
  followed,
  pending = false,
  labelPrefix = '',
  ...props
}: Partial<
  Pick<
    RegistryGridProps<Row>,
    | 'rows'
    | 'isLoading'
    | 'rowSelection'
    | 'onRowSelectionChange'
    | 'onRowClick'
    | 'getRowId'
  >
> & {
  report?: (id: string | undefined) => void
  followed?: string
  pending?: boolean
  labelPrefix?: string
}) {
  const bulk = useBulkSelection()

  return (
    <Suspense fallback={<p>Pending grid</p>}>
      <PaneContext
        value={{
          paneId: 'p',
          readOnly: false,
          reportNewer: () => {},
          reportFrozen: () => {},
          reportSelection: report ?? (() => {}),
          followedSelection: followed,
        }}
      >
        <output aria-label="Ticked IDs">{bulk.ids.join(',')}</output>
        <RegistryGrid
          label="Rows"
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          bulk={bulk}
          rowLabel={(row) => `${labelPrefix}${row.name}`}
          {...props}
        />
        <SuspendRender pending={pending} />
      </PaneContext>
    </Suspense>
  )
}

describe('RegistryGrid committed state', () => {
  it('retains the same selected-ID array when all IDs remain', () => {
    const { result } = renderHook(() => useBulkSelection())
    act(() => result.current.replace(['b', 'a']))
    const selected = result.current.ids
    act(() => result.current.retain(['a', 'b', 'c']))
    expect(result.current.ids).toBe(selected)
    act(() => result.current.retain(['a']))
    expect(result.current.ids).toEqual(['a'])
  })

  it('reports external selection and follows only a changed followed selection', async () => {
    const report = vi.fn()
    const initial = vi.fn()
    const current = vi.fn()

    const { rerender } = render(
      <LifecycleGrid
        report={report}
        rowSelection={{ a: true }}
        followed="b"
        onRowSelectionChange={initial}
      />,
    )

    await waitFor(() => expect(initial).toHaveBeenCalledWith({ b: true }))
    expect(report).toHaveBeenLastCalledWith('a')

    rerender(
      <LifecycleGrid
        report={report}
        rowSelection={{ b: true }}
        followed="b"
        onRowSelectionChange={current}
      />,
    )
    expect(report).toHaveBeenLastCalledWith('b')
    expect(current).not.toHaveBeenCalled()
    rerender(
      <LifecycleGrid
        report={report}
        rowSelection={{ b: true }}
        followed="a"
        onRowSelectionChange={current}
      />,
    )
    await waitFor(() =>
      expect(current).toHaveBeenCalledExactlyOnceWith({ a: true }),
    )
  })

  it('does not prune while loading, then prunes only disappeared records', async () => {
    const { getByLabelText, getByText, rerender } = render(<LifecycleGrid />)
    await startTicking(getByText('Alpha'))
    await userEvent.click(getByLabelText('Select Beta'))
    expect(getByLabelText('Ticked IDs').textContent).toBe('a,b')
    rerender(<LifecycleGrid rows={[]} isLoading />)
    expect(getByLabelText('Ticked IDs').textContent).toBe('a,b')
    rerender(<LifecycleGrid rows={[rows[1]]} />)
    expect(getByLabelText('Ticked IDs').textContent).toBe('b')
    rerender(<LifecycleGrid rows={[rows[1]]} />)
    expect(getByLabelText('Ticked IDs').textContent).toBe('b')
  })

  it('updates labels without remounting a focused checkbox', async () => {
    const { getByLabelText, getByText, rerender } = render(
      <LifecycleGrid labelPrefix="Old " />,
    )

    await startTicking(getByText('Beta'))

    const checkbox = getByLabelText('Select Old Alpha')
    checkbox.focus()
    rerender(<LifecycleGrid labelPrefix="New " />)
    expect(getByLabelText('Select New Alpha')).toBe(checkbox)
    expect(document.activeElement).toBe(checkbox)
  })

  it('does not publish callbacks, labels or linked selection from a suspended render', async () => {
    const committedClick = vi.fn()
    const abandonedClick = vi.fn()
    const report = vi.fn()
    const abandonedReport = vi.fn()
    const abandonedFollow = vi.fn()

    const { getByText, getByLabelText, rerender } = render(
      <LifecycleGrid
        onRowClick={committedClick}
        report={report}
        rowSelection={{ a: true }}
      />,
    )

    await startTicking(getByText('Beta'))
    await act(async () => {
      startTransition(() =>
        rerender(
          <LifecycleGrid
            pending
            labelPrefix="Uncommitted "
            getRowId={(row) => `pending-${row.id}`}
            onRowClick={abandonedClick}
            report={abandonedReport}
            followed="pending-b"
            onRowSelectionChange={abandonedFollow}
            rowSelection={{ b: true }}
          />,
        ),
      )
    })
    expect(getByLabelText('Select Alpha')).toBeTruthy()
    expect(abandonedReport).not.toHaveBeenCalled()
    expect(abandonedFollow).not.toHaveBeenCalled()
    await userEvent.click(getByText('Alpha'))
    expect(committedClick).toHaveBeenCalledExactlyOnceWith(rows[0])
    expect(abandonedClick).not.toHaveBeenCalled()
    await userEvent.click(getByLabelText('Select all rows'))
    expect(getByLabelText('Ticked IDs').textContent?.split(',').sort()).toEqual(
      ['a', 'b'],
    )
    rerender(
      <LifecycleGrid
        onRowClick={committedClick}
        report={report}
        rowSelection={{ a: true }}
      />,
    )
  })

  it('keeps roving row focus, Enter selection and the workspace Space shortcut', async () => {
    const onChange = vi.fn()

    const { container } = render(
      <LifecycleGrid onRowSelectionChange={onChange} />,
    )

    const first = container.querySelector<HTMLTableRowElement>(
      'tbody tr[data-index="0"]',
    )

    const second = container.querySelector<HTMLTableRowElement>(
      'tbody tr[data-index="1"]',
    )

    expect(first?.tabIndex).toBe(0)
    first?.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(second)
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith({ b: true })
    onChange.mockClear()
    await userEvent.keyboard(' ')
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(first)
  })
})

describe('registry native cell ordering', () => {
  it('retains asymmetric numbers, nonfinite subtraction and numeric collation', () => {
    expect(compareCells(9, 2)).toBe(7)
    expect(compareCells(2, 9)).toBe(-7)
    expect(compareCells(NaN, 4)).toBeNaN()
    expect(compareCells(Infinity, Infinity)).toBeNaN()
    expect(compareCells(-Infinity, 3)).toBe(-Infinity)
    expect(compareCells('sample-2', 'sample-10')).toBeLessThan(0)
    expect(compareCells('alpha', 'ALPHA')).toBe(0)
    expect(compareCells(null, '')).toBe(0)
  })

  it('coerces native objects left before right and propagates the first throw', () => {
    const order: string[] = []

    const left = {
      toString: () => {
        order.push('left')

        return 'z2'
      },
    }

    const right = {
      toString: () => {
        order.push('right')

        return 'z10'
      },
    }

    expect(compareCells(left, right)).toBeLessThan(0)
    expect(order).toEqual(['left', 'right'])
    order.length = 0
    const error = new Error('native coercion')
    expect(() =>
      compareCells(
        {
          toString: () => {
            order.push('throw')
            throw error
          },
        },
        right,
      ),
    ).toThrow(error)
    expect(order).toEqual(['throw'])
    order.length = 0
    expect(() =>
      compareCells(left, {
        toString: () => {
          order.push('throw')
          throw error
        },
      }),
    ).toThrow(error)
    expect(order).toEqual(['left', 'throw'])
  })
})
