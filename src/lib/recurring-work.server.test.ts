import { describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { sweepRecurringWork } from './recurring-work.server'
import type { RecurringConnection } from './recurring-work.server'

/** What `api.materialise_recurring_schedule` answers for one schedule. */
interface MaterialisedCounts {
  created: number
  skipped: number
  failed: number
}

function connection(
  schedules: QueryResultRow[],
  materialise: (id: string) => MaterialisedCounts,
) {
  const calls: { text: string; values?: unknown[] }[] = []

  const conn: RecurringConnection = {
    query: async <Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ) => {
      calls.push({ text, values })

      if (text.includes('FROM api.recurring_schedules')) {
        // SAFETY: the sweep asks for DueSchedule rows on this read, and the
        // fixture schedules carry exactly those three fields.
        return { rows: schedules as Row[] }
      }

      if (text.includes('materialise_recurring_schedule')) {
        // SAFETY: the sweep asks for the materialise answer, which is the
        // counts object this fixture returns for the schedule id it is given.
        const counts: QueryResultRow = {
          r: materialise(z.string().parse(values?.[0])),
        }

        // SAFETY: the sweep asks for one answer row, and this fixture answers
        // with the single counts object it just built.
        return { rows: [counts] as Row[] }
      }

      return { rows: [] }
    },
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
      .map((c) => JSON.parse(z.string().parse(c.values?.[0])))

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
