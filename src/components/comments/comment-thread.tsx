import { t } from '#/copy'
import * as React from 'react'
import { CheckCircle2, RotateCcw } from 'lucide-react'

import { Icon } from '#/components/icons'
import { Avatar } from '#/components/v3/ui/avatar'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import type { CommentTargetKind, CommentWire } from '#/lib/comments-data'
import type { MentionCandidate } from '#/lib/mentions'

import { MentionTextarea } from './mention-textarea'
import { now as appNow } from '#/lib/clock'

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
  /** Display names by user id, so another author is named rather than "Reviewer". */
  names?: Record<string, string>
  /** Members a reply can @mention; with none, the reply box is plain text. */
  mentionCandidates?: readonly MentionCandidate[]
}

const TARGET_KIND_LABEL: Record<CommentTargetKind, string> = {
  revision: t('notebook.commentThread.wholeRevision'),
  block: t('notebook.commentThread.block'),
  record: t('notebook.commentThread.wholeNotebook'),
  table_region: t('notebook.commentThread.tableRegion'),
  diff: t('notebook.commentThread.diff'),
  sheet_cell: t('notebook.commentThread.sheetCell'),
  sheet_row: t('notebook.commentThread.sheetRow'),
  sheet_range: t('notebook.commentThread.sheetRange'),
}

function authorLabel(
  authorUserId: string | null,
  currentUserId: string | null,
  currentUserName: string,
  names?: Record<string, string>,
): string {
  if (authorUserId === null) return t('notebook.commentThread.deletedUser')
  if (currentUserId !== null && authorUserId === currentUserId) {
    return currentUserName
  }
  return names?.[authorUserId] ?? t('notebook.commentThread.reviewer')
}

function describeTarget(
  kind: CommentTargetKind,
  target: CommentWire['target'],
): string {
  if (kind === 'revision') return TARGET_KIND_LABEL.revision
  if (kind === 'record') return TARGET_KIND_LABEL.record
  if (kind === 'block')
    return `${TARGET_KIND_LABEL.block} ${target.blockId ?? ''}`.trim()
  if (kind === 'sheet_cell' || kind === 'sheet_row' || kind === 'sheet_range') {
    const rows = t('common.counts.rows', { count: target.rowKeys?.length ?? 0 })
    const fields = t('notebook.commentThread.fields', {
      count: target.fieldIds?.length ?? 0,
    })
    return `${TARGET_KIND_LABEL[kind]} · ${rows}${kind === 'sheet_row' ? '' : ` · ${fields}`}`
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
  const seconds = Math.max(0, Math.round((appNow().getTime() - then) / 1000))
  if (seconds < 60) return t('notebook.commentThread.justNow')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('notebook.commentThread.minutesAgo', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('notebook.commentThread.hoursAgo', { count: hours })
  const days = Math.round(hours / 24)
  return t('notebook.commentThread.daysAgo', { count: days })
}

function CommentRow({
  comment,
  currentUserId,
  currentUserName,
  names,
}: {
  comment: CommentWire
  currentUserId: string | null
  currentUserName: string
  names?: Record<string, string>
}) {
  const label = authorLabel(
    comment.author_user_id,
    currentUserId,
    currentUserName,
    names,
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
          <Avatar
            name={label}
            initials={deleted ? '?' : undefined}
            size="sm"
            className={deleted ? 'bg-surface-muted text-fg-muted' : undefined}
          />
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
  names,
  mentionCandidates = [],
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
              {t('notebook.commentThread.resolved')}
            </>
          ) : (
            <>
              <Icon name="comment" className="size-3" aria-hidden="true" />
              {t('common.actions.open')}
            </>
          )}
        </Badge>
        <span className="text-xs text-fg-muted">
          {t('notebook.commentThread.anchoredToTargetlabel', { targetLabel })}
        </span>
      </div>
      {targetUnavailable ? (
        <p className="text-xs text-fg-muted">
          {t('notebook.commentThread.originalTargetUnavailableIn')}
        </p>
      ) : null}

      <CommentRow
        comment={root}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        names={names}
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
                  names={names}
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
              aria-label={t('notebook.commentThread.ariaLabel')}
            >
              <CheckCircle2 className="size-3" aria-hidden="true" />
              {t('notebook.commentThread.resolve')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onReopen(root.id)}
              aria-label={t('notebook.commentThread.ariaLabelReopenThread')}
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              {t('notebook.commentThread.reopen')}
            </Button>
          )}
          {!showReply ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setShowReply(true)}
              aria-label={t('notebook.commentThread.ariaLabelReplyToThread')}
            >
              {t('notebook.commentThread.reply')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showReply && canComment ? (
        <form onSubmit={handleReply} className="space-y-2 pl-5">
          <MentionTextarea
            className="min-h-[60px] w-full rounded-md border bg-surface px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t('notebook.commentThread.placeholder')}
            value={replyBody}
            onChange={setReplyBody}
            candidates={mentionCandidates}
            aria-label={t('notebook.commentThread.ariaLabelReplyBody')}
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!replyBody.trim() || pendingReplyId === root.id}
            >
              {t('notebook.commentThread.sendReply')}
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
              {t('common.actions.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  )
}
