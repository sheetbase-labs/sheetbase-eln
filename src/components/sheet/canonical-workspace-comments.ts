import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CurrentContext } from '#/lib/current-user'
import type { DataClient } from '#/lib/data-client'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { hasCapability } from '#/lib/capability'
import { commentsQueryKeys, fetchCommentsForSheet } from '#/lib/comments-data'
import { sheetCommentAnchorSchema } from '#/lib/sheet-comment-anchor'
import type { SheetCommentAnchor } from '#/lib/sheet-comment-anchor'

/** Own the comment draft and apply each requested deep link once. */
export function useCanonicalWorkspaceComments({
  instance,
  actor,
  commentId,
  client,
}: {
  instance: SheetInstance
  actor: Pick<CurrentContext, 'user' | 'workspace'> | null
  commentId: string | undefined
  client: DataClient
}) {
  const [commentDraft, setCommentDraft] = useState<{
    anchor: SheetCommentAnchor
    expectedRevision: number
  } | null>(null)

  const canComment =
    actor?.workspace?.id === instance.workspaceId &&
    hasCapability(actor.workspace.role, 'record.create') &&
    instance.lifecycle === 'active'

  const comments = useQuery({
    queryKey: commentsQueryKeys.forSheet(instance.id),
    queryFn: () => fetchCommentsForSheet(client, instance.id),
    enabled: Boolean(actor),
  })

  const openedCommentRequest = useRef({ key: '', applied: false })

  useEffect(() => {
    const request = `${instance.id}:${commentId ?? ''}`

    if (openedCommentRequest.current.key !== request)
      openedCommentRequest.current = { key: request, applied: false }

    if (!commentId || openedCommentRequest.current.applied) return
    const hit = comments.data?.find((comment) => comment.id === commentId)

    if (!hit) return

    const anchor = sheetCommentAnchorSchema.safeParse({
      targetKind: hit.target_kind,
      target: hit.target,
    })

    if (!anchor.success || anchor.data.target.instanceId !== instance.id) return
    setCommentDraft({
      anchor: anchor.data,
      expectedRevision: instance.revision,
    })
    openedCommentRequest.current.applied = true
  }, [commentId, comments.data, instance.id, instance.revision])

  return { commentDraft, setCommentDraft, canComment, comments }
}
