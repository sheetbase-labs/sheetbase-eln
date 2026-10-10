/**
 * REV-01.3 — private reviewer comment drafts.
 *
 * While a review is active, a reviewer's comments are drafted privately: they
 * are held against the revision the reviewer is reading (never written to
 * `api.comments`) so the author cannot see them, and are only published in the
 * same action as the return decision ("Return with N comments"). Once the
 * submission is returned, the author sees the sent comments and can resolve or
 * reply to them like any other anchored thread.
 *
 * Drafts are per (revision, reviewer) and survive a reload via `localStorage`,
 * but they are never sent to the database until the return. The decision RPC
 * is taken first so a refused return (stale digest, superseded revision, lost
 * permission) can never publish a private draft to the author.
 */
import * as React from 'react'

import type { CommentTarget, CommentTargetKind } from './comments-data'
import type { DataClient } from './data-client'
import type {
  ReviewDecisionInput,
  ReviewDecisionResult,
} from './review-workspace'

/** A reviewer's private comment that has not been sent to the author yet. */
export interface ReviewCommentDraft {
  /** Client-generated id, stable while the draft is edited or deleted. */
  id: string
  targetKind: CommentTargetKind
  target: CommentTarget
  body: string
  createdAt: string
}

/** The number of drafts a return would carry. */
export function draftCommentCount(drafts: ReviewCommentDraft[]): number {
  return drafts.length
}

/**
 * The decision-button label for returning: "Return with 1 comment",
 * "Return with 3 comments", or the bare "Return with comments" when empty.
 */
export function returnWithCommentsLabel(count: number): string {
  if (count <= 0) return 'Return with comments'
  return `Return with ${count} comment${count === 1 ? '' : 's'}`
}

/** Create a new draft for a target the reviewer picked. */
export function newDraft(
  input: {
    targetKind: CommentTargetKind
    target: CommentTarget
    body: string
  },
  now: () => string = () => new Date().toISOString(),
  generateId: () => string = defaultDraftId,
): ReviewCommentDraft {
  return {
    id: generateId(),
    targetKind: input.targetKind,
    target: input.target,
    body: input.body.trim(),
    createdAt: now(),
  }
}

/** Append a draft, ignoring an empty body. */
export function addDraft(
  drafts: ReviewCommentDraft[],
  draft: ReviewCommentDraft,
): ReviewCommentDraft[] {
  if (!draft.body.trim()) return drafts
  return [...drafts, draft]
}

/** Replace a draft's body (empty bodies are kept so the reviewer can keep editing). */
export function updateDraftBody(
  drafts: ReviewCommentDraft[],
  id: string,
  body: string,
): ReviewCommentDraft[] {
  return drafts.map((draft) => (draft.id === id ? { ...draft, body } : draft))
}

/** Remove a draft by id. */
export function removeDraft(
  drafts: ReviewCommentDraft[],
  id: string,
): ReviewCommentDraft[] {
  return drafts.filter((draft) => draft.id !== id)
}

function defaultDraftId(): string {
  try {
    return `draft-${globalThis.crypto.randomUUID()}`
  } catch {
    return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

// ---------------------------------------------------------------------------
// Persistence. The reviewer's drafts outlive a reload but never leave the
// reviewer's browser until the return publishes them.
// ---------------------------------------------------------------------------

export interface DraftStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export function draftStorageKey(revisionId: string, userId: string): string {
  return `sheetbase:review-comment-drafts:${revisionId}:${userId}`
}

function resolveDraftStorage(): DraftStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** Read the reviewer's drafts for a revision, tolerating corrupt storage. */
export function loadDrafts(
  storage: DraftStorage | null,
  revisionId: string,
  userId: string,
): ReviewCommentDraft[] {
  if (!storage) return []
  const raw = storage.getItem(draftStorageKey(revisionId, userId))
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDraft)
  } catch {
    return []
  }
}

function isDraft(value: unknown): value is ReviewCommentDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  return (
    typeof draft.id === 'string' &&
    typeof draft.body === 'string' &&
    typeof draft.targetKind === 'string' &&
    typeof draft.target === 'object' &&
    draft.target !== null
  )
}

/** Persist the reviewer's drafts for a revision. */
export function saveDrafts(
  storage: DraftStorage | null,
  revisionId: string,
  userId: string,
  drafts: ReviewCommentDraft[],
): void {
  if (!storage) return
  storage.setItem(draftStorageKey(revisionId, userId), JSON.stringify(drafts))
}

