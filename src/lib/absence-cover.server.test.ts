import { describe, expect, it, vi } from 'vitest'

import { sweepAbsenceCover } from './absence-cover.server'

describe('sweepAbsenceCover', () => {
  it('syncs cover for every workspace and reports how many reviews changed', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ changed: 3 }] })
    const end = vi.fn().mockResolvedValue(undefined)
    const changed = await sweepAbsenceCover({
      connect: async () => ({ query, end }),
    })
    expect(changed).toBe(3)
    expect(query).toHaveBeenCalledWith(
      'SELECT internal.sync_absence_cover(NULL) AS changed',
    )
    expect(end).toHaveBeenCalled()
  })

  it('closes the connection when the sweep fails', async () => {
    const end = vi.fn().mockResolvedValue(undefined)
    await expect(
      sweepAbsenceCover({
        connect: async () => ({
          query: vi.fn().mockRejectedValue(new Error('down')),
          end,
        }),
      }),
    ).rejects.toThrow('down')
    expect(end).toHaveBeenCalled()
  })
})
