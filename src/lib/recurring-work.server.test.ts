import { describe, expect, it, vi } from 'vitest'

import { sweepRecurringWork } from './recurring-work.server'
import type { RecurringConnection } from './recurring-work.server'

function connection(
  schedules: { id: string; workspace_id: string; created_by_user_id: string }[],
  materialise: (id: string) => unknown,
) {
  const calls: { text: string; values?: unknown[] }[] = []

  const conn: RecurringConnection = {
    query: ((text: string, values?: unknown[]) => {
      calls.push({ text, values })

      if (text.includes('FROM api.recurring_schedules'))
        return Promise.resolve({ rows: schedules })

      if (text.includes('materialise_recurring_schedule'))
        return Promise.resolve({
          rows: [{ r: materialise(values?.[0] as string) }],
        })

      return Promise.resolve({ rows: [] })
    }) as RecurringConnection['query'],
    end: vi.fn().mockResolvedValue(undefined),
  }

  return { conn, calls }
}

describe('sweepRecurringWork', () => {
  it('runs each active schedule as its creator in its own transaction', async () => {
    const { conn, calls } = connection(
      [
        { id: 's1', workspace_id: 'w1', created_by_user_id: 'u1' },
        { id: 's2', workspace_id: 'w2', created_by_user_id: 'u2' },
      ],
      (id) =>
        id === 's1'
          ? { created: 3, skipped: 1, failed: 0 }
          : { created: 2, skipped: 0, failed: 1 },
    )

    const result = await sweepRecurringWork({ connect: async () => conn })
    expect(result).toEqual({
      schedules: 2,
      created: 5,
      skipped: 1,
      failed: 1,
      errors: 0,
    })

    const claims = calls
      .filter((c) => c.text.includes('set_config'))
      .map((c) => JSON.parse(c.values![0] as string))

    expect(claims).toEqual([
      { role: 'authenticated', sub: 'u1', workspace_id: 'w1' },
      { role: 'authenticated', sub: 'u2', workspace_id: 'w2' },
    ])
    expect(calls.filter((c) => c.text === 'BEGIN')).toHaveLength(2)
    expect(calls.filter((c) => c.text === 'COMMIT')).toHaveLength(2)
    expect(conn.end).toHaveBeenCalled()
  })

  it('rolls back one failing schedule and carries on with the next', async () => {
    const { conn, calls } = connection(
      [
        { id: 's1', workspace_id: 'w1', created_by_user_id: 'u1' },
        { id: 's2', workspace_id: 'w1', created_by_user_id: 'u1' },
      ],
      (id) => {
        if (id === 's1') throw new Error('boom')

        return { created: 1, skipped: 0, failed: 0 }
      },
    )

    const warn = vi.fn()

    const result = await sweepRecurringWork(
      { connect: async () => conn },
      { warn },
    )

    expect(result).toMatchObject({ schedules: 2, created: 1, errors: 1 })
    expect(calls.some((c) => c.text === 'ROLLBACK')).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      'repeating work could not be made',
      expect.objectContaining({ scheduleId: 's1', error: 'boom' }),
    )
  })
})
