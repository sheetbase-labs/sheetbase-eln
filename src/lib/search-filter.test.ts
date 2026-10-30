import { describe, expect, it } from 'vitest'
import type { GroupNode } from '@sheetbase-labs/sheetbase-shared'

import {
  andFilters,
  completeFilter,
  countConditions,
  decodeFilter,
  encodeFilter,
  filterToRpc,
  normaliseFilterParam,
  parseSearchSort,
  withoutNode,
} from './search-filter'

const tree: GroupNode = {
  type: 'group',
  id: 'root',
  combinator: 'AND',
  children: [
    {
      type: 'condition',
      id: 'a',
      field: 'status',
      operator: 'eq',
      value: 'approved',
    },
    {
      type: 'group',
      id: 'g',
      combinator: 'NOT',
      children: [
        {
          type: 'condition',
          id: 'b',
          field: 'project',
          operator: 'eq',
          value: 'p-1',
        },
      ],
    },
  ],
}

describe('filter URL value', () => {
  it('round-trips a tree with a None of group, without node ids', () => {
    const encoded = encodeFilter(tree)
    expect(encoded).toEqual({
      g: 'AND',
      k: [
        { f: 'status', o: 'eq', v: 'approved' },
        { g: 'NOT', k: [{ f: 'project', o: 'eq', v: 'p-1' }] },
      ],
    })
    const back = decodeFilter(encoded)
    expect(back?.combinator).toBe('AND')
    expect(back?.children[1]).toMatchObject({
      type: 'group',
      combinator: 'NOT',
    })
    expect(encodeFilter(back)).toEqual(encoded)
  })

  it('reads the value whether the router handed it over parsed or as text', () => {
    const encoded = encodeFilter(tree)
    expect(decodeFilter(JSON.stringify(encoded))).toEqual(decodeFilter(encoded))
  })

  it('drops links it cannot trust rather than breaking the page', () => {
    expect(decodeFilter('not json')).toBeUndefined()
    expect(decodeFilter({ g: 'XOR', k: [] })).toBeUndefined()
    expect(decodeFilter({ f: 'status', o: 'nope', v: 1 })).toBeUndefined()
    expect(normaliseFilterParam({ g: 'AND', k: [] })).toBeUndefined()
  })

  it('keeps to the depth and size the server accepts', () => {
    let deep: unknown = { f: 'status', o: 'eq', v: 'x' }
    for (let i = 0; i < 6; i += 1) deep = { g: 'AND', k: [deep] }
    expect(decodeFilter(deep)).toBeUndefined()
    const many = {
      g: 'AND',
      k: Array.from({ length: 60 }, (_, i) => ({
        f: 'tags',
        o: 'contains',
        v: `t${i}`,
      })),
    }
    expect(countConditions(decodeFilter(many) as GroupNode)).toBe(50)
  })
})

describe('filter tree helpers', () => {
  it('ANDs two trees and ignores an empty one', () => {
    const other = decodeFilter({
      g: 'AND',
      k: [{ f: 'tags', o: 'contains', v: 'x' }],
    })
    expect(countConditions(andFilters(tree, other) as GroupNode)).toBe(3)
    expect(andFilters(undefined, other)).toBe(other)
    expect(andFilters(undefined, undefined)).toBeUndefined()
  })

  it('removes a group as a unit', () => {
    const next = withoutNode(tree, 'g')
    expect(next && countConditions(next)).toBe(1)
    expect(withoutNode(tree, 'a')?.children).toHaveLength(1)
  })

  it('reads the sort, and treats anything else as relevance', () => {
    expect(parseSearchSort('updated')).toBe('updated')
    expect(parseSearchSort('created')).toBe('created')
    expect(parseSearchSort('x')).toBeUndefined()
  })
})

describe('filter sent to the search service', () => {
  it('has no node ids', () => {
    expect(JSON.stringify(filterToRpc(tree))).not.toContain('"id"')
  })

  it('sends a record kind named as a type to the kind field', () => {
    const typed = decodeFilter({
      g: 'AND',
      k: [{ f: 'type', o: 'eq', v: 'sample' }],
    })
    expect(filterToRpc(typed)).toEqual({
      type: 'group',
      combinator: 'AND',
      children: [
        { type: 'condition', field: 'kind', operator: 'eq', value: 'sample' },
      ],
    })
  })

  it('splits a mixed list of types between kind and type', () => {
    const typed = decodeFilter({
      g: 'AND',
      k: [{ f: 'type', o: 'in', v: ['sample', 'dataset'] }],
    })
    const sent = filterToRpc(typed)
    const or = sent?.type === 'group' ? sent.children[0] : undefined
    expect(or).toMatchObject({ type: 'group', combinator: 'OR' })
  })

  it('negates a kind with None of', () => {
    const typed = decodeFilter({
      g: 'AND',
      k: [{ f: 'type', o: 'neq', v: 'sample' }],
    })
    const sent = filterToRpc(typed)
    expect(sent?.type === 'group' && sent.children[0]).toMatchObject({
      type: 'group',
      combinator: 'NOT',
    })
  })

  it('sends nothing for an empty tree', () => {
    expect(filterToRpc(undefined)).toBeUndefined()
  })
})

describe('completeFilter', () => {
  const draft: GroupNode = {
    type: 'group',
    id: 'root',
    combinator: 'AND',
    children: [
      {
        type: 'group',
        id: 'g',
        combinator: 'OR',
        children: [
          {
            type: 'condition',
            id: 'blank',
            field: 'type',
            operator: 'eq',
            value: '',
          },
        ],
      },
    ],
  }

  it('is undefined while no condition has a value, so nothing is counted', () => {
    expect(completeFilter(draft)).toBeUndefined()
  })

  it('keeps finished conditions and operators that take no value', () => {
    const next: GroupNode = {
      ...draft,
      children: [
        ...draft.children,
        { type: 'condition', id: 'tags', field: 'tags', operator: 'isNull' },
        {
          type: 'condition',
          id: 'none',
          field: 'project',
          operator: 'in',
          value: [],
        },
        {
          type: 'condition',
          id: 'ok',
          field: 'status',
          operator: 'eq',
          value: 'approved',
        },
      ],
    }
    const done = completeFilter(next)
    expect(done?.children.map((c) => c.id)).toEqual(['tags', 'ok'])
  })
})
