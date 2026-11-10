import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { z } from 'zod'

import { t } from '#/copy'
import {
  createComment,
  createRecordComment,
  createSheetComment,
  reopenCommentThread,
  replyToComment,
  resolveCommentThread,
} from '#/lib/comments-data'
import { extractMentions } from '#/lib/mentions'
import type { MentionCandidate } from '#/lib/mentions'
import { notebookDataClient } from '#/lib/notebook-data'

import type { CommentPanelProps } from './comment-panel'

const errorMessageSchema = z.object({ message: z.string().min(1) })

/** A failed action's own message, or the panel's fallback sentence. */
function renderError(err: Error): string {
  const decoded = errorMessageSchema.safeParse(err)

  return decoded.success
    ? decoded.data.message
    : t('notebook.commentPanel.actionFailed')
}

/**
 * The panel's four writes and its composer state. Kept beside the panel so the
 * surface itself only reads threads and lays them out.
 */
export type CommentActions = ReturnType<typeof useCommentActions>

export function useCommentActions(
  props: CommentPanelProps,
  mentionCandidates: MentionCandidate[],
) {
  const {
    revisionId,
    targetKind,
    target,
    sheet,
    recordId,
    blockId,
    onDraftComment,
  } = props

  const queryClient = useQueryClient()

  const [newBody, setNewBody] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (body: string) => {
      const mentions = extractMentions(body, mentionCandidates)

      if (recordId !== undefined) {
        return createRecordComment(notebookDataClient, {
          recordId,
          blockId,
          body,
          mentions,
        })
      }

      return sheet
        ? createSheetComment(notebookDataClient, { ...sheet, body, mentions })
        : createComment(notebookDataClient, {
            revisionId,
            targetKind,
            target,
            body,
            mentions,
          })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['comments'] })
    },
    onError: (err: Error) => setError(renderError(err)),
  })

  const replyMutation = useMutation({
    mutationFn: ({ parentId, body }: { parentId: string; body: string }) =>
      replyToComment(
        notebookDataClient,
        parentId,
        body,
        extractMentions(body, mentionCandidates),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['comments'] })
    },
    onError: (err: Error) => setError(renderError(err)),
  })

  const resolveMutation = useMutation({
    mutationFn: (commentId: string) =>
      resolveCommentThread(notebookDataClient, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['comments'] })
    },
    onError: (err: Error) => setError(renderError(err)),
  })

  const reopenMutation = useMutation({
    mutationFn: (commentId: string) =>
      reopenCommentThread(notebookDataClient, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['comments'] })
    },
    onError: (err: Error) => setError(renderError(err)),
  })

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const body = newBody.trim()

    // A second submit while the first is in flight would post the comment twice.
    if (!body || createMutation.isPending) return
    setError(null)

    // REV-01.3: a reviewer's new comment is a private draft, not a sent
    // comment, until it is published with the return decision.
    if (onDraftComment && revisionId !== undefined) {
      onDraftComment({ targetKind, target, body })
      setNewBody('')

      return
    }

    try {
      await createMutation.mutateAsync(body)
    } catch {
      // onError already reports the refusal; the message stays so it can be retried.
      return
    }

    setNewBody('')
  }

  return {
    newBody,
    setNewBody,
    error,
    handleCreate,
    createMutation,
    replyMutation,
    resolveMutation,
    reopenMutation,
  }
}
