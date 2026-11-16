import { describe, expect, it } from 'vitest'

import { packShards } from '../timed-sequencer'

const files = Array.from({ length: 40 }, (_, i) => `tests/db/f${i}.test.ts`)
const seconds = (file: string) => (Number(/\d+/.exec(file)?.[0]) % 7) * 10 + 1

describe('packShards', () => {
  it('runs every file in exactly one shard', () => {
    for (const count of [1, 2, 3, 4, 7]) {
      const all = packShards(files, seconds, count).flat()

      expect(all).toHaveLength(files.length)
      expect(new Set(all)).toEqual(new Set(files))
    }
  })

  it('gives the same shards whatever order the files arrive in', () => {
    expect(packShards([...files].reverse(), seconds, 3)).toEqual(
      packShards(files, seconds, 3),
    )
  })

  it('spreads the long files instead of grouping them', () => {
    const long = ['a', 'b', 'c'].map((n) => `tests/db/${n}-long.test.ts`)
    const short = files.slice(0, 30)
    const time = (file: string) => (file.includes('long') ? 300 : 5)
    const shards = packShards([...long, ...short], time, 3)

    for (const shard of shards)
      expect(shard.filter((file) => file.includes('long'))).toHaveLength(1)
  })
})