/** Drop the reviewer's drafts once they have been published. */
export function clearDrafts(
  storage: DraftStorage | null,
  revisionId: string,
  userId: string,
): void {
  if (!storage) return
  storage.removeItem(draftStorageKey(revisionId, userId))
}

// ---------------------------------------------------------------------------
// Publishing. Publishing happens in the same action as the return decision.
// ---------------------------------------------------------------------------

export interface ReturnWithCommentsResult {
  decision: ReviewDecisionResult
  publishedCommentIds: string[]
}

/**
 * Return a submission carrying the reviewer's private drafts.
 *
 * One server call does both, in one transaction: `return_revision_with_comments`
 * takes the return decision and then publishes the drafts as ordinary anchored
 * comments the author can resolve or reply to. A refused return therefore leaves
 * the drafts private, and a returned review can never be missing its comments.
 */
export async function returnWithDraftComments(
  client: DataClient,
  input: {
    revisionId: string
    drafts: ReviewCommentDraft[]
    decision: ReviewDecisionInput
  },
): Promise<ReturnWithCommentsResult> {
  const result = await client.rpc<{
    decision: ReviewDecisionResult
    commentIds: string[]
  }>('return_revision_with_comments', {
    p_submission_id: input.decision.submissionId,
    p_note: input.decision.note ?? null,
    p_expected_state: input.decision.expectedState ?? 'submitted',
    p_expected_revision_digest: input.decision.expectedRevisionDigest,
    p_comments: input.drafts.map((draft) => ({
      targetKind: draft.targetKind,
      target: draft.target,
      body: draft.body,
    })),
  })
  return {
    decision: result.decision,
    publishedCommentIds: result.commentIds ?? [],
  }
}

// ---------------------------------------------------------------------------
// React binding used by the review workspace.
// ---------------------------------------------------------------------------

export interface ReviewCommentDrafts {
  drafts: ReviewCommentDraft[]
  count: number
  addDraft: (input: {
    targetKind: CommentTargetKind
    target: CommentTarget
    body: string
  }) => ReviewCommentDraft | null
  updateBody: (id: string, body: string) => void
  remove: (id: string) => void
  clear: () => void
}

/**
 * Hold a reviewer's private drafts for one revision. Effects that persist are
 * skipped entirely when `enabled` is false, so an author or an inactive review
 * never writes the reviewer's draft key.
 */
export function useReviewCommentDrafts({
  revisionId,
  userId,
  enabled,
}: {
  revisionId: string
  userId: string
  enabled: boolean
}): ReviewCommentDrafts {
  const [drafts, setDrafts] = React.useState<ReviewCommentDraft[]>([])
  const storageKey = draftStorageKey(revisionId, userId)
  const hydratedKey = React.useRef<string | null>(null)

  // Persist runs before hydration so the first commit (still holding the empty
  // initial list) cannot overwrite stored drafts for this reviewer.
  React.useEffect(() => {
    if (!enabled || hydratedKey.current !== storageKey) return
    saveDrafts(resolveDraftStorage(), revisionId, userId, drafts)
  }, [revisionId, userId, enabled, storageKey, drafts])

  React.useEffect(() => {
    setDrafts(
      enabled ? loadDrafts(resolveDraftStorage(), revisionId, userId) : [],
    )
    hydratedKey.current = enabled ? storageKey : null
  }, [revisionId, userId, enabled, storageKey])

  const add = React.useCallback(
    (input: {
      targetKind: CommentTargetKind
      target: CommentTarget
      body: string
    }) => {
      if (!input.body.trim()) return null
      const draft = newDraft(input)
      setDrafts((current) => addDraft(current, draft))
      return draft
    },
    [],
  )

  const updateBody = React.useCallback((id: string, body: string) => {
    setDrafts((current) => updateDraftBody(current, id, body))
  }, [])

  const remove = React.useCallback((id: string) => {
    setDrafts((current) => removeDraft(current, id))
  }, [])

  const clear = React.useCallback(() => {
    setDrafts([])
    clearDrafts(resolveDraftStorage(), revisionId, userId)
  }, [revisionId, userId])

  return {
    drafts,
    count: draftCommentCount(drafts),
    addDraft: add,
    updateBody,
    remove,
    clear,
  }
}
