/**
 * In linked panes a grid reports the row it has selected and takes the row the
 * pane it follows selects, when it has that row.
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaneContext } from '#/components/workspace/workspace-navigation'
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
