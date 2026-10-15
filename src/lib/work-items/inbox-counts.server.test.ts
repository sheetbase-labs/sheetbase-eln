/**
 * QA4-Home-Count / QA4-Shell-Badge — the shell's Inbox count is the one
 * server-side count, read as the caller. A failed read is *unknown*: the badge
 * states no number rather than a zero it cannot back.
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

  it('reports a failed read as unknown, never as a confident zero', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('inbox_needs_action_counts')) throw new Error('down')
      return { rows: [] }
    })
    expect(await getInboxCounts(WORKSPACE, USER)).toBeNull()
    expect(query).toHaveBeenCalledWith('rollback')
    expect(release).toHaveBeenCalledOnce()
  })

  it('reports an answer with no row as unknown too, not as a zero', async () => {
    // The count function aggregates unconditionally, so it always answers one
    // row; an empty answer is a failed count, not a workspace with nothing in it.
    query.mockImplementation(async () => ({ rows: [] }))
    expect(await getInboxCounts(WORKSPACE, USER)).toBeNull()
    expect(query).toHaveBeenCalledWith('rollback')
    expect(release).toHaveBeenCalledOnce()
  })
})
