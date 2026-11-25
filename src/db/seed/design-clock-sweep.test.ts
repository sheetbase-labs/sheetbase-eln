import { describe, expect, it } from 'vitest'

import { retryOnLockClash } from './design-clock-sweep'

function failure(code: string) {
  return new Error('Failed query', {
    cause: Object.assign(new Error('x'), { code }),
  })
}

describe('retryOnLockClash', () => {
  it('tries again after a deadlock and stops once it works', async () => {
    let calls = 0
    await retryOnLockClash(
      async () => {
        calls++

        if (calls < 3) throw failure('40P01')
      },
      4,
      0,
    )
    expect(calls).toBe(3)
  })

  it('does not retry any other error, and gives up after the last try', async () => {
    let calls = 0
    await expect(
      retryOnLockClash(
        async () => {
          calls++
          throw failure('23505')
        },
        4,
        0,
      ),
    ).rejects.toThrow('Failed query')
    expect(calls).toBe(1)

    calls = 0
    await expect(
      retryOnLockClash(
        async () => {
          calls++
          throw failure('55P03')
        },
        3,
        0,
      ),
    ).rejects.toThrow('Failed query')
    expect(calls).toBe(3)
  })
})
