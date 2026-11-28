/**
 * Every list's Sort and Group menus come from its own columns and rows: a
 * column with a value sorts, a column whose values repeat groups, and nothing
 * is listed per page.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useListArrange } from './list-arrange'
import { isBand } from './registry-grid-data'
import type { RegistryColumn } from './registry-grid-data'

interface Row {
  id: string
  name: string
  status: string
  summary: string
  updated: string
}

const rows: Row[] = [
  {
    id: 'A-1',
    name: 'Beta',
    status: 'Open',
    summary: 'A long note about what happened on the bench that morning',
    updated: '2026-09-02',
  },
  {
    id: 'A-2',
    name: 'Alpha',
    status: 'Closed',
    summary: 'Another long note, written in full sentences by the person',
    updated: '2026-09-03',
  },
  {
    id: 'A-3',
    name: 'Gamma',
    status: 'Open',
    summary: 'A third long note that reads as prose rather than a category',
    updated: '2026-09-01',
  },
]

const columns: RegistryColumn<Row>[] = [
  { id: 'id', header: 'ID', accessorFn: (r) => r.id },
  { id: 'name', header: 'Name', accessorFn: (r) => r.name },
  { id: 'status', header: 'Status', accessorFn: (r) => r.status },
  { id: 'summary', header: 'Summary', accessorFn: (r) => r.summary },
  { id: 'updated', header: 'Updated', accessorFn: (r) => r.updated },
  { id: 'actions', header: '', cell: () => null },
]

describe('useListArrange', () => {
  it('offers every named column with a value as a sort', () => {
    const { result } = renderHook(() => useListArrange({ rows, columns }))

    expect(result.current.sort.options.map((o) => o.value)).toEqual([
      'id',
      'name',
      'status',
      'summary',
      'updated',
    ])
  })

  it('groups only by columns whose values repeat, never names, dates or prose', () => {
    const { result } = renderHook(() => useListArrange({ rows, columns }))

    expect(result.current.group.options.map((o) => o.value)).toEqual(['status'])
  })

  it('draws a band above each group, in the order the groups first appear', () => {
    const { result } = renderHook(() => useListArrange({ rows, columns }))

    act(() => result.current.group.onChange('status'))

    expect(
      result.current.rows.map((row) => (isBand(row) ? row.__band : row.id)),
    ).toEqual(['Open', 'A-1', 'A-3', 'Closed', 'A-2'])
  })

  it('starts a date newest first and text from A', () => {
    const { result } = renderHook(() => useListArrange({ rows, columns }))

    act(() => result.current.sort.onChange('updated'))
    expect(result.current.view.sorting).toEqual([{ id: 'updated', desc: true }])

    act(() => result.current.sort.onChange('name'))
    expect(result.current.view.sorting).toEqual([{ id: 'name', desc: false }])
  })

  it('orders the rows inside each group by the chosen sort', () => {
    const { result } = renderHook(() => useListArrange({ rows, columns }))

    act(() => result.current.group.onChange('status'))
    act(() => result.current.sort.onChange('name'))

    expect(
      result.current.rows.map((row) => (isBand(row) ? row.__band : row.name)),
    ).toEqual(['Open', 'Beta', 'Gamma', 'Closed', 'Alpha'])
  })
})
