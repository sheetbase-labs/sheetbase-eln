import { describe, expect, it } from 'vitest'

import { formatQueues, parseQueues } from './queues'

describe('queues a steward types', () => {
  it('reads names with and without a longest job', () => {
    expect(parseQueues('hpc-short:60, gpu.a100:2880, bigmem')).toEqual([
      { name: 'hpc-short', maxMinutes: 60 },
      { name: 'gpu.a100', maxMinutes: 2880 },
      { name: 'bigmem' },
    ])
  })

  it('refuses a bad name, a bad limit, a repeat and nothing at all', () => {
    expect(parseQueues('Bad Name')).toBeNull()
    expect(parseQueues('a:0')).toBeNull()
    expect(parseQueues('a:1:2')).toBeNull()
    expect(parseQueues('a, a')).toBeNull()
    expect(parseQueues(' , ')).toBeNull()
  })

  it('writes them back the way they were typed', () => {
    const text = 'hpc-short:60, bigmem'

    expect(formatQueues(parseQueues(text) ?? [])).toBe(text)
  })
})
