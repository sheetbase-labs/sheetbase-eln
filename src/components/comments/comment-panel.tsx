import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus } from 'lucide-react'

import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import {
  commentsQueryKeys,
  createComment,
  createSheetComment,
  fetchCommentsForRecord,
  fetchCommentsForRevision,
  fetchCommentsForSheet,
  groupCommentsIntoThreads,
  reopenCommentThread,
  replyToComment,
  resolveCommentThread,
  threadState,
} from '#/lib/comments-data'
import type {
  CommentTarget,
  CommentTargetKind,
  CommentWire,
} from '#/lib/comments-data'
import type { SheetCommentAnchor } from '#/lib/sheet-comment-anchor'
import { notebookDataClient } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'

import { CommentThread } from './comment-thread'

/**
 * REV-004: the anchored-comments panel for a submitted revision. Lists
 * threads, lets a workspace member create a top-level comment anchored to the
 * supplied target, reply, resolve and reopen. Live updates arrive through the
 * existing change-event channel: the coordinator invalidates
 * `commentsQueryKeys.forRevision` on a `comment` event (see live-events.ts).
 */
export type CommentPanelProps = (
  | {
      revisionId: string
      targetKind: CommentTargetKind
      target: CommentTarget
      sheet?: never
      recordId?: never
    }
  | {
      revisionId?: never
      targetKind?: never
      target?: never
      sheet: { anchor: SheetCommentAnchor; expectedRevision: number }
      recordId?: never
    }
  | {
      recordId: string
      revisionId?: never
      targetKind?: never
      target?: never
      sheet?: never
    }
) & {
  currentUserId: string | null
  currentUserName: string
  /** Whether the viewer may write (workspace member). */
  canComment: boolean
  /** A requested hit is focused only after the scoped read returns it. */
  focusCommentId?: string
  /** Historical targets may still allow replies, but not a fresh root. */
  canCreate?: boolean
  className?: string
  /** Only a viewer's visible current/frozen context may assess availability. */
  isTargetAvailable?: (comment: CommentWire) => boolean
  /**
   * REV-01.3: when provided, a new top-level comment becomes a private
   * reviewer draft instead of being published immediately. The author cannot
   * see it until the reviewer returns the submission with their comments.
   */
  onDraftComment?: (input: {
    targetKind: CommentTargetKind
    target: CommentTarget
    body: string
  }) => void
}

