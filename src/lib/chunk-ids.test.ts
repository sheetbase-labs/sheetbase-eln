import { describe, expect, it } from 'vitest'

import { chunkIds, listByIds } from './chunk-ids'

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('chunkIds', () => {
  it('splits ids into groups of twelve', () => {
    const groups = chunkIds(Array.from({ length: 25 }, (_, i) => uuid(i)))
    expect(groups.map((g) => g.length)).toEqual([12, 12, 1])
  })
})

describe('listByIds', () => {
  it('reads every id in groups short enough for the proxy and joins the rows', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => uuid(i))
    const seen: string[] = []
    const rows = await listByIds(ids, async (inList) => {
      expect(inList.length).toBeLessThan(500)
      seen.push(inList)
      return inList.split(',')
    })
    expect(seen).toHaveLength(3)
    expect(rows).toEqual(ids)
  })

  it('reads nothing for no ids, and each id once', async () => {
    let reads = 0
    const read = async (inList: string) => {
      reads += 1
      return inList.split(',')
    }
    expect(await listByIds([], read)).toEqual([])
    expect(reads).toBe(0)
    expect(await listByIds([uuid(1), uuid(1)], read)).toEqual([uuid(1)])
  })
})
