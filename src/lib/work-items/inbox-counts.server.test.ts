/**
 * QA4-Home-Count — the shell's Inbox count is the one server-side count, read
 * as the caller, and a failed read degrades to zero as the badge always has.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getInboxCounts } from './inbox-counts.server'

const { query, release, connect } = vi.hoisted(() => {
  const queryMock = vi.fn()
  const releaseMock = vi.fn()
  return {
    query: queryMock,
    release: releaseMock,
    connect: vi.fn(async () => ({ query: queryMock, release: releaseMock })),
  }
})
vi.mock('#/db/client.server', () => ({ db: { $client: { connect } } }))

const WORKSPACE = '00000000-0000-4000-8000-000000004a0a'
const USER = 'inbox-count-user'

beforeEach(() => {
  vi.clearAllMocks()
  query.mockImplementation(async (sql: string) =>
    sql.includes('inbox_needs_action_counts')
      ? { rows: [{ total: 253, reviews: 3 }] }
      : { rows: [] },
  )
})

describe('getInboxCounts', () => {
  it('reads the one server-side count as the caller, and reads no page of items', async () => {
    expect(await getInboxCounts(WORKSPACE, USER)).toEqual({
      total: 253,
      reviews: 3,
    })
    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'begin',
      'set local role authenticated',
      "select set_config('request.jwt.claims', $1, true)",
      'select total, reviews from api.inbox_needs_action_counts()',
      'commit',
    ])
    expect(JSON.parse(query.mock.calls[2][1][0])).toEqual({
      sub: USER,
      workspace_id: WORKSPACE,
      role: 'authenticated',
    })
    expect(release).toHaveBeenCalledOnce()
  })

  it('degrades a failed read to zero, as the badge always has', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('inbox_needs_action_counts')) throw new Error('down')
      return { rows: [] }
    })
    expect(await getInboxCounts(WORKSPACE, USER)).toEqual({
      total: 0,
      reviews: 0,
    })
    expect(query).toHaveBeenCalledWith('rollback')
    expect(release).toHaveBeenCalledOnce()
  })
})
