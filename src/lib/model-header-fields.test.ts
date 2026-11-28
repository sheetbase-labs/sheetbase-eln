import { describe, expect, it } from 'vitest'

import {
  headerFieldCount,
  headerFieldsOf,
  withHeaderFacts,
} from './model-header-fields'

const field = (name: string, order: number, extra = {}) => ({
  name,
  displayOrder: order,
  lifecycle: 'active',
  ...extra,
})

describe('a model’s header fields', () => {
  it('takes the chosen live fields in the model’s order, at most four', () => {
    const fields = [
      field('e', 5, { showInHeader: true }),
      field('a', 1, { showInHeader: true }),
      field('x', 0),
      field('r', 2, { showInHeader: true, lifecycle: 'retired' }),
      field('b', 3, { showInHeader: true }),
      field('c', 4, { showInHeader: true }),
      field('d', 6, { showInHeader: true }),
    ]

    expect(headerFieldsOf(fields).map((f) => f.name)).toEqual([
      'a',
      'b',
      'c',
      'e',
    ])
  })

  it('counts a draft’s chosen fields, leaving retired ones out', () => {
    expect(
      headerFieldCount([
        { show_in_header: true, lifecycle: 'active' },
        { show_in_header: true, lifecycle: 'retired' },
        { lifecycle: 'active' },
      ]),
    ).toBe(1)
  })

  it('puts the model’s facts first and fills the rest of the room', () => {
    expect(withHeaderFacts(['m1', 'm2'], ['type', 'project', 'owner'])).toEqual(
      ['m1', 'm2', 'type', 'project'],
    )
    expect(withHeaderFacts([], ['type', 'owner'])).toEqual(['type', 'owner'])
  })
})
