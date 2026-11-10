/**
 * QA4-Shell-Badge — the shell's counts, and what they state when a read fails.
 * An Inbox count that could not be read is *unknown* (`null`), which is not
 * zero: the badge renders no number for it, while the counts that did read
 * still render.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getShellCounts } from './shell-counts.server'

const { connect, release, connectionQuery, query } = vi.hoisted(() => {
  const releaseMock = vi.fn()
  const connectionQueryMock = vi.fn()
  const queryMock = vi.fn()

  return {
    release: releaseMock,
    connectionQuery: connectionQueryMock,
    connect: vi.fn(async () => ({
      query: connectionQueryMock,
      release: releaseMock,
    })),
    query: queryMock,
  }
})

// oxlint-disable-next-line anti-slop/no-module-mocking -- getShellCounts reads the shared pool directly and takes no client or reader parameter, so the pool is the only seam this unit test can stand in at; the double dispatches on the same SQL the real reads issue.
vi.mock('#/db/client.server', () => ({ db: { $client: { connect, query } } }))

const WORKSPACE = '00000000-0000-4000-8000-000000004a0a'
const USER = 'shell-count-user'

/** The two read-model counts the shell reads beside the Inbox count. */
function answerCounts(flags: number, failed: number) {
  query.mockImplementation(async (sql: string) =>
    sql.includes('dataset_value_flags')
      ? { rows: [{ n: String(flags) }] }
      : { rows: [{ n: String(failed) }] },
  )
}

/** What the Inbox read answers: a count, or the error that stands in for a failed read. */
function answerInbox(total: number | Error) {
  connectionQuery.mockImplementation(async (sql: string) => {
    if (!sql.includes('inbox_needs_action_counts')) return { rows: [] }

    if (total instanceof Error) throw total

    return { rows: [{ total, reviews: 0 }] }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  answerCounts(2, 1)
  answerInbox(253)
})

describe('getShellCounts', () => {
  it('states every count that read', async () => {
    expect(await getShellCounts(WORKSPACE, USER)).toEqual({
      inbox: '253',
      datasets: '2 errors',
      pipelines: '1 failed',
    })
    expect(release).toHaveBeenCalledOnce()
  })

  it('states a failed inbox read as unknown, and still states the counts that read', async () => {
    answerInbox(new Error('down'))
    const counts = await getShellCounts(WORKSPACE, USER)
    expect(counts).toEqual({
      inbox: null,
      datasets: '2 errors',
      pipelines: '1 failed',
    })
    // A zero is a number the badge would state; unknown is not.
    expect(counts.inbox).not.toBe('0')
    expect(release).toHaveBeenCalledOnce()
  })

  it('keeps a successful zero an absent count, as the badge always had', async () => {
    answerInbox(0)
    const counts = await getShellCounts(WORKSPACE, USER)
    expect('inbox' in counts).toBe(false)
    expect(counts).toEqual({ datasets: '2 errors', pipelines: '1 failed' })
  })
  it('reads the dataset and pipeline counts without waiting for the Inbox', async () => {
    let releaseInbox: () => void = () => {}

    connect.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseInbox = resolve
      })

      return { query: connectionQuery, release }
    })
    const pending = getShellCounts(WORKSPACE, USER)
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    releaseInbox()
    expect(await pending).toEqual({
      inbox: '253',
      datasets: '2 errors',
      pipelines: '1 failed',
    })
  })
})
