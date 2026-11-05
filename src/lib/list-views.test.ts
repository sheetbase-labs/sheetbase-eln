import { describe, expect, it } from 'vitest'

import { toListViewChoice } from './list-views'

describe('toListViewChoice', () => {
  it('has no choice when nothing is stored', () => {
    expect(toListViewChoice(undefined)).toEqual({ sorting: [], hidden: [] })
  })

  it('reads a stored sorting and hidden columns', () => {
    expect(
      toListViewChoice({
        sorting: [{ id: 'name', desc: true }],
        hidden_columns: ['type', 'location'],
      }),
    ).toEqual({
      sorting: [{ id: 'name', desc: true }],
      hidden: ['type', 'location'],
    })
  })

  it('treats anything malformed as no choice instead of breaking the table', () => {
    expect(
      toListViewChoice({
        sorting: [{ id: 5 }, null, 'x', { id: 'ok' }],
        hidden_columns: [1, 'type', null],
      }),
    ).toEqual({ sorting: [{ id: 'ok', desc: false }], hidden: ['type'] })
    expect(toListViewChoice({ sorting: 'x', hidden_columns: {} })).toEqual({
      sorting: [],
      hidden: [],
    })
  })
})
