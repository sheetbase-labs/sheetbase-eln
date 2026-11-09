import { describe, expect, it, vi } from 'vitest'

import { sweepStepTimers } from './step-timers.server'

describe('sweepStepTimers', () => {
  it('runs the database sweep and returns how many it notified', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ n: 2 }] })
    const end = vi.fn().mockResolvedValue(undefined)

    const notified = await sweepStepTimers({
      connect: async () => ({ query, end }),
    })

    expect(notified).toBe(2)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('internal.sweep_step_timers()'),
    )
    expect(end).toHaveBeenCalled()
  })

  it('closes the connection when the sweep fails', async () => {
    const end = vi.fn().mockResolvedValue(undefined)
    await expect(
      sweepStepTimers({
        connect: async () => ({
          query: vi.fn().mockRejectedValue(new Error('down')),
          end,
        }),
      }),
    ).rejects.toThrow('down')
    expect(end).toHaveBeenCalled()
  })
})
