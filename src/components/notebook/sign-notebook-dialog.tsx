import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { NativeSelect } from '#/components/v3/projects/select'
import { DataClientError } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  notebookQueryKeysAfterSignature,
  notebookSignState,
} from '#/lib/notebook-experience'
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
        await Promise.all(
          notebookQueryKeysAfterSignature({
            recordId: submission.record_id,
            submissionId: submission.id,
            revisionId,
          }).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        )
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
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="Sign this Notebook"
          description="This records an internal electronic signature against the submitted evidence. It is not a regulatory compliance certification."
        />
        <DialogBody>
          {signState !== 'can-sign' ? (
            <p className="m-0 text-body text-fg-muted">
              {signState === 'awaiting-review'
                ? 'Review must finish before this Notebook can be signed.'
                : signState === 'already-signed'
                  ? 'You have already signed this submission.'
                  : signState === 'not-assigned'
                    ? 'Only an assigned reviewer may sign this Notebook.'
                    : 'No review submission is available for this revision.'}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <Field label="Signature meaning">
                <NativeSelect
                  aria-label="Signature meaning"
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
                </NativeSelect>
              </Field>
              <p className="m-0 text-label text-fg-muted">
                {selected.description}
              </p>
              <p className="m-0 rounded-md border border-border bg-surface-muted px-2 py-1.5 text-label text-fg-muted">
                {ASSURANCE_LEVEL_STATEMENT.standard}
              </p>
              <Field label="Type your name to confirm">
                <Input
                  aria-label="Signature confirmation"
                  type="text"
                  placeholder={currentUserName}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
          )}
          {errorMessage ? <Notice tone="bad">{errorMessage}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          {signState === 'can-sign' ? (
            <Button
              variant="primary"
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
