import { describe, expect, it } from 'vitest'

import { checkFrameTable, sortFrameRows } from './frame-table'

const table = {
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'mass', label: 'Mass', align: 'right' },
  ],
  rows: [
    {
      id: 'a',
      cells: {
        name: { text: 'B', href: '/records/a' },
        mass: { text: '10', sort: 10 },
      },
    },
    { id: 'b', cells: { name: { text: 'A' }, mass: { text: '', sort: null } } },
    { id: 'c', cells: { name: { text: 'C' }, mass: { text: '9', sort: 9 } } },
  ],
}

describe('the table a plugin screen asks for', () => {
  it('keeps columns, rows and the cells it can draw', () => {
    const checked = checkFrameTable(table)
    expect(checked?.columns.map((c) => c.key)).toEqual(['name', 'mass'])
    expect(checked?.columns[1].align).toBe('right')
    expect(checked?.rows).toHaveLength(3)
    expect(checked?.rows[0].cells.name.href).toBe('/records/a')
  })

  it('drops a link that leaves the app, a script in a picture and a remote image', () => {
    const checked = checkFrameTable({
      columns: [{ key: 'x', label: 'X' }],
      rows: [
        {
          id: '1',
          cells: {
            x: {
              text: 'hi',
              href: 'https://evil.example/',
              image: 'https://evil.example/a.png',
              svg: '<svg><script>alert(1)</script></svg>',
            },
          },
        },
      ],
    })

    const cell = checked?.rows[0].cells.x
    expect(cell?.href).toBeUndefined()
    expect(cell?.image).toBeUndefined()
    expect(cell?.svg ?? '').not.toContain('script')
    expect(cell?.text).toBe('hi')
  })

  it('treats nothing, or a table without columns, as no table', () => {
    expect(checkFrameTable(null)).toBeNull()
    expect(checkFrameTable({ columns: [], rows: [] })).toBeNull()
    expect(checkFrameTable({ columns: {}, rows: [] })).toBeNull()
    expect(
      checkFrameTable({ columns: [{ key: 'x', label: 'X' }], rows: null }),
    ).toBeNull()
  })

  it('drops malformed rows and cell attributes independently without changing JSON nulls', () => {
    const checked = checkFrameTable({
      columns: [
        null,
        { key: 'x', label: 'X', align: 'left' },
        { key: 42, label: 'bad' },
      ],
      rows: [
        { id: 'bad', cells: [] },
        {
          id: 'a',
          cells: {
            x: {
              text: 'kept',
              shade: Infinity,
              sort: null,
              href: '//evil.example',
            },
          },
        },
        {
          id: 'b',
          cells: {
            x: {
              text: 42,
              shade: -3,
              sort: 's'.repeat(220),
              image: 'data:image/png;base64,YQ==',
            },
          },
        },
        { id: 'c', cells: { x: false } },
      ],
      sort: { key: 'x', descending: 'true' },
      empty: 42,
    })

    expect(checked).toEqual({
      columns: [{ key: 'x', label: 'X' }],
      rows: [
        { id: 'a', cells: { x: { text: 'kept', sort: null } } },
        {
          id: 'b',
          cells: {
            x: {
              shade: 0,
              sort: 's'.repeat(200),
              image: 'data:image/png;base64,YQ==',
            },
          },
        },
        { id: 'c', cells: { x: {} } },
      ],
      sort: { key: 'x', descending: false },
    })
  })

  it('sorts by the value a cell gives, with empty ones last either way', () => {
    const checked = checkFrameTable(table)!
    const up = sortFrameRows(checked.rows, { key: 'mass', descending: false })
    expect(up.map((r) => r.id)).toEqual(['c', 'a', 'b'])
    const down = sortFrameRows(checked.rows, { key: 'mass', descending: true })
    expect(down.map((r) => r.id)).toEqual(['a', 'c', 'b'])

    const byName = sortFrameRows(checked.rows, {
      key: 'name',
      descending: false,
    })

    expect(byName.map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('uses arithmetic for negative numeric keys and locale ordering for text', () => {
    const checked = checkFrameTable({
      columns: [{ key: 'value', label: 'Value' }],
      rows: [
        { id: 'near', cells: { value: { sort: -2, text: 'sample 10' } } },
        { id: 'far', cells: { value: { sort: -11, text: 'sample 2' } } },
        { id: 'blank', cells: { value: { sort: null } } },
      ],
    })

    expect(checked).not.toBeNull()

    if (!checked) throw new Error('expected a valid frame table')

    expect(
      sortFrameRows(checked.rows, { key: 'value', descending: false }).map(
        (row) => row.id,
      ),
    ).toEqual(['far', 'near', 'blank'])
    expect(
      sortFrameRows(checked.rows, { key: 'value', descending: true }).map(
        (row) => row.id,
      ),
    ).toEqual(['near', 'far', 'blank'])

    const text = checkFrameTable({
      columns: [{ key: 'value', label: 'Value' }],
      rows: [
        { id: 'ten', cells: { value: { sort: 'sample 10' } } },
        { id: 'two', cells: { value: { sort: 'sample 2' } } },
      ],
    })

    if (!text) throw new Error('expected a valid text table')
    expect(
      sortFrameRows(text.rows, { key: 'value', descending: false }).map(
        (row) => row.id,
      ),
    ).toEqual(['two', 'ten'])
  })
})
