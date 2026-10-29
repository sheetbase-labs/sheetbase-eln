import { rich, t } from '#/copy'
import { returnToHere } from '#/lib/return-to'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { DataClientError } from '#/lib/data-client'
import {
  fetchAvailableReviewWorkflows,
  notebookDataClient,
  previewSubmissionDigest,
  submitRecordRevision,
} from '#/lib/notebook-data'
import type {
  NotebookBlock,
  NotebookRecord,
  SubmissionDigestPreview,
} from '#/lib/notebook-data'
import {
  submissionCanonicalSignature,
  submissionCompositionSummary,
  submissionHasBlockingChecks,
  submissionReadinessChecks,
  submissionSheetInstanceIds,
} from '#/lib/notebook-submission'
import {
  reviewerCandidates,
  reviewerOptionLabel,
} from '#/lib/notebook-experience'
import { workflowLabel } from '#/lib/reviews'
import { useUserNames } from '#/lib/user-names'
import { adminQueryKeys, fetchWorkspaceMembers } from '#/lib/workspace-admin'
import {
  expiredSigningSignInSearch,
  isExpiredSigningSession,
  requestSignatureStepUp,
} from '#/lib/signatures'
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  signatureCertificationDataClient,
  signatureCertificationQueryKeys,
} from '#/lib/signature-certification'

import { BlockPreview } from './block-preview'
import { SubmissionReadinessGuide } from '#/components/assist/submission-readiness-guide'

const WORKFLOW_KEY = 'default-scientific-review'
const WORKFLOW_VERSION = 1

/** Deep copy of a block so the frozen preview cannot observe later edits. */
function cloneBlock(block: NotebookBlock): NotebookBlock {
  return {
    ...block,
    payload:
      typeof structuredClone === 'function'
        ? structuredClone(block.payload)
        : (JSON.parse(JSON.stringify(block.payload)) as Record<
            string,
            unknown
          >),
  }
}

/** The frozen record metadata the preview renders while the digest holds. */
interface FrozenRecordMeta {
  title: string
  status: string
  properties: Record<string, unknown>
  structureVersion: number
  metadataVersion: number
}

function frozenRecordMeta(record: NotebookRecord): FrozenRecordMeta {
  return {
    title: record.title,
    status: record.status,
    properties:
      typeof structuredClone === 'function'
        ? structuredClone(record.properties)
        : (JSON.parse(JSON.stringify(record.properties)) as Record<
            string,
            unknown
          >),
    structureVersion: record.structureVersion,
    metadataVersion: record.metadataVersion,
  }
}

/**
 * Everything the dialog needs to describe "what submitting will pin", bound
 * to the digest the server verified. Rendered exclusively from this snapshot
 * — never from the live props — while it stays valid.
 */
interface VerifiedSubmission {
  digest: SubmissionDigestPreview
  blocks: NotebookBlock[]
  record: FrozenRecordMeta | null
  /** Canonical signature of the inputs at verification time. */
  signature: string
}

/**
 * NOTE-04 — submit dialog with an honest readiness checklist and an evidence
 * preview. The checklist is derived from canonical state (unsaved drafts,
 * lifecycle state, the server digest check, reviewer requirements) and the
 * preview reuses the read-only block previews to show what submission will
 * pin. When `preview_submission_digest` verifies, an exact snapshot of the
 * verified inputs (blocks, record metadata) is frozen into dialog state and
 * bound to the digest via `submissionCanonicalSignature`; any later change to
 * those inputs invalidates the snapshot immediately, so the checklist drops
 * back to pending and the preview is withheld until re-verification. The
 * preview is explicitly not evidence: the frozen snapshot and the record lock
 * are created only when the submit RPC succeeds.
 */
