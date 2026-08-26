import * as React from 'react'

import { Composer, Thread } from '@liveblocks/react-ui'

import { useCollaborationRoomReady } from './collaboration-room'
import { Badge, Button, Checkbox, Label } from '#/components/ui'
import { cn } from '#/lib/utils'
import {
  anchorBelongsToRoom,
  anchorRoomId,
  anchorToMetadata,
} from '#/lib/collaboration/anchors'
import { canCommentInRoom } from '#/lib/collaboration/permissions'
import type { ThreadAnchor } from '#/lib/collaboration/types'
import {
  useMarkThreadAsResolved,
  useMarkThreadAsUnresolved,
  useRoom,
  useThreads,
} from '#/lib/collaboration/liveblocks.config'

/**
 * COLLAB-02 anchored discussion panel. Renders the Liveblocks threads whose
 * metadata matches one typed anchor, plus a composer that stamps new
 * top-level threads with that anchor's metadata.
 *
 * Write actions (reply via the embedded composer, edit own comments, delete
 * where permitted) come from @liveblocks/react-ui's Thread; resolve/reopen
 * go through the room mutation hooks re-exported from the collaboration
 * config. Server scopes remain authoritative — this panel only hides write
 * affordances for read-only roles as a client-side hint.
 *
 * Must be rendered inside a `CollaborationRoom` for
 * `anchorRoomId(anchor)`; it renders null otherwise and before hydration,
 * so SSR output is stable.
 */

/** True when stored thread metadata addresses exactly this anchor. */
export function threadMatchesAnchor(
  metadata: Record<string, unknown>,
  anchor: ThreadAnchor,
): boolean {
  const expected = anchorToMetadata(anchor)
  if (metadata.anchorType !== expected.anchorType) return false
  return Object.entries(expected).every(
    ([key, value]) => metadata[key] === value,
  )
}

export interface ThreadPanelProps {
  anchor: ThreadAnchor
  /** Workspace role of the current user; drives the composer hint. */
  currentRole?: string
  /** Overrides the role-derived comment capability. */
  canComment?: boolean
  className?: string
  /** Denser layout for popover-embedded usage. */
  compact?: boolean
}

export function ThreadPanel(props: ThreadPanelProps) {
  const ready = useCollaborationRoomReady()
  // Gate before any room hook runs: hooks from the suspense bundle throw
  // outside a RoomProvider, so the unready render must stay hook-free.
  if (!ready) return null
  return <ThreadPanelInner {...props} />
}

function ThreadPanelInner({
  anchor,
  currentRole = 'viewer',
  canComment,
  className,
  compact = false,
}: ThreadPanelProps) {
  const room = useRoom()
  const { threads } = useThreads()
  const markResolved = useMarkThreadAsResolved()
  const markUnresolved = useMarkThreadAsUnresolved()
  const [unresolvedOnly, setUnresolvedOnly] = React.useState(false)

  const expectedRoomId = anchorRoomId(anchor)
  // A panel must only ever show threads from its own room; a mismatch means
  // a caller mounted it under the wrong CollaborationRoom.
  if (room.id !== expectedRoomId) return null

  const canWrite = canComment ?? canCommentInRoom(currentRole)

  const anchorThreads = threads
    .filter(
      (thread) =>
        anchorBelongsToRoom(thread.metadata, expectedRoomId) &&
        threadMatchesAnchor(thread.metadata, anchor),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const unresolvedCount = anchorThreads.filter((t) => !t.resolved).length
  const visibleThreads = unresolvedOnly
    ? anchorThreads.filter((t) => !t.resolved)
    : anchorThreads

  return (
    <div
      className={cn('sheetbase-collab flex min-w-0 flex-col gap-2', className)}
      data-testid="thread-panel"
      data-anchor-type={anchor.anchorType}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">Discussion</span>
          <Badge variant={unresolvedCount > 0 ? 'default' : 'secondary'}>
            {unresolvedCount} unresolved
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="thread-panel-unresolved-only"
            checked={unresolvedOnly}
            onCheckedChange={(checked) => setUnresolvedOnly(checked === true)}
          />
          <Label
            htmlFor="thread-panel-unresolved-only"
            className="text-[11px] text-muted-foreground"
          >
            Unresolved only
          </Label>
        </div>
      </div>

      {visibleThreads.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {unresolvedOnly && anchorThreads.length > 0
            ? 'All comments on this selection are resolved.'
            : 'No comments yet.'}
        </p>
      ) : (
        <div className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-3')}>
          {visibleThreads.map((thread) => (
            <div key={thread.id} className="min-w-0">
              <Thread thread={thread} className="lb-thread" />
              <div className="mt-0.5 flex justify-end">
                {thread.resolved ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`Reopen thread ${thread.id}`}
                    onClick={() => markUnresolved(thread.id)}
                  >
                    Reopen
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`Resolve thread ${thread.id}`}
                    onClick={() => markResolved(thread.id)}
                  >
                    Resolve
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canWrite ? (
        // New top-level threads are stamped with this anchor's flat metadata
        // so they filter back into this panel for every collaborator.
        <Composer metadata={anchorToMetadata(anchor)} autoFocus={false} />
      ) : null}
    </div>
  )
}
