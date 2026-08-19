import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import {
  notebookDataClient,
  previewSubmissionDigest,
  submitRecordRevision,
} from '#/lib/notebook-data'
import {
  reviewerCandidates,
  reviewerOptionLabel,
} from '#/lib/notebook-experience'
import {
  adminQueryKeys,
  fetchWorkspaceMembers,
} from '#/lib/workspace-admin'

const WORKFLOW_KEY = 'default-scientific-review'
const WORKFLOW_VERSION = 1

export function SubmitNotebookDialog({
  open,
  onOpenChange,
  recordId,
  reviewerUserId,
  workspaceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  projectId: string
  reviewerUserId: string
  workspaceId?: string
}) {
  const navigate = useNavigate()
  const [digest, setDigest] = useState<string | null>(null)
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([
    reviewerUserId,
  ])

  useEffect(() => {
    if (open) {
      setDigest(null)
      setSelectedReviewerIds([reviewerUserId])
    }
  }, [open, reviewerUserId])

  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId ?? 'none'),
    queryFn: () => fetchWorkspaceMembers(notebookDataClient, workspaceId!),
    enabled: open && Boolean(workspaceId),
  })
  const reviewers = reviewerCandidates(members.data ?? [])
  const shownReviewers =
    reviewers.length > 0
      ? reviewers
      : [{ userId: reviewerUserId, role: 'member', suspendedAt: null }]

  const preview = useMutation({
    mutationFn: () => previewSubmissionDigest(notebookDataClient, recordId),
    onSuccess: (result) => setDigest(result.sourceDigest),
  })
  const submit = useMutation({
    mutationFn: async () => {
      const expected =
        digest ??
        (await previewSubmissionDigest(notebookDataClient, recordId))
          .sourceDigest
      return submitRecordRevision(notebookDataClient, {
        recordId,
        expectedSourceDigest: expected,
        workflowDefinitionKey: WORKFLOW_KEY,
        workflowDefinitionVersion: WORKFLOW_VERSION,
        reviewerUserIds: selectedReviewerIds,
        idempotencyKey: crypto.randomUUID(),
      })
    },
    onSuccess: (result) => {
      onOpenChange(false)
      void navigate({
        to: '/reviews/$revisionId',
        params: { revisionId: result.revision.id },
      })
    },
  })

  const errorMessage =
    preview.error instanceof DataClientError
      ? preview.error.message
      : submit.error instanceof DataClientError
        ? submit.error.message
        : preview.error instanceof Error
          ? preview.error.message
          : submit.error instanceof Error
            ? submit.error.message
            : null

  function toggleReviewer(userId: string) {
    setSelectedReviewerIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDigest(null)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit for review</DialogTitle>
          <DialogDescription>
            Freezes this Notebook as submitted evidence. Later edits require an
            amendment. Assign at least one reviewer, then check the snapshot
            before confirming.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Reviewers</legend>
            {shownReviewers.map((member) => (
              <label
                key={member.userId}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedReviewerIds.includes(member.userId)}
                  onChange={() => toggleReviewer(member.userId)}
                />
                <span>
                  {reviewerOptionLabel(member, reviewerUserId)}
                </span>
              </label>
            ))}
          </fieldset>
          {digest ? (
            <p className="text-muted-foreground" role="status">
              Snapshot is ready to submit.
              <span className="mt-1 block break-all font-mono text-xs">
                Integrity check: {digest}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              Check the current snapshot before submitting.
            </p>
          )}
          {errorMessage ? (
            <p className="text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={preview.isPending}
            onClick={() => preview.mutate()}
          >
            Check snapshot
          </Button>
          <Button
            type="button"
            disabled={
              submit.isPending ||
              preview.isPending ||
              !digest ||
              selectedReviewerIds.length === 0
            }
            onClick={() => submit.mutate()}
          >
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
