import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus } from 'lucide-react'

import { Badge, Button } from '#/components/ui'
import {
  commentsQueryKeys,
  createComment,
  fetchCommentsForRevision,
  groupCommentsIntoThreads,
  reopenCommentThread,
  replyToComment,
  resolveCommentThread,
  threadState,
} from '#/lib/comments-data'
import type { CommentTarget, CommentTargetKind } from '#/lib/comments-data'
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
export interface CommentPanelProps {
  revisionId: string
  /** Target for new top-level comments created from this panel. */
  targetKind: CommentTargetKind
  target: CommentTarget
  currentUserId: string | null
  currentUserName: string
  /** Whether the viewer may write (workspace member). */
  canComment: boolean
  className?: string
}

export function CommentPanel({
  revisionId,
  targetKind,
  target,
  currentUserId,
  currentUserName,
  canComment,
  className,
}: CommentPanelProps) {
  const queryClient = useQueryClient()
  const [newBody, setNewBody] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const commentsQuery = useQuery({
    queryKey: commentsQueryKeys.forRevision(revisionId),
    queryFn: () => fetchCommentsForRevision(notebookDataClient, revisionId),
  })

  const threads = React.useMemo(
    () =>
      commentsQuery.data ? groupCommentsIntoThreads(commentsQuery.data) : [],
    [commentsQuery.data],
  )

  const createMutation = useMutation({
    mutationFn: (body: string) =>
      createComment(notebookDataClient, {
        revisionId,
        targetKind,
        target,
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: commentsQueryKeys.forRevision(revisionId),
      })
    },
    onError: (err: unknown) => setError(renderError(err)),
  })

  const replyMutation = useMutation({
    mutationFn: ({ parentId, body }: { parentId: string; body: string }) =>
      replyToComment(notebookDataClient, parentId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: commentsQueryKeys.forRevision(revisionId),
      })
    },
    onError: (err: unknown) => setError(renderError(err)),
  })

  const resolveMutation = useMutation({
    mutationFn: (commentId: string) =>
      resolveCommentThread(notebookDataClient, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: commentsQueryKeys.forRevision(revisionId),
      })
    },
    onError: (err: unknown) => setError(renderError(err)),
  })

  const reopenMutation = useMutation({
    mutationFn: (commentId: string) =>
      reopenCommentThread(notebookDataClient, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: commentsQueryKeys.forRevision(revisionId),
      })
    },
    onError: (err: unknown) => setError(renderError(err)),
  })

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const body = newBody.trim()
    if (!body) return
    setError(null)
    await createMutation.mutateAsync(body)
    setNewBody('')
  }

  const loading = commentsQuery.isLoading
  const loadError = commentsQuery.error
  const openCount = threads.filter((t) => threadState(t) === 'open').length

  return (
    <section
      aria-label="Review comments"
      className={cn('space-y-3', className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={openCount > 0 ? 'warning' : 'info'}>
            {threads.length} {threads.length === 1 ? 'thread' : 'threads'}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {openCount} open · {threads.length - openCount} resolved
          </span>
        </div>
      </header>

      {loadError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          Could not load comments.
        </p>
      ) : null}

      {loading ? (
        <p className="text-[11px] text-muted-foreground">Loading comments…</p>
      ) : threads.length === 0 && !loadError ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          No comments yet on this revision.
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

      {canComment ? (
        <form onSubmit={handleCreate} className="space-y-2 border-t pt-3">
          <textarea
            className="min-h-[70px] w-full rounded-md border bg-background px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Add a comment on this revision…"
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
              Add comment
            </Button>
            {createMutation.isPending ? (
              <span className="text-[11px] text-muted-foreground">
                Sending…
              </span>
            ) : null}
          </div>
        </form>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
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
