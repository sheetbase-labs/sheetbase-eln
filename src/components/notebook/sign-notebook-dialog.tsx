import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

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
import { notebookQueryKeysAfterSignature } from '#/lib/notebook-experience'
import {
  fetchReviewSubmissionByRevision,
  fetchRevisionRow,
  reviewWorkspaceQueryKeys,
} from '#/lib/review-workspace'
import {
  ASSURANCE_LEVEL_STATEMENT,
  availableSignatureMeanings,
  fetchSignatureEligibility,
  SIGNATURE_MEANING_OPTIONS,
  fetchSignaturesForSubmission,
  signatureQueryKeys,
  signRevision,
  requestSignatureStepUp,
} from '#/lib/signatures'
import type { PostSubmissionSignatureMeaning } from '#/lib/signatures'

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
  const [meaning, setMeaning] = useState<PostSubmissionSignatureMeaning>(
    'reviewed-and-approved',
  )
  const [confirmation, setConfirmation] = useState('')
  const [password, setPassword] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)

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

  const eligibility = useQuery({
    queryKey: signatureQueryKeys.eligibility(
      submission?.id ?? 'none',
      currentUserId,
    ),
    queryFn: () =>
      fetchSignatureEligibility(notebookDataClient, submission!, currentUserId),
    enabled: open && Boolean(submission),
  })
  const integrityDigest = revisionQuery.data?.integrity_digest ?? null
  const meanings = availableSignatureMeanings({
    currentUserId,
    submission,
    integrityDigest,
    supersededByRevisionId:
      revisionQuery.data?.superseded_by_revision_id ?? null,
    eligibility: eligibility.data,
    signatures: signaturesQuery.data ?? [],
  })
  const canSign = meanings.length > 0
  const confirmationMatches =
    confirmation.trim().toLowerCase() === currentUserName.trim().toLowerCase()
  const selected = SIGNATURE_MEANING_OPTIONS.find(
    (option) => option.value === meaning,
  )!
  useEffect(() => {
    if (open && canSign) passwordRef.current?.focus()
  }, [open, canSign])
  useEffect(() => {
    if (!meanings.includes(meaning) && meanings[0]) setMeaning(meanings[0])
  }, [meaning, meanings])

  const sign = useMutation({
    mutationFn: async () => {
      if (!submission || !integrityDigest || !meanings.includes(meaning)) {
        throw new DataClientError(
          'validation_error',
          'This revision is not ready to sign.',
          400,
        )
      }
      const enteredPassword = password
      setPassword('')
      const proof = await requestSignatureStepUp({
        workspaceId: submission.workspace_id,
        password: enteredPassword,
        purpose: 'sign',
        submissionId: submission.id,
        revisionDigest: integrityDigest,
        signatureMeaning: meaning,
      })
      return signRevision(notebookDataClient, {
        submissionId: submission.id,
        signatureMeaning: meaning,
        confirmationPhrase: confirmation,
        expectedRevisionDigest: integrityDigest,
        signingToken: proof.token,
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
        await queryClient.invalidateQueries({
          queryKey: signatureQueryKeys.forRecord(submission.record_id),
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
          setPassword('')
          setMeaning('reviewed-and-approved')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent
        initialFocus={passwordRef}
        className="w-[min(560px,calc(100vw-32px))]"
      >
        <DialogHeader
          title="Sign this Notebook"
          description="This records an internal electronic signature against the submitted evidence. It is not a regulatory compliance certification."
        />
        <DialogBody>
          {!canSign ? (
            <p className="m-0 text-body text-fg-muted">
              No eligible signature meaning is available. Signing requires an
              active frozen revision, assignment as a nonauthor reviewer or an
              explicit witness request, and current workspace write permission.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
                <dt className="text-fg-muted">Signer</dt>
                <dd className="m-0">{currentUserName}</dd>
                <dt className="text-fg-muted">Revision</dt>
                <dd className="m-0 font-mono break-all">{revisionId}</dd>
                <dt className="text-fg-muted">Content hash</dt>
                <dd className="m-0 font-mono break-all">
                  {integrityDigest ?? 'Unavailable'}
                </dd>
              </dl>
              <Field
                label="Signing password"
                hint="Re-enter your local signing password for this signature. Three failed attempts lock signing for 15 minutes."
              >
                <Input
                  ref={passwordRef}
                  aria-label="Signing password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field label="Signature meaning">
                <NativeSelect
                  aria-label="Signature meaning"
                  value={meaning}
                  onChange={(event) => {
                    const option = SIGNATURE_MEANING_OPTIONS.find(
                      (item) => item.value === event.target.value,
                    )
                    if (option) setMeaning(option.value)
                  }}
                >
                  {SIGNATURE_MEANING_OPTIONS.filter((option) =>
                    meanings.includes(option.value),
                  ).map((option) => (
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
          {canSign ? (
            <Button
              variant="primary"
              disabled={
                sign.isPending ||
                !password ||
                !confirmationMatches ||
                !integrityDigest
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
