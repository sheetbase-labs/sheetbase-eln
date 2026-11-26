import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isStaleChunkError,
  isStaleChunkReason,
  loadChunk,
  staleChunkMessage,
} from './stale-chunk'

describe('stale script files after a deploy', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('recognises the browser failures', () => {
    expect(
      isStaleChunkError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://x/assets/a.js',
        ),
      ),
    ).toBe(true)
    expect(isStaleChunkError(new Error('Object access denied'))).toBe(false)
  })

  it('retries once and returns the module', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new TypeError('Failed to fetch dynamically imported module: a.js'),
      )
      .mockResolvedValueOnce('ok')

    await expect(loadChunk(load)).resolves.toBe('ok')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('gives plain words when it still fails, never a file name', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(
        new TypeError('Failed to fetch dynamically imported module: a.js'),
      )

    const error = await loadChunk(load).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(isStaleChunkReason(String((error as Error).message))).toBe(true)
    expect(staleChunkMessage()).not.toContain('.js')
  })

  it('passes other failures straight through', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error('no'))

    await expect(loadChunk(load)).rejects.toThrow('no')
    expect(load).toHaveBeenCalledTimes(1)
  })
})
