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
})