export function SubmitNotebookDialog({
  open,
  onOpenChange,
  recordId,
  projectId,
  reviewerUserId,
  workspaceId,
  record = null,
  blocks = [],
  hasUnsavedWork = false,
  archivedAt = null,
  lockedAt = null,
  activeReview = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  projectId: string
  reviewerUserId: string
  workspaceId?: string
  /** NOTE-04: live record from the route's query cache, for snapshot binding. */
  record?: NotebookRecord | null
  /** NOTE-04: live blocks in document order, for the evidence preview. */
  blocks?: NotebookBlock[]
  /** NOTE-04: NotebookDocument's unsaved-work signal. */
  hasUnsavedWork?: boolean
  /** NOTE-04: lifecycle fields mirrored from the live record. */
  archivedAt?: string | null
  lockedAt?: string | null
  activeReview?: boolean
}) {
  const navigate = useNavigate()
  const [verified, setVerified] = useState<VerifiedSubmission | null>(null)
  // Set when a previously verified snapshot was invalidated by a live
  // change, so the dialog can say why the checklist dropped back to pending.
  const [invalidated, setInvalidated] = useState(false)
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([])
  const reviewerTouched = useRef(false)

  // The reviewer chosen when the experiment was created travels here: the
  // record's own reviewer, else the project's default, and never the author.
  const defaultReviewer = useQuery({
    queryKey: ['ui-port', 'submit-default-reviewer', recordId, projectId],
    queryFn: async () => {
      const own = (
        await notebookDataClient.list<{ reviewer_user_id: string | null }>(
          'records',
          `?id=eq.${recordId}&select=reviewer_user_id&limit=1`,
        )
      ).at(0)
      if (own?.reviewer_user_id) return own.reviewer_user_id
      const parent = (
        await notebookDataClient.list<{
          default_reviewer_user_id: string | null
        }>(
          'projects',
          `?id=eq.${projectId}&select=default_reviewer_user_id&limit=1`,
        )
      ).at(0)
      return parent?.default_reviewer_user_id ?? null
    },
    enabled: open,
    staleTime: 30_000,
  })
  const defaultReviewerId = defaultReviewer.data ?? null
  // WORK-01.1 — optional due date, defaulting to the project's review period.
  const [dueDate, setDueDate] = useState('')
  const [workflowId, setWorkflowId] = useState(
    `${WORKFLOW_KEY}/${WORKFLOW_VERSION}`,
  )
  const [authorPassword, setAuthorPassword] = useState('')
  const [authorConfirmation, setAuthorConfirmation] = useState('')
  const attemptRef = useRef<{ arguments: string; key: string } | null>(null)

  const workflows = useQuery({
    queryKey: ['review-workflows', workspaceId],
    queryFn: () => fetchAvailableReviewWorkflows(notebookDataClient),
    enabled: open,
  })
  const workflow = workflows.data?.find(
    (item) => `${item.definition_key}/${item.version}` === workflowId,
  )

  // J-NBK-07: an Authored signature needs a current certification. Read the
  // author's own attestation so the dialog says so before any password is typed.
  const certifications = useQuery({
    queryKey: signatureCertificationQueryKeys.workspace(workspaceId ?? 'none'),
    queryFn: () =>
      fetchWorkspaceCertifications(
        signatureCertificationDataClient,
        workspaceId!,
      ),
    enabled:
      open && Boolean(workspaceId) && Boolean(workflow?.requires_signature),
  })
  const notCertified =
    Boolean(workflow?.requires_signature) &&
    certifications.isSuccess &&
    !isCurrentStatement(
      certifications.data.find((row) => row.userId === reviewerUserId),
    )

  useEffect(() => {
    setAuthorPassword('')
    setAuthorConfirmation('')
    if (open) {
      setVerified(null)
      setInvalidated(false)
      reviewerTouched.current = false
      setSelectedReviewerIds([])
      setDueDate('')
      setWorkflowId(`${WORKFLOW_KEY}/${WORKFLOW_VERSION}`)
      attemptRef.current = null
    }
  }, [open, reviewerUserId])

  // NOTE-04 review fix: the live signature of the canonical inputs the
  // digest covers. While a verified snapshot exists, any drift between this
  // and the signature captured at verification time (record metadata, block
  // ids/versions/payloads) invalidates the snapshot immediately.
  const liveSignature = submissionCanonicalSignature({ record, blocks })
  useEffect(() => {
    setVerified((current) => {
      if (!current || current.signature === liveSignature) return current
      setInvalidated(true)
      return null
    })
  }, [liveSignature])

  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId ?? 'none'),
    queryFn: () => fetchWorkspaceMembers(notebookDataClient, workspaceId!),
    enabled: open && Boolean(workspaceId),
  })
  // A review decision is refused without Review access on the project, so
  // anyone without it is shown but cannot be chosen. While the answer is
  // unknown nobody is excluded; the server still refuses the decision.
  const reviewAccess = useQuery({
    queryKey: ['ui-port', 'project-review-candidates', projectId],
    queryFn: () =>
      notebookDataClient.rpc<Array<{ user_id: string }>>(
        'project_review_candidates',
        { p_project_id: projectId },
      ),
    enabled: open && Boolean(projectId),
    staleTime: 30_000,
  })
  const canReview = (userId: string) =>
    !reviewAccess.data ||
    reviewAccess.data.some((row) => row.user_id === userId)
  const reviewers = reviewerCandidates(members.data ?? [])
  const shownReviewers =
    reviewers.length > 0
      ? reviewers
      : [{ userId: reviewerUserId, role: 'member', suspendedAt: null }]
  // `workspace_memberships` carries no name, so the candidate list is resolved
  // to display names the same way the rest of the app does. Without this the
  // options read "00000000 · member" — every seeded id shares its first eight
  // characters.
  // Default reviewer: the record's, else the project's, never the author. A
  // workspace where the author is the only eligible reviewer has no one else
  // to default to, so the author stays selected there.
  const reviewersSettled = !members.isFetching && !defaultReviewer.isFetching
  useEffect(() => {
    if (!open || reviewerTouched.current || !reviewersSettled) return
    if (defaultReviewerId && defaultReviewerId !== reviewerUserId) {
      setSelectedReviewerIds([defaultReviewerId])
    } else if (!reviewers.some((member) => member.userId !== reviewerUserId)) {
      setSelectedReviewerIds([reviewerUserId])
    }
  }, [open, reviewersSettled, defaultReviewerId, reviewerUserId])
  const { names: reviewerNames } = useUserNames(
    shownReviewers.map((member) => member.userId),
  )

  // Latest observed canonical inputs and their signature, maintained
  // synchronously during render — not in an effect. A verification response
  // that settles after changed props have committed therefore always reads
  // the committed inputs, closing the window where an effect hadn't run yet
  // and a stale response was accepted against pre-change inputs.
  const inputsRef = useRef({ record, blocks })
  inputsRef.current = { record, blocks }
  const liveSignatureRef = useRef(liveSignature)
  liveSignatureRef.current = liveSignature
  // Signature of the inputs at the moment the verify request was issued. If
  // the live inputs drift while the RPC is in flight, the render-maintained
  // signature differs at response time and onSuccess discards the response.
  const requestSignatureRef = useRef<string | null>(null)

  const preview = useMutation({
    mutationFn: () => {
      requestSignatureRef.current = liveSignatureRef.current
      return previewSubmissionDigest(notebookDataClient, recordId)
    },
    onSuccess: (result) => {
      const { record: verifiedRecord, blocks: verifiedBlocks } =
        inputsRef.current
      // NOTE-04 in-flight race: compare the request-time signature against
      // the latest render-maintained signature. If the inputs changed while
      // the RPC was pending, this response verifies stale content — discard
      // it (do not set the snapshot) and leave the checklist pending until a
      // fresh verification.
      if (
        requestSignatureRef.current === null ||
        liveSignatureRef.current !== requestSignatureRef.current
      ) {
        setInvalidated(true)
        return
      }
      setVerified({
        digest: result,
        blocks: verifiedBlocks.map(cloneBlock),
        record: verifiedRecord ? frozenRecordMeta(verifiedRecord) : null,
        // Bind the frozen snapshot to the signature of the inputs the
        // server verified — any later drift invalidates the snapshot.
        signature: requestSignatureRef.current,
      })
      setInvalidated(false)
    },
  })
  const submit = useMutation({
    mutationFn: async () => {
      if (!workflow || !verified || submissionHasBlockingChecks(checks))
        throw new Error(
          t('notebook.submitNotebookDialog.checkTheCurrentSnapshot2'),
        )
      const input = {
        recordId,
        expectedSourceDigest: verified.digest.sourceDigest,
        workflowDefinitionKey: workflow.definition_key,
        workflowDefinitionVersion: workflow.version,
        reviewerUserIds: [...new Set(selectedReviewerIds)].sort(),
        dueAt: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
      }
      const argumentsKey = JSON.stringify(input)
      if (attemptRef.current?.arguments !== argumentsKey) {
        attemptRef.current = {
          arguments: argumentsKey,
          key: crypto.randomUUID(),
        }
      }
      const idempotencyKey = attemptRef.current.key
      if (!workflow.requires_signature)
        return submitRecordRevision(notebookDataClient, {
          ...input,
          idempotencyKey,
        })
      if (!workspaceId || !authorPassword || !authorConfirmation.trim())
        throw new Error(
          t('notebook.submitNotebookDialog.enterYourSigningPassword'),
        )
      const password = authorPassword
      setAuthorPassword('')
      const proof = await requestSignatureStepUp({
        workspaceId,
        purpose: 'author-submit',
        password,
        recordId,
        revisionDigest: input.expectedSourceDigest,
        workflowDefinitionKey: input.workflowDefinitionKey,
        workflowDefinitionVersion: input.workflowDefinitionVersion,
        reviewerUserIds: input.reviewerUserIds,
        confirmed: true,
        idempotencyKey,
        dueAt: input.dueAt,
      })
      if (liveSignatureRef.current !== verified.signature)
        throw new Error(
          t('notebook.submitNotebookDialog.theNotebookChangedCheck'),
        )
      return submitRecordRevision(notebookDataClient, {
        ...input,
        idempotencyKey,
        authorSigningToken: proof.token,
        authorConfirmationPhrase: authorConfirmation,
      })
    },
    onSuccess: (result) => {
      onOpenChange(false)
      void navigate({
        to: '/review/$revisionId',
        params: { revisionId: result.revision.id },
      })
    },
    // NOTE-04 review fix: a server rejection (e.g. SB001 — the source
    // changed since the check snapshot) must invalidate the stale
    // snapshot, or the checklist keeps claiming the digest is verified
    // while Submit stays enabled against the same stale digest.
    onError: (error) => {
      setVerified(null)
      if (isExpiredSigningSession(error)) {
        // The step-up saw no live session: a retry cannot succeed, so send the
        // author to sign in and back to this notebook.
        onOpenChange(false)
        void navigate({
          to: '/sign-in',
          search: expiredSigningSignInSearch(window.location.pathname),
        })
      }
    },
  })

  const previewErrorMessage =
    preview.error instanceof DataClientError
      ? preview.error.message
      : preview.error instanceof Error
        ? preview.error.message
        : null
  const submitErrorMessage = isExpiredSigningSession(submit.error)
    ? t('notebook.submitNotebookDialog.yourSessionHasExpired')
    : submit.error instanceof DataClientError
      ? submit.error.message
      : submit.error instanceof Error
        ? submit.error.message
        : null

  const checks = submissionReadinessChecks({
    hasUnsavedWork,
    archivedAt,
    lockedAt,
    activeReview,
    reviewerCount: selectedReviewerIds.length,
    digest: verified?.digest.sourceDigest ?? null,
    digestPending: preview.isPending,
    digestError: previewErrorMessage,
  })
  const blocked = submissionHasBlockingChecks(checks)
  // A draft experiment is readable only by its creator and the workspace
  // owners, so a reviewer outside that set would be assigned work they cannot
  // open. Say so here rather than leave the reviewer with a dead end.
  const draftExperiment =
    record?.kind === 'experiment' && record.status === 'draft'
  const unreadableReviewers = draftExperiment
    ? selectedReviewerIds.filter(
        (id) =>
          id !== reviewerUserId &&
          shownReviewers.find((member) => member.userId === id)?.role !==
            'owner',
      )
    : []
  // NOTE-04 review fix: the evidence preview and its composition summary
  // render from the FROZEN snapshot, never from the live blocks, so the
  // dialog cannot claim "verified" while showing different content. The
  // "Sheets to check" links stay live — they are readiness navigation, not
  // the evidence preview.
  const frozenBlocks = verified?.blocks ?? []
  const sheetInstanceIds = submissionSheetInstanceIds(blocks)
  const composition = submissionCompositionSummary(frozenBlocks)
  const orderedBlocks = [...frozenBlocks].sort((a, b) => a.order - b.order)

  function toggleReviewer(userId: string) {
    reviewerTouched.current = true
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
        if (!next) {
          setVerified(null)
          setInvalidated(false)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader
          title={t('notebook.submitNotebookDialog.title')}
          description={t('notebook.submitNotebookDialog.description')}
        />
        <DialogBody className="text-body">
          <Field label={t('notebook.submitNotebookDialog.label')}>
            <select
              aria-label={t('notebook.submitNotebookDialog.label')}
              value={workflowId}
              disabled={submit.isPending || workflows.isPending}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              onChange={(event) => {
                setWorkflowId(event.target.value)
                setAuthorPassword('')
                setAuthorConfirmation('')
              }}
            >
              {(workflows.data ?? []).map((item) => (
                <option
                  key={`${item.definition_key}/${item.version}`}
                  value={`${item.definition_key}/${item.version}`}
                >
                  {workflowLabel(item.definition_key)} (v{item.version})
                  {item.requires_signature
                    ? t(
                        'notebook.submitNotebookDialog.authoredSignatureRequired',
                      )
                    : ''}
                </option>
              ))}
            </select>
          </Field>
          {workflows.isError ? (
            <Notice tone="bad">
              {t('notebook.submitNotebookDialog.reviewWorkflowsCouldNot')}
            </Notice>
          ) : null}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t('notebook.submitNotebookDialog.reviewers')}
            </legend>
            {shownReviewers.map((member) => (
              <label
                key={member.userId}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  disabled={
                    submit.isPending ||
                    (!canReview(member.userId) &&
                      !selectedReviewerIds.includes(member.userId))
                  }
                  checked={selectedReviewerIds.includes(member.userId)}
                  onCheckedChange={() => toggleReviewer(member.userId)}
                />
                <span>
                  {reviewerOptionLabel(
                    { ...member, name: reviewerNames[member.userId] },
                    reviewerUserId,
                  )}
                  {canReview(member.userId) ? null : (
                    <span className="text-fg-muted">
                      {t('notebook.submitNotebookDialog.noReviewAccessTo')}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          <Field
            label={t('notebook.submitNotebookDialog.dueDateOptionalLabel')}
            hint={t('notebook.submitNotebookDialog.hint')}
          >
            <Input
              type="date"
              disabled={submit.isPending}
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              aria-label={t('notebook.submitNotebookDialog.ariaLabel')}
            />
          </Field>

          {workflow?.requires_signature ? (
            <fieldset
              className="space-y-3"
              disabled={submit.isPending || notCertified}
            >
              <legend className="text-sm font-medium">
                {t('notebook.submitNotebookDialog.authoredSignature')}
              </legend>
              {notCertified ? (
                <Notice tone="warn">
                  <p className="m-0">
                    {t('notebook.submitNotebookDialog.thisWorkflowNeedsYour')}
                  </p>
                  <p className="m-0 mt-1.5 text-label">
                    {t(
                      'notebook.submitNotebookDialog.certifyInSettingsElectronic',
                    )}
                  </p>
                  <p className="m-0 mt-1.5">
                    <Link
                      to="/settings/my-signature"
                      search={{ returnTo: returnToHere('submit') }}
                      className="underline"
                    >
                      {t('notebook.submitNotebookDialog.openSignatureSettings')}
                    </Link>
                  </p>
                </Notice>
              ) : null}
              <p className="text-xs text-fg-muted">
                {t('notebook.submitNotebookDialog.iAuthoredTheExact')}
              </p>
              <Field
                label={t('notebook.submitNotebookDialog.signingPasswordLabel')}
                hint={t('notebook.submitNotebookDialog.signingPasswordHint')}
              >
                <Input
                  aria-label={t(
                    'notebook.submitNotebookDialog.authorSigningPasswordAriaLabel',
                  )}
                  type="password"
                  autoComplete="current-password"
                  value={authorPassword}
                  onChange={(event) => setAuthorPassword(event.target.value)}
                />
              </Field>
              <Field
                label={t('notebook.submitNotebookDialog.typeYourNameToLabel')}
              >
                <Input
                  aria-label={t(
                    'notebook.submitNotebookDialog.authorSignatureConfirmationAriaLabel',
                  )}
                  autoComplete="off"
                  value={authorConfirmation}
                  onChange={(event) =>
                    setAuthorConfirmation(event.target.value)
                  }
                />
              </Field>
              <p className="text-xs text-fg-muted">
                {t('notebook.submitNotebookDialog.threeFailedPasswordAttempts')}
              </p>
            </fieldset>
          ) : null}

          {/* NOTE-04: readiness derived from canonical state plus the
              server-owned digest check — no invented validation rules. */}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">
              {t('notebook.submitNotebookDialog.readiness')}
            </legend>
            <ul className="space-y-1.5" data-testid="submission-readiness">
              {checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={
                      check.state === 'pass'
                        ? 'mt-0.5 font-medium text-success-text'
                        : check.state === 'fail'
                          ? 'mt-0.5 font-medium text-danger-text'
                          : 'mt-0.5 font-medium text-fg-muted'
                    }
                  >
                    {check.state === 'pass'
                      ? '✓'
                      : check.state === 'fail'
                        ? '✕'
                        : '…'}
                  </span>
                  <span>
                    <span
                      className={
                        check.state === 'fail'
                          ? 'font-medium text-danger-text'
                          : 'font-medium text-fg'
                      }
                    >
                      {check.label}
                    </span>
                    <span className="block text-fg-muted">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {sheetInstanceIds.length > 0 ? (
              <p className="text-xs text-fg-muted">
                {rich('notebook.submitNotebookDialog.sheetsToCheck', {
                  sheets: sheetInstanceIds.map((instanceId, index) => (
                    <span key={instanceId}>
                      {index > 0 ? ', ' : null}
                      <Link
                        to="/sheets/$sheetId"
                        params={{ sheetId: instanceId }}
                        search={{ projectId }}
                        className="underline underline-offset-2 hover:text-fg"
                      >
                        {t('notebook.submitNotebookDialog.sheetInstanceid', {
                          instanceId: instanceId.slice(0, 8),
                        })}
                      </Link>
                    </span>
                  )),
                })}
              </p>
            ) : null}
          </fieldset>
          {/* ASSIST-03: step-aware guidance over the same canonical inputs
              as the readiness checklist above. Its snapshot accept runs the
              dialog's own check and its submit accept runs the dialog's own
              guarded submit; review accepts navigate to the review
              workspace. */}
          <details className="rounded-md border border-border-subtle">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-fg-muted">
              {t('notebook.submitNotebookDialog.stepByStepGuide')}
            </summary>
            <div className="p-2">
              <SubmissionReadinessGuide
                recordId={recordId}
                hasUnsavedWork={hasUnsavedWork}
                archivedAt={archivedAt}
                lockedAt={lockedAt}
                activeReview={activeReview}
                reviewerCount={selectedReviewerIds.length}
                digest={verified?.digest.sourceDigest ?? null}
                digestPending={preview.isPending}
                digestError={previewErrorMessage}
                onCheckSnapshot={() => preview.mutate()}
                onSubmitRevision={() => submit.mutate()}
                onOpenReviews={() => {
                  void navigate({ to: '/inbox' })
                }}
              />
            </div>
          </details>

          {/* NOTE-04: preview of what submission will pin, rendered from
              the frozen snapshot bound to the verified digest. Reuses the
              read-only block previews; labelled as a preview, not evidence. */}
          {verified ? (
            <section
              aria-label={t(
                'notebook.submitNotebookDialog.evidencePreviewAriaLabel',
              )}
              className="space-y-2 rounded-md border p-3"
            >
              <p className="text-xs font-medium text-fg" role="status">
                {t('notebook.submitNotebookDialog.previewWhatSubmittingWill')}
              </p>
              <p className="text-xs text-fg-muted">
                {t('notebook.submitNotebookDialog.thisIsAPreview')}
              </p>
              <p className="text-xs text-fg-muted">
                {t('notebook.submitNotebookDialog.compositionBlocks', {
                  count: composition.blockCount,
                })}{' '}
                ·{' '}
                {t('notebook.submitNotebookDialog.compositionSheets', {
                  count: composition.sheetCount,
                })}{' '}
                ·{' '}
                {t('notebook.submitNotebookDialog.compositionVersions', {
                  structure: verified.digest.structureVersion,
                  metadata: verified.digest.metadataVersion,
                  calculation: verified.digest.calculationInputRevision,
                })}
              </p>
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {orderedBlocks.length === 0 ? (
                  <p className="text-xs text-fg-muted">
                    {t('notebook.submitNotebookDialog.thisNotebookHasNo')}
                  </p>
                ) : (
                  orderedBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="rounded border border-border-subtle p-2"
                    >
                      <BlockPreview block={block} />
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {unreadableReviewers.length > 0 ? (
            <Notice tone="warn">
              {t(
                'notebook.submitNotebookDialog.unreadablereviewersCannotOpenA',
                {
                  unreadableReviewers: unreadableReviewers
                    .map(
                      (id) =>
                        reviewerNames[id] ??
                        t('notebook.submitNotebookDialog.aReviewer'),
                    )
                    .join(', '),
                },
              )}
            </Notice>
          ) : null}
          {verified ? (
            <p className="text-fg-muted" role="status">
              {t('notebook.submitNotebookDialog.snapshotIsReadyTo')}
              <span className="mt-1 block break-all font-mono text-xs">
                {t('notebook.submitNotebookDialog.integrityCheckSourcedigest', {
                  sourceDigest: verified.digest.sourceDigest,
                })}
              </span>
            </p>
          ) : invalidated ? (
            <p className="text-fg-muted" role="status">
              {t('notebook.submitNotebookDialog.theNotebookChangedSince')}
            </p>
          ) : (
            <p className="text-fg-muted">
              {t('notebook.submitNotebookDialog.checkTheCurrentSnapshot')}
            </p>
          )}
          {previewErrorMessage ? (
            <Notice tone="bad">{previewErrorMessage}</Notice>
          ) : null}
          {submitErrorMessage ? (
            <Notice tone="bad">{submitErrorMessage}</Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={preview.isPending}
            onClick={() => preview.mutate()}
          >
            {t('notebook.submitNotebookDialog.checkSnapshot')}
          </Button>
          <Button
            type="button"
            disabled={
              submit.isPending ||
              preview.isPending ||
              blocked ||
              unreadableReviewers.length > 0 ||
              selectedReviewerIds.some((id) => !canReview(id)) ||
              !verified ||
              !workflow ||
              (workflow.requires_signature &&
                (notCertified ||
                  !workspaceId ||
                  !authorPassword ||
                  !authorConfirmation.trim())) ||
              selectedReviewerIds.length === 0
            }
            onClick={() => submit.mutate()}
          >
            {t('common.actions.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
