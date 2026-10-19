import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import { CommentPanel } from '#/components/comments'
import { CommentButton } from '#/components/collaboration/comment-button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
import {
  commentsQueryKeys,
  fetchCommentsForRecord,
  groupCommentsIntoThreads,
  threadState,
} from '#/lib/comments-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'

/**
 * Per-block discussion for a deployment without the collaboration room. The
 * threads are ordinary comment rows anchored to the block (the same rows the
 * notebook's Comments tab lists), so this works with the collaboration flag off
 * and needs no live connection. @mentions notify through the same path as any
 * other comment.
 */
export function LiveBlockComments({
  workspaceId,
  recordId,
  blockId,
  canComment,
}: {
  workspaceId: string
  recordId: string
  blockId: string
  canComment: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const comments = useQuery({
    queryKey: commentsQueryKeys.forRecord(recordId),
    queryFn: () => fetchCommentsForRecord(notebookDataClient, recordId),
  })
  const unresolved = groupCommentsIntoThreads(comments.data ?? []).filter(
    (thread) =>
      thread.root.target_kind === 'block' &&
      thread.root.target.blockId === blockId &&
      threadState(thread) === 'open',
  ).length
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<span className="inline-flex" />}>
        <CommentButton
          count={unresolved}
          label={`Comments on block ${blockId}`}
          className={cn(
            'size-6 transition-opacity',
            unresolved === 0 &&
              'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100',
          )}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3">
        <CommentPanel
          recordId={recordId}
          blockId={blockId}
          workspaceId={workspaceId}
          currentUserId={null}
          currentUserName="You"
          canComment={canComment}
        />
      </PopoverContent>
    </Popover>
  )
}
