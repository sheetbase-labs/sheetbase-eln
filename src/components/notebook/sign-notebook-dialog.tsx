import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { notebookSignState } from '#/lib/notebook-experience'
import {
  fetchReviewSubmissionByRevision,
  fetchRevisionRow,
  reviewWorkspaceQueryKeys,
} from '#/lib/review-workspace'
import {
  ASSURANCE_LEVEL_STATEMENT,
  SIGNATURE_MEANING_OPTIONS,
  fetchSignaturesForSubmission,
  signatureQueryKeys,
  signRevision,
} from '#/lib/signatures'
import type { SignatureMeaning } from '#/lib/signatures'

export function SignNotebookDialog({
  open,
  onOpenChange,
  revisionId,
  currentUserId,
  currentUserName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  revisionId: string
  currentUserId: string
  currentUserName: string
}) {
  const queryClient = useQueryClient()
  const [meaning, setMeaning] = useState<SignatureMeaning>('approve-for-record')
  const [confirmation, setConfirmation] = useState('')

  const submissionQuery = useQuery({
    queryKey: reviewWorkspaceQueryKeys.submissionForRevision(revisionId),
    queryFn: () =>
      fetchReviewSubmissionByRevision(notebookDataClient, revisionId),
    enabled: open,
  })
  const revisionQuery = useQuery({
    queryKey: reviewWorkspaceQueryKeys.revision(revisionId),
    queryFn: () => fetchRevisionRow(notebookDataClient, revisionId),
    enabled: open,
  })
  const submission = submissionQuery.data ?? null
  const signaturesQuery = useQuery({
    queryKey: signatureQueryKeys.forSubmission(submission?.id ?? 'none'),
    queryFn: () =>
      fetchSignaturesForSubmission(notebookDataClient, submission!.id),
    enabled: open && Boolean(submission?.id),
  })

  const signState = notebookSignState({
    currentUserId,
    submission,
    signatures: signaturesQuery.data ?? [],
  })
  const integrityDigest = revisionQuery.data?.integrity_digest ?? null
  const confirmationMatches =
    confirmation.trim().toLowerCase() === currentUserName.trim().toLowerCase()
  const selected = SIGNATURE_MEANING_OPTIONS.find(
    (option) => option.value === meaning,
  )!

  const sign = useMutation({
    mutationFn: () => {
      if (!submission || !integrityDigest) {
        throw new DataClientError(
          'validation_error',
          'This revision is not ready to sign.',
          400,
        )
      }
      return signRevision(notebookDataClient, {
        submissionId: submission.id,
        signatureMeaning: meaning,
        confirmationPhrase: confirmation,
        expectedRevisionDigest: integrityDigest,
      })
    },
    onSuccess: async () => {
      if (submission) {
        await queryClient.invalidateQueries({
          queryKey: signatureQueryKeys.forSubmission(submission.id),
        })
      }
      setConfirmation('')
      onOpenChange(false)
    },
  })

  const errorMessage =
    sign.error instanceof DataClientError
      ? sign.error.message
      : sign.error instanceof Error
        ? sign.error.message
        : submissionQuery.error instanceof Error
          ? submissionQuery.error.message
          : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setConfirmation('')
          setMeaning('approve-for-record')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign this Notebook</DialogTitle>
          <DialogDescription>
            This records an internal electronic signature against the submitted
            evidence. It is not a regulatory compliance certification.
          </DialogDescription>
        </DialogHeader>
        {signState !== 'can-sign' ? (
          <p className="text-sm text-muted-foreground">
            {signState === 'awaiting-review'
              ? 'Review must finish before this Notebook can be signed.'
              : signState === 'already-signed'
                ? 'You have already signed this submission.'
                : signState === 'not-assigned'
                  ? 'Only an assigned reviewer may sign this Notebook.'
                  : 'No review submission is available for this revision.'}
          </p>
        ) : (
          <div className="space-y-3">
            <Label className="space-y-1">
              <span>Signature meaning</span>
              <select
                aria-label="Signature meaning"
                className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={meaning}
                onChange={(event) =>
                  setMeaning(event.target.value as SignatureMeaning)
                }
              >
                {SIGNATURE_MEANING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Label>
            <p className="text-xs text-muted-foreground">
              {selected.description}
            </p>
            <p className="rounded-md border bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground">
              {ASSURANCE_LEVEL_STATEMENT.standard}
            </p>
            <Label className="space-y-1">
              <span>Type your name to confirm</span>
              <input
                aria-label="Signature confirmation"
                type="text"
                className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder={currentUserName}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </Label>
          </div>
        )}
        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {signState === 'can-sign' ? (
            <Button
              type="button"
              disabled={
                sign.isPending || !confirmationMatches || !integrityDigest
              }
              onClick={() => sign.mutate()}
            >
              Sign
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