export function CommentPanel({
  revisionId,
  targetKind,
  target,
  sheet,
  recordId,
  currentUserId,
  currentUserName,
  canComment,
  focusCommentId,
  canCreate = true,
  className,
  isTargetAvailable,
  onDraftComment,
}: CommentPanelProps) {
  const queryClient = useQueryClient()
  const [newBody, setNewBody] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const panelRef = React.useRef<HTMLElement>(null)
  const focusedRequest = React.useRef({ key: '', applied: false })

  const queryKey = sheet
    ? commentsQueryKeys.forSheet(sheet.anchor.target.instanceId)
    : recordId !== undefined
      ? commentsQueryKeys.forRecord(recordId)
      : commentsQueryKeys.forRevision(revisionId)
  const commentsQuery = useQuery({
    queryKey,
    queryFn: () =>
      sheet
        ? fetchCommentsForSheet(
            notebookDataClient,
            sheet.anchor.target.instanceId,
          )
        : recordId !== undefined
          ? fetchCommentsForRecord(notebookDataClient, recordId)
          : fetchCommentsForRevision(notebookDataClient, revisionId),
  })

  const threads = React.useMemo(
    () =>
      commentsQuery.data ? groupCommentsIntoThreads(commentsQuery.data) : [],
    [commentsQuery.data],
  )

  const focusRequest = `${queryKey.join(':')}:${focusCommentId ?? ''}`
  React.useEffect(() => {
    if (focusedRequest.current.key !== focusRequest)
      focusedRequest.current = { key: focusRequest, applied: false }
    if (!focusCommentId || focusedRequest.current.applied) return
    if (!commentsQuery.data?.some((comment) => comment.id === focusCommentId))
      return
    const hit = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[data-comment-id]') ??
        [],
    ).find((element) => element.dataset.commentId === focusCommentId)
    if (hit) {
      hit.focus()
      focusedRequest.current.applied = true
    }
  }, [commentsQuery.data, focusCommentId, focusRequest])

  const createMutation = useMutation({
    mutationFn: (body: string) => {
      if (recordId !== undefined) {
        throw new Error('Choose a Sheet or revision target to start a thread.')
      }
      return sheet
        ? createSheetComment(notebookDataClient, { ...sheet, body })
        : createComment(notebookDataClient, {
            revisionId,
            targetKind,
            target,
            body,
          })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['comments'],
      })
    },
    onError: (err: unknown) => setError(renderError(err)),
  })

  const replyMutation = useMutation({
    mutationFn: ({ parentId, body }: { parentId: string; body: string }) =>
      replyToComment(notebookDataClient, parentId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['comments'],
      })
    },
    onError: (err: unknown) => setError(renderError(err)),
  })

  const resolveMutation = useMutation({
    mutationFn: (commentId: string) =>
      resolveCommentThread(notebookDataClient, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['comments'],
      })
    },
    onError: (err: unknown) => setError(renderError(err)),
  })

  const reopenMutation = useMutation({
    mutationFn: (commentId: string) =>
      reopenCommentThread(notebookDataClient, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['comments'],
      })
    },
    onError: (err: unknown) => setError(renderError(err)),
  })

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const body = newBody.trim()
    if (!body) return
    setError(null)
    // REV-01.3: a reviewer's new comment is a private draft, not a sent
    // comment, until it is published with the return decision.
    if (onDraftComment && revisionId !== undefined) {
      onDraftComment({ targetKind, target, body })
      setNewBody('')
      return
    }
    await createMutation.mutateAsync(body)
    setNewBody('')
  }

  const loading = commentsQuery.isLoading
  const loadError = commentsQuery.error
  const openCount = threads.filter((t) => threadState(t) === 'open').length

  return (
    <section
      ref={panelRef}
      aria-label={
        sheet
          ? 'Sheet comments'
          : recordId
            ? 'Record comments'
            : 'Review comments'
      }
      className={cn('space-y-3', className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={openCount > 0 ? 'chg' : 'kind'}>
            {threads.length} {threads.length === 1 ? 'thread' : 'threads'}
          </Badge>
          <span className="text-xs text-fg-muted">
            {openCount} open · {threads.length - openCount} resolved
          </span>
        </div>
      </header>

      {loadError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-danger-text"
        >
          Could not load comments.
        </p>
      ) : null}

      {loading ? (
        <p className="text-xs text-fg-muted">Loading comments…</p>
      ) : threads.length === 0 && !loadError ? (
        <p className="rounded-md border border-dashed bg-surface-muted/30 px-3 py-2 text-xs text-fg-muted">
          No comments yet on this{' '}
          {sheet ? 'Sheet' : recordId ? 'Record' : 'revision'}.
        </p>
      ) : (
        <ol className="space-y-4">
          {threads.map((thread) => (
            <CommentThread
              key={thread.root.id}
              root={thread.root}
              replies={thread.replies}
              resolved={threadState(thread) === 'resolved'}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              canComment={canComment}
              targetUnavailable={
                isTargetAvailable ? !isTargetAvailable(thread.root) : false
              }
              onReply={async (parentId, body) => {
                await replyMutation.mutateAsync({ parentId, body })
              }}
              onResolve={async (commentId) => {
                await resolveMutation.mutateAsync(commentId)
              }}
              onReopen={async (commentId) => {
                await reopenMutation.mutateAsync(commentId)
              }}
              pendingReplyId={
                replyMutation.isPending
                  ? replyMutation.variables.parentId
                  : null
              }
            />
          ))}
        </ol>
      )}

      {canComment && canCreate && !recordId ? (
        <form onSubmit={handleCreate} className="space-y-2 border-t pt-3">
          <textarea
            className="min-h-[70px] w-full rounded-md border bg-surface px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={`Add a comment on this ${sheet || targetKind?.startsWith('sheet_') ? 'selection' : 'revision'}…`}
            value={newBody}
            onChange={(event) => setNewBody(event.target.value)}
            aria-label="New comment body"
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!newBody.trim() || createMutation.isPending}
            >
              <MessageSquarePlus className="size-3" aria-hidden="true" />
              {onDraftComment ? 'Add draft comment' : 'Add comment'}
            </Button>
            {createMutation.isPending ? (
              <span className="text-xs text-fg-muted">Sending…</span>
            ) : null}
          </div>
          {onDraftComment ? (
            <p className="text-xs text-fg-muted">
              Draft — not sent to the author until you return the submission.
            </p>
          ) : null}
        </form>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-danger-text"
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}

function renderError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'Comment action failed.'
}
