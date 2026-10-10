/**
 * REV-01.3 — private reviewer comment drafts.
 *
 * Proves a draft is held outside the database (so it is not visible to the
 * author as a sent comment), that returning takes the decision first and then
 * publishes every draft together, and that a refused return publishes nothing.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import {
  addDraft,
  clearDrafts,
  draftCommentCount,
  draftStorageKey,
  loadDrafts,
  newDraft,
  removeDraft,
  returnWithCommentsLabel,
  returnWithDraftComments,
  saveDrafts,
  updateDraftBody,
  useReviewCommentDrafts,
} from './review-comment-drafts'
import type { DraftStorage } from './review-comment-drafts'

afterEach(() => cleanup())

const DIGEST = 'a'.repeat(64)

function fakeStorage(): DraftStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

function fakeClient(overrides?: {
  rpc?: (name: string, args?: unknown) => Promise<unknown>
}): DataClient {
  const rpc = vi.fn(
    overrides?.rpc ??
      ((name: string, args?: unknown) =>
        name === 'return_revision_with_comments'
          ? Promise.resolve({
              decision: {
                submissionId: 'sub-1',
                revisionId: 'rev-1',
                decision: 'request_changes',
                state: 'returned',
                decisionId: 'dec-1',
                createdAt: '2026-10-10T00:00:00.000Z',
              },
              commentIds: (
                (args as { p_comments?: unknown[] }).p_comments ?? []
              ).map((_, index) => `comment-${index + 1}`),
            })
          : Promise.resolve({ id: 'comment-1' })),
  )
  return { list: vi.fn(async () => []), rpc } as unknown as DataClient
}

describe('returnWithCommentsLabel', () => {
  it('names the exact count the return carries', () => {
    expect(returnWithCommentsLabel(1)).toBe('Return with 1 comment')
    expect(returnWithCommentsLabel(3)).toBe('Return with 3 comments')
    expect(returnWithCommentsLabel(0)).toBe('Return with comments')
  })
})

describe('draft list operations', () => {
  it('counts drafts and drops an empty draft', () => {
    const draft = newDraft({ targetKind: 'revision', target: {}, body: '  ' })
    expect(addDraft([], draft)).toEqual([])
    const real = newDraft({
      targetKind: 'block',
      target: { blockId: 'b1' },
      body: 'tighten the method',
    })
    const drafts = addDraft([], real)
    expect(draftCommentCount(drafts)).toBe(1)
    expect(removeDraft(drafts, real.id)).toEqual([])
  })

  it('edits a draft body in place', () => {
    const draft = newDraft({ targetKind: 'revision', target: {}, body: 'one' })
    expect(updateDraftBody([draft], draft.id, 'two')[0].body).toBe('two')
  })
})

describe('draft persistence', () => {
  it('round-trips drafts per revision and reviewer, and clears them', () => {
    const storage = fakeStorage()
    const draft = newDraft({
      targetKind: 'revision',
      target: {},
      body: 'private note',
    })
    saveDrafts(storage, 'rev-1', 'reviewer-a', [draft])
    expect(loadDrafts(storage, 'rev-1', 'reviewer-a')).toEqual([draft])
    // A different reviewer or revision must never see these drafts.
    expect(loadDrafts(storage, 'rev-1', 'reviewer-b')).toEqual([])
    expect(loadDrafts(storage, 'rev-2', 'reviewer-a')).toEqual([])
    clearDrafts(storage, 'rev-1', 'reviewer-a')
    expect(storage.values.has(draftStorageKey('rev-1', 'reviewer-a'))).toBe(
      false,
    )
  })

  it('tolerates corrupt storage', () => {
    const storage = fakeStorage()
    storage.setItem(draftStorageKey('rev-1', 'reviewer-a'), 'not json')
    expect(loadDrafts(storage, 'rev-1', 'reviewer-a')).toEqual([])
  })
})

describe('returnWithDraftComments', () => {
  it('keeps drafts private until the return, then publishes them together', async () => {
    const client = fakeClient()
    const rpc = client.rpc as unknown as ReturnType<typeof vi.fn>
    const draft = newDraft({
      targetKind: 'revision',
      target: {},
      body: 'add the per-flask values',
    })

    // Drafting alone never touches the database: nothing is a sent comment yet.
    expect(rpc).not.toHaveBeenCalled()

    const result = await returnWithDraftComments(client, {
      revisionId: 'rev-1',
      drafts: [draft],
      decision: {
        submissionId: 'sub-1',
        note: 'please address',
        expectedRevisionDigest: DIGEST,
      },
    })

    // One transaction: the return and its comments cannot come apart, so a
    // refused return cannot leak a draft and a returned review cannot be
    // missing its comments.
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'return_revision_with_comments',
    ])
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_submission_id: 'sub-1',
      p_note: 'please address',
      p_expected_state: 'submitted',
      p_expected_revision_digest: DIGEST,
      p_comments: [
        {
          targetKind: 'revision',
          target: {},
          body: 'add the per-flask values',
        },
      ],
    })
    expect(result.publishedCommentIds).toHaveLength(1)
  })

  it('publishes nothing when the return is refused', async () => {
    const client = fakeClient({
      rpc: () =>
        Promise.reject(new Error('revision integrity digest mismatch')),
    })
    const rpc = client.rpc as unknown as ReturnType<typeof vi.fn>
    const draft = newDraft({
      targetKind: 'revision',
      target: {},
      body: 'do not leak me',
    })

    await expect(
      returnWithDraftComments(client, {
        revisionId: 'rev-1',
        drafts: [draft],
        decision: { submissionId: 'sub-1', expectedRevisionDigest: DIGEST },
      }),
    ).rejects.toThrow(/digest mismatch/)

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'return_revision_with_comments',
    ])
  })

  it('carries every draft in one return, in order', async () => {
    const client = fakeClient()
    const rpc = client.rpc as unknown as ReturnType<typeof vi.fn>
    const drafts = ['first', 'second', 'third'].map((body) =>
      newDraft({ targetKind: 'revision', target: {}, body }),
    )
    const result = await returnWithDraftComments(client, {
      revisionId: 'rev-1',
      drafts,
      decision: { submissionId: 'sub-1', expectedRevisionDigest: DIGEST },
    })
    const payload = (rpc.mock.calls[0][1] as { p_comments: { body: string }[] })
      .p_comments
    expect(payload.map((comment) => comment.body)).toEqual([
      'first',
      'second',
      'third',
    ])
    expect(result.publishedCommentIds).toHaveLength(3)
  })
})

describe('useReviewCommentDrafts', () => {
  it('holds drafts privately per reviewer and restores them on reload', () => {
    window.localStorage.clear()
    const reviewer = renderHook(() =>
      useReviewCommentDrafts({
        revisionId: 'rev-1',
        userId: 'reviewer-a',
        enabled: true,
      }),
    )
    act(() => {
      reviewer.result.current.addDraft({
        targetKind: 'revision',
        target: {},
        body: 'private note',
      })
    })
    expect(reviewer.result.current.count).toBe(1)

    // The author (or any other reviewer) never sees this reviewer's drafts.
    const author = renderHook(() =>
      useReviewCommentDrafts({
        revisionId: 'rev-1',
        userId: 'owner-a',
        enabled: false,
      }),
    )
    expect(author.result.current.drafts).toEqual([])

    reviewer.unmount()
    const reloaded = renderHook(() =>
      useReviewCommentDrafts({
        revisionId: 'rev-1',
        userId: 'reviewer-a',
        enabled: true,
      }),
    )
    expect(reloaded.result.current.drafts[0]?.body).toBe('private note')

    act(() => reloaded.result.current.clear())
    expect(reloaded.result.current.count).toBe(0)
    expect(loadDrafts(window.localStorage, 'rev-1', 'reviewer-a')).toEqual([])
  })
})
