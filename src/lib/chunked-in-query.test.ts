import { describe, expect, it } from 'vitest'

import { mergeChunkedRows, splitLongInQuery } from './chunked-in-query'

const ids = Array.from(
  { length: 40 },
  (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
)

describe('splitLongInQuery', () => {
  it('leaves short queries alone', () => {
    expect(splitLongInQuery('?id=in.(a,b)&select=id')).toBeNull()
  })

  it('splits one long in-list and keeps the other parameters', () => {
    const query = `?link_type=eq.upstream&source_record_id=in.(${ids.join(',')})&select=source_record_id`
    const groups = splitLongInQuery(query)

    expect(groups).not.toBeNull()
    expect(groups?.length).toBe(4)

    for (const group of groups ?? []) {
      const params = new URLSearchParams(group.slice(1))

      expect(params.get('link_type')).toBe('eq.upstream')
      expect(params.get('select')).toBe('source_record_id')
      expect((params.get('source_record_id') ?? '').length).toBeLessThan(500)
    }

    const joined = (groups ?? [])
      .map((g) => new URLSearchParams(g.slice(1)).get('source_record_id'))
      .map((v) => (v ?? '').slice(4, -1))
      .join(',')

    expect(joined).toBe(ids.join(','))
  })
})

describe('mergeChunkedRows', () => {
  it('restores the requested order and limit', () => {
    const rows = mergeChunkedRows('?order=n.desc&limit=3', [
      [{ n: 1 }, { n: 4 }],
      [{ n: 3 }, { n: 2 }],
    ])

    expect(rows).toEqual([{ n: 4 }, { n: 3 }, { n: 2 }])
  })
})
