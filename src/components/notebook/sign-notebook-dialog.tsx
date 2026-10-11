import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Notice } from '#/components/v3/ui/alert'
import { DataClientError } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { notebookQueryKeysAfterSignature } from '#/lib/notebook-experience'
import {
  fetchReviewSubmissionByRevision,
  fetchRevisionRow,
  reviewWorkspaceQueryKeys,
} from '#/lib/review-workspace'
import {
  availableSignatureMeanings,
  fetchSignatureEligibility,
  fetchSignaturesForSubmission,
  signatureQueryKeys,
  signRevision,
  requestSignatureStepUp,
} from '#/lib/signatures'
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  signatureCertificationDataClient,
  signatureCertificationQueryKeys,
} from '#/lib/signature-certification'
import { ESignDialog } from './e-sign-dialog'
import type { ESignSubmitInput } from './e-sign-dialog'

/**
 * R5-NOTE-02: the Notebook signature dialog now renders the shared
 * `ESignDialog` over the unchanged REV-03 contract. The step-up (`purpose:
 * 'sign'`) and the `sign_revision` write stay here, keyed to this revision's
 * digest; the dialog owns only the entered meaning, confirmation and password.
 */
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
  // A signature needs a current certification (DEC-04 / ADR-0045). Read the
  // signer's own attestation so the dialog can say so before a password attempt
  // is refused by the server.
  const certificationsQuery = useQuery({
    queryKey: signatureCertificationQueryKeys.workspace(
      submission?.workspace_id ?? 'none',
    ),
    queryFn: () =>
      fetchWorkspaceCertifications(
        signatureCertificationDataClient,
        submission!.workspace_id,
      ),
    enabled: open && Boolean(submission),
  })
  const certification = (certificationsQuery.data ?? []).find(
    (row) => row.userId === currentUserId,
  )
  const certificationCurrent = isCurrentStatement(certification)
  const integrityDigest = revisionQuery.data?.integrity_digest ?? null
  const meanings = availableSignatureMeanings({
    currentUserId,
    submission,
    integrityDigest,
    supersededByRevisionId:
      revisionQuery.data?.superseded_by_revision_id ?? null,
    eligibility: eligibility.data,
    certificationCurrent,
    signatures: signaturesQuery.data ?? [],
  })
  const canSign = meanings.length > 0

  const sign = useMutation({
    mutationFn: async (input: ESignSubmitInput) => {
      if (
        !submission ||
        !integrityDigest ||
        !meanings.includes(input.meaning)
      ) {
        throw new DataClientError(
          'validation_error',
          'This revision is not ready to sign.',
          400,
        )
      }
      const proof = await requestSignatureStepUp({
        workspaceId: submission.workspace_id,
        password: input.password,
        purpose: 'sign',
        submissionId: submission.id,
        revisionDigest: integrityDigest,
        signatureMeaning: input.meaning,
      })
      return signRevision(notebookDataClient, {
        submissionId: submission.id,
        signatureMeaning: input.meaning,
        confirmationPhrase: input.confirmation,
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

  const blocked = !canSign ? (
    !certificationsQuery.isSuccess ? (
      <p className="m-0 text-body text-fg-muted">
        Checking your signature certification…
      </p>
    ) : certificationCurrent ? (
      <p className="m-0 text-body text-fg-muted">
        No eligible signature meaning is available. Signing requires an active
        frozen revision, assignment as a nonauthor reviewer or an explicit
        witness request, and current workspace write permission.
      </p>
    ) : (
      <Notice tone="warn">
        <p className="m-0">
          Certification is required before you can sign. Your electronic
          signature is not certified for this workspace; an uncertified
          signature is not accepted.
        </p>
        <p className="m-0 mt-1.5 text-label">
          Certify in Settings → Electronic signatures: confirm your identity
          with an administrator, agree to the statement and enter your signing
          password. A practice signature is offered there and is not stored.
        </p>
        <p className="m-0 mt-1.5">
          <Link to="/settings/signatures" className="underline">
            Open signature settings
          </Link>
        </p>
      </Notice>
    )
  ) : null

  return (
    <ESignDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sign this Notebook"
      description="This records an internal electronic signature against the submitted evidence. It is not a regulatory compliance certification."
      signingAs={currentUserName}
      subject={{ revisionId, digest: integrityDigest }}
      meanings={meanings}
      blocked={blocked}
      busy={sign.isPending}
      errorMessage={errorMessage}
      onSubmit={(input) => sign.mutate(input)}
    />
  )
}
