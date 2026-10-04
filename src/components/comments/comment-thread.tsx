import * as React from 'react'
import { CheckCircle2, MessageSquare, RotateCcw } from 'lucide-react'

import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { cn } from '#/lib/utils'
import type { CommentTargetKind, CommentWire } from '#/lib/comments-data'

/**
 * REV-004: a single anchored comment thread with replies, a reply composer,
 * and resolve/reopen actions. Renders departed authors ("Deleted user") and
 * unavailable targets honestly.
 */
export interface CommentThreadProps {
  root: CommentWire
  replies: CommentWire[]
  resolved: boolean
  /** Current signed-in user id, for attributing the actor's own comments. */
  currentUserId: string | null
  currentUserName: string
  /** Whether the viewer may write (workspace member). */
  canComment: boolean
  onReply: (parentId: string, body: string) => Promise<void>
  onResolve: (commentId: string) => Promise<void>
  onReopen: (commentId: string) => Promise<void>
  pendingReplyId?: string | null
  targetUnavailable?: boolean
}

const TARGET_KIND_LABEL: Record<CommentTargetKind, string> = {
  revision: 'Whole revision',
  block: 'Block',
  table_region: 'Table region',
  diff: 'Diff',
  sheet_cell: 'Sheet cell',
  sheet_row: 'Sheet row',
  sheet_range: 'Sheet range',
}

function authorLabel(
  authorUserId: string | null,
  currentUserId: string | null,
  currentUserName: string,
): string {
  if (authorUserId === null) return 'Deleted user'
  if (currentUserId !== null && authorUserId === currentUserId) {
    return currentUserName
  }
  return 'Reviewer'
}

function authorInitials(label: string): string {
  if (label === 'Deleted user') return '??'
  return label.slice(0, 2)
}

function describeTarget(
  kind: CommentTargetKind,
  target: CommentWire['target'],
): string {
  if (kind === 'revision') return TARGET_KIND_LABEL.revision
  if (kind === 'block')
    return `${TARGET_KIND_LABEL.block} ${target.blockId ?? ''}`.trim()
  if (kind === 'sheet_cell' || kind === 'sheet_row' || kind === 'sheet_range') {
    return `${TARGET_KIND_LABEL[kind]} · ${target.rowKeys?.length ?? 0} ${target.rowKeys?.length === 1 ? 'row' : 'rows'}${kind === 'sheet_row' ? '' : ` · ${target.fieldIds?.length ?? 0} ${target.fieldIds?.length === 1 ? 'field' : 'fields'}`}`
  }
  if (kind === 'table_region') {
    const parts = [target.tableId, target.rowId, target.columnId].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
    return `${TARGET_KIND_LABEL.table_region} ${parts.join(' · ')}`.trim()
  }
  return `${TARGET_KIND_LABEL.diff} ${target.changeId ?? ''}`.trim()
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function CommentRow({
  comment,
  currentUserId,
  currentUserName,
}: {
  comment: CommentWire
  currentUserId: string | null
  currentUserName: string
}) {
  const label = authorLabel(
    comment.author_user_id,
    currentUserId,
    currentUserName,
  )
  const deleted = comment.author_user_id === null
  return (
    <article
      data-comment-id={comment.id}
      tabIndex={-1}
      className="rounded-lg border bg-surface p-3 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2">
          <span
            title={label}
            aria-label={label}
            className={cn(
              'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
              deleted
                ? 'bg-surface-muted text-fg-muted'
                : 'bg-primary/15 text-primary',
            )}
          >
            {authorInitials(label).toUpperCase()}
          </span>
          <span className="text-xs font-medium">{label}</span>
        </span>
        <span className="text-xs text-fg-muted">
          {formatRelative(comment.created_at)}
        </span>
      </div>
      <p className="mt-2 break-words text-sm leading-6 text-fg whitespace-pre-wrap">
        {comment.body}
      </p>
    </article>
  )
}

export function CommentThread({
  root,
  replies,
  resolved,
  currentUserId,
  currentUserName,
  canComment,
  onReply,
  onResolve,
  onReopen,
  pendingReplyId,
  targetUnavailable = false,
}: CommentThreadProps) {
  const [replyBody, setReplyBody] = React.useState('')
  const [showReply, setShowReply] = React.useState(false)
  const targetLabel = describeTarget(root.target_kind, root.target)

  async function handleReply(event: React.FormEvent) {
    event.preventDefault()
    const body = replyBody.trim()
    if (!body) return
    await onReply(root.id, body)
    setReplyBody('')
    setShowReply(false)
  }

  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={resolved ? 'add' : 'kind'}>
          {resolved ? (
            <>
              <CheckCircle2 className="size-3" aria-hidden="true" />
              Resolved
            </>
          ) : (
            <>
              <MessageSquare className="size-3" aria-hidden="true" />
              Open
            </>
          )}
        </Badge>
        <span className="text-xs text-fg-muted">Anchored to {targetLabel}</span>
      </div>
      {targetUnavailable ? (
        <p className="text-xs text-fg-muted">
          Original target unavailable in this view. This thread retains its
          historical anchor.
        </p>
      ) : null}

      <CommentRow
        comment={root}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
      />

      {replies.length > 0 ? (
        <div className="relative space-y-2 pl-5">
          {/* vertical connector line aligned with avatar center */}
          <div className="absolute bottom-3 left-2 top-0 w-px bg-border" />
          <ol className="space-y-2">
            {replies.map((reply) => (
              <li key={reply.id} className="relative">
                {/* horizontal stub from vertical line to card */}
                <div className="absolute -left-3 top-4 h-px w-3 bg-border" />
                <CommentRow
                  comment={reply}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                />
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {canComment ? (
        <div className="flex flex-wrap items-center gap-2">
          {!resolved ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onResolve(root.id)}
              aria-label="Resolve thread"
            >
              <CheckCircle2 className="size-3" aria-hidden="true" />
              Resolve
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onReopen(root.id)}
              aria-label="Reopen thread"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Reopen
            </Button>
          )}
          {!showReply ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setShowReply(true)}
              aria-label="Reply to thread"
            >
              Reply
            </Button>
          ) : null}
        </div>
      ) : null}

      {showReply && canComment ? (
        <form onSubmit={handleReply} className="space-y-2 pl-5">
          <textarea
            className="min-h-[60px] w-full rounded-md border bg-surface px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Write a reply…"
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            aria-label="Reply body"
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!replyBody.trim() || pendingReplyId === root.id}
            >
              Send reply
            </Button>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => {
                setShowReply(false)
                setReplyBody('')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  )
}
