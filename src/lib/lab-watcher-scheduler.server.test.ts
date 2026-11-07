import { describe, expect, it, vi } from 'vitest'

import { sweepLabWatchers } from './lab-watcher-scheduler.server'

describe('sweepLabWatchers', () => {
  it('runs the due watchers and reports how many findings were new', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ found: 4 }] })
    const end = vi.fn().mockResolvedValue(undefined)
    const found = await sweepLabWatchers({
      connect: async () => ({ query, end }),
    })
    expect(found).toBe(4)
    expect(query).toHaveBeenCalledWith(
      'SELECT internal.run_due_lab_watchers() AS found',
    )
    expect(end).toHaveBeenCalled()
  })

  it('closes the connection when the sweep fails', async () => {
    const end = vi.fn().mockResolvedValue(undefined)
    await expect(
      sweepLabWatchers({
        connect: async () => ({
          query: vi.fn().mockRejectedValue(new Error('down')),
          end,
        }),
      }),
    ).rejects.toThrow('down')
    expect(end).toHaveBeenCalled()
  })
})
