import { useQuery } from '@tanstack/react-query'
import * as React from 'react'

import {
  commentsQueryKeys,
  fetchCommentsForRecord,
  fetchCommentsForRevision,
  fetchCommentsForSheet,
  groupCommentsIntoThreads,
} from '#/lib/comments-data'
import type { MentionCandidate } from '#/lib/mentions'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { adminQueryKeys, fetchWorkspaceMembers } from '#/lib/workspace-admin'

import type { CommentPanelProps } from './comment-panel'

/** The query key for whichever surface the panel is commenting on. */
function panelQueryKey(props: CommentPanelProps) {
  if (props.sheet)
    return commentsQueryKeys.forSheet(props.sheet.anchor.target.instanceId)

  if (props.recordId !== undefined)
    return commentsQueryKeys.forRecord(props.recordId)

  return commentsQueryKeys.forRevision(props.revisionId)
}

function readComments(props: CommentPanelProps) {
  if (props.sheet)
    return fetchCommentsForSheet(
      notebookDataClient,
      props.sheet.anchor.target.instanceId,
    )

  if (props.recordId !== undefined)
    return fetchCommentsForRecord(notebookDataClient, props.recordId)

  return fetchCommentsForRevision(notebookDataClient, props.revisionId)
}

/**
 * The threads the panel shows, plus the people who author and can be mentioned
 * in them. Split out so the panel itself only arranges what is already read.
 */
export function useCommentThreads(props: CommentPanelProps) {
  const { blockId, workspaceId, canComment, currentUserId } = props
  const queryKey = panelQueryKey(props)

  const commentsQuery = useQuery({
    queryKey,
    queryFn: () => readComments(props),
  })

  const threads = React.useMemo(() => {
    const all = commentsQuery.data
      ? groupCommentsIntoThreads(commentsQuery.data)
      : []

    return blockId === undefined
      ? all
      : all.filter(
          (thread) =>
            thread.root.target_kind === 'block' &&
            thread.root.target.blockId === blockId,
        )
  }, [commentsQuery.data, blockId])

  // People: the workspace's members are who can be @mentioned, and every author
  // is named from the same lookup. Without a workspace both stay empty.
  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId ?? 'none'),
    queryFn: () => fetchWorkspaceMembers(notebookDataClient, workspaceId!),
    enabled: Boolean(workspaceId) && canComment,
  })

  const peopleIds = workspaceId
    ? [
        ...(commentsQuery.data ?? []).map(
          (comment) => comment.author_user_id ?? '',
        ),
        ...(members.data ?? []).map((member) => member.userId),
      ]
    : []

  const { names } = useUserNames(peopleIds)

  const mentionCandidates = React.useMemo<MentionCandidate[]>(
    () =>
      (members.data ?? []).flatMap((member) =>
        !member.suspendedAt &&
        names[member.userId] &&
        member.userId !== currentUserId
          ? [{ userId: member.userId, name: names[member.userId] }]
          : [],
      ),
    [members.data, names, currentUserId],
  )

  return { queryKey, commentsQuery, threads, names, mentionCandidates }
}
