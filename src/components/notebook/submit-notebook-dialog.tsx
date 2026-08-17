import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

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

const WORKFLOW_KEY = 'default-scientific-review'
const WORKFLOW_VERSION = 1

export function SubmitNotebookDialog({
  open,
  onOpenChange,
  recordId,
  reviewerUserId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  projectId: string
  reviewerUserId: string
}) {
  const navigate = useNavigate()
  const [digest, setDigest] = useState<string | null>(null)
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
        reviewerUserIds: [reviewerUserId],
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
          <DialogTitle>Submit Notebook</DialogTitle>
          <DialogDescription>
            Creates a frozen revision using the existing evidence contract.
            Preview the digest first, then confirm submit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            Workflow: {WORKFLOW_KEY} v{WORKFLOW_VERSION}
          </p>
          {digest ? (
            <p className="break-all font-mono text-xs" role="status">
              Evidence digest: {digest}
            </p>
          ) : (
            <p className="text-muted-foreground">
              Preview the current evidence digest before submitting.
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
            Preview digest
          </Button>
          <Button
            type="button"
            disabled={submit.isPending || preview.isPending || !digest}
            onClick={() => submit.mutate()}
          >
            Submit and freeze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
