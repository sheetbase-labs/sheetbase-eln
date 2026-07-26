import { describe, expect, it } from 'vitest'

import { groupCommentsIntoThreads, threadState } from './comments-data'
import type { CommentWire } from './comments-data'

function wire(partial: Partial<CommentWire>): CommentWire {
  return {
    id: 'c1',
    workspace_id: 'ws',
    revision_id: 'rev',
    record_id: 'rec',
    root_id: 'c1',
    parent_id: null,
    target_kind: 'revision',
    target: {},
    body: 'body',
    mentions: [],
    state: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    author_user_id: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('groupCommentsIntoThreads', () => {
  it('groups replies under their root and orders oldest-first', () => {
    const rows = [
      wire({ id: 'r2', root_id: 'r2', created_at: '2026-01-02T00:00:00Z' }),
      wire({ id: 'r1', root_id: 'r1', created_at: '2026-01-01T00:00:00Z' }),
      wire({
        id: 'a1',
        root_id: 'r1',
        parent_id: 'r1',
        created_at: '2026-01-01T01:00:00Z',
      }),
      wire({
        id: 'a2',
        root_id: 'r1',
        parent_id: 'a1',
        created_at: '2026-01-01T00:30:00Z',
      }),
    ]
    const threads = groupCommentsIntoThreads(rows)
    expect(threads.map((t) => t.root.id)).toEqual(['r1', 'r2'])
    expect(threads[0].replies.map((r) => r.id)).toEqual(['a2', 'a1'])
  })

  it('threadState reflects the root comment state', () => {
    const open = groupCommentsIntoThreads([
      wire({ id: 'r1', root_id: 'r1', state: 'open' }),
    ])
    const resolved = groupCommentsIntoThreads([
      wire({
        id: 'r1',
        root_id: 'r1',
        state: 'resolved',
        resolved_at: '2026-01-01T00:00:00Z',
      }),
    ])
    expect(threadState(open[0])).toBe('open')
    expect(threadState(resolved[0])).toBe('resolved')
  })

  it('treats a missing target object as an empty object', () => {
    const rows = [
      wire({
        id: 'r1',
        root_id: 'r1',
        target: undefined,
      }),
    ]
    const threads = groupCommentsIntoThreads(rows)
    expect(threads[0].root.target).toEqual({})
  })
})
