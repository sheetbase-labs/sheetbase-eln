import { t } from '#/copy'
import * as React from 'react'
import { Notice } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import { threadState } from '#/lib/comments-data'
import type {
  CommentTarget,
  CommentTargetKind,
  CommentThread as CommentThreadGroup,
  CommentWire,
} from '#/lib/comments-data'
import type { MentionCandidate } from '#/lib/mentions'
import type { SheetCommentAnchor } from '#/lib/sheet-comment-anchor'
import { cn } from '#/lib/utils'

import { useCommentActions } from './comment-actions'
import type { CommentActions } from './comment-actions'
import { useCommentThreads } from './comment-threads'
import { CommentComposer } from './comment-composer'
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
  /**
   * The workspace whose members can be @mentioned and whose people are named on
   * the comments. Without it authors read as "Reviewer" and there is no picker.
   */
  workspaceId?: string
  /**
   * Record mode only: scope the panel to one block of the notebook. Threads on
   * other blocks are hidden and a new comment is anchored to this block.
   */
  blockId?: string
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

/** What the panel's landmark is called on the surface it comments on. */
function panelLabel(props: CommentPanelProps): string {
  if (props.sheet) return t('notebook.commentPanel.ariaLabel')

  if (props.recordId !== undefined)
    return t('notebook.commentPanel.ariaLabelRecordComments')

  return t('notebook.commentPanel.ariaLabelReviewComments')
}

/** The empty panel's heading on the surface it comments on. */
function emptyTitle(props: CommentPanelProps): string {
  if (props.sheet) return t('notebook.commentPanel.emptySheet')

  if (props.recordId !== undefined)
    return t('notebook.commentPanel.emptyRecord')

  return t('notebook.commentPanel.emptyRevision')
}

export function CommentPanel(props: CommentPanelProps) {
  const {
    targetKind,
    sheet,
    recordId,
    currentUserId,
    currentUserName,
    canComment,
    focusCommentId,
    canCreate = true,
    className,
    blockId,
    isTargetAvailable,
    onDraftComment,
  } = props

  const panelRef = React.useRef<HTMLElement>(null)
  const focusedRequest = React.useRef({ key: '', applied: false })

  const { queryKey, commentsQuery, threads, names, mentionCandidates } =
    useCommentThreads(props)

  const actions = useCommentActions(props, mentionCandidates)

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

  const loading = commentsQuery.isLoading
  const loadError = commentsQuery.error

  const openCount = threads.filter(
    (thread) => threadState(thread) === 'open',
  ).length

  return (
    <section
      ref={panelRef}
      aria-label={panelLabel(props)}
      className={cn('space-y-3', className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={openCount > 0 ? 'chg' : 'kind'}>
            {threads.length} {threads.length === 1 ? 'thread' : 'threads'}
          </Badge>
          <span className="text-xs text-fg-muted">
            {t('notebook.commentPanel.openResolved', {
              openCount,
              resolvedCount: threads.length - openCount,
            })}
          </span>
        </div>
      </header>

      {loadError ? (
        <Notice tone="bad">
          {t('notebook.commentPanel.couldNotLoadComments')}
        </Notice>
      ) : null}

      {loading ? (
        <p className="text-xs text-fg-muted">
          {t('notebook.commentPanel.loadingComments')}
        </p>
      ) : threads.length === 0 && !loadError ? (
        <EmptyState
          icon="comment"
          className="py-2"
          title={emptyTitle(props)}
          description={t('notebook.commentPanel.description')}
        />
      ) : (
        <CommentThreadList
          threads={threads}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          canComment={canComment}
          isTargetAvailable={isTargetAvailable}
          names={names}
          mentionCandidates={mentionCandidates}
          replyMutation={actions.replyMutation}
          resolveMutation={actions.resolveMutation}
          reopenMutation={actions.reopenMutation}
        />
      )}

      {canComment && canCreate ? (
        <CommentComposer
          newBody={actions.newBody}
          onChange={actions.setNewBody}
          onSubmit={actions.handleCreate}
          pending={actions.createMutation.isPending}
          mentionCandidates={mentionCandidates}
          draft={onDraftComment !== undefined}
          target={{
            onBlock: recordId !== undefined && blockId !== undefined,
            onNotebook: recordId !== undefined && blockId === undefined,
            onSelection:
              recordId === undefined &&
              (sheet !== undefined || targetKind.startsWith('sheet_')),
          }}
        />
      ) : null}

      {actions.error ? <Notice tone="bad">{actions.error}</Notice> : null}
    </section>
  )
}

/** The panel's threads, with the three writes each thread can make. */
function CommentThreadList({
  threads,
  currentUserId,
  currentUserName,
  canComment,
  isTargetAvailable,
  names,
  mentionCandidates,
  replyMutation,
  resolveMutation,
  reopenMutation,
}: {
  threads: CommentThreadGroup[]
  currentUserId: string | null
  currentUserName: string
  canComment: boolean
  isTargetAvailable?: ((comment: CommentWire) => boolean) | undefined
  names: Record<string, string>
  mentionCandidates: MentionCandidate[]
  replyMutation: CommentActions['replyMutation']
  resolveMutation: CommentActions['resolveMutation']
  reopenMutation: CommentActions['reopenMutation']
}) {
  return (
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
          names={names}
          mentionCandidates={mentionCandidates}
          pendingReplyId={
            replyMutation.isPending ? replyMutation.variables.parentId : null
          }
        />
      ))}
    </ol>
  )
}
