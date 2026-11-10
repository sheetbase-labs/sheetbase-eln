import {
  absenceKeys,
  absenceOf,
  absenceState,
  fetchAbsences,
} from '#/lib/absences'
import { formatDate } from '#/lib/format-date'
import { rich, t } from '#/copy'
import { returnToHere } from '#/lib/return-to'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Person } from '#/components/ui/person'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
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
import {
  adminQueryKeys,
  fetchWorkspaceMembers,
  WORKSPACE_ROLE_LABELS,
} from '#/lib/workspace-admin'
import {
  expiredSigningSignInSearch,
  isExpiredSigningSession,
  requestSignatureStepUp,
} from '#/lib/signatures'
import { useDemoSigning } from '#/lib/demo-signing'
import { useSignaturePolicy } from '#/lib/use-signature-policy'
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  signatureCertificationDataClient,
  signatureCertificationQueryKeys,
} from '#/lib/signature-certification'

import { BlockPreview } from './block-preview'
import { useCommittedRef } from './use-committed-ref'
import { runDefaultRevisionChecks } from '#/lib/review-checks'

const WORKFLOW_KEY = 'default-scientific-review'
const WORKFLOW_VERSION = 1

/** Deep copy of a block so the frozen preview cannot observe later edits. */
function cloneBlock(block: NotebookBlock): NotebookBlock {
  return {
    ...block,
    payload: structuredClone(block.payload),
  }
}

/** The frozen record metadata the preview renders while the digest holds. */
interface FrozenRecordMeta {
  title: string
  status: string
  properties: NotebookRecord['properties']
  structureVersion: number
  metadataVersion: number
}

function frozenRecordMeta(record: NotebookRecord): FrozenRecordMeta {
  return {
    title: record.title,
    status: record.status,
    properties: structuredClone(record.properties),
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
function useNotebookSubmission({
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

  const {
    verified,
    invalidated,
    preview,
    liveSignatureRef,
    resetVerification,
    refuseVerification,
  } = useSubmissionPreview({
    open,
    recordId,
    reviewerUserId,
    record,
    blocks,
    hasUnsavedWork,
  })

  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([])
  const selectedReviewers = new Set(selectedReviewerIds)
  const reviewerTouched = useRef(false)

  const {
    canReview,
    shownReviewers,
    reviewersSettled,
    automaticReviewerId,
    reviewerNames,
    absences,
  } = useSubmissionCandidates({
    open,
    recordId,
    projectId,
    workspaceId,
    reviewerUserId,
  })

  // WORK-01.1 — optional due date, defaulting to the project's review period.
  const [dueDate, setDueDate] = useState('')

  const [workflowId, setWorkflowId] = useState(
    `${WORKFLOW_KEY}/${WORKFLOW_VERSION}`,
  )

  const demoSigning = useDemoSigning()
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

  // A workspace that reviews one way offers only that workflow: start on it.
  const offeredFirst = workflows.data?.[0]
  useEffect(() => {
    if (offeredFirst && !workflow) {
      setWorkflowId(`${offeredFirst.definition_key}/${offeredFirst.version}`)
    }
  }, [offeredFirst, workflow])
  const { reviewWorkflow } = useSignaturePolicy(workspaceId)

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

  const [session, setSession] = useState({ open, reviewerUserId })

  if (session.open !== open || session.reviewerUserId !== reviewerUserId) {
    setSession({ open, reviewerUserId })
    setAuthorPassword('')
    setAuthorConfirmation('')

    if (open) {
      setSelectedReviewerIds([])
      setDueDate('')
      setWorkflowId(`${WORKFLOW_KEY}/${WORKFLOW_VERSION}`)
    }
  }

  // Refs are reset only for committed sessions, not abandoned renders.
  useEffect(() => {
    if (open) {
      reviewerTouched.current = false
      attemptRef.current = null
    }
  }, [open, reviewerUserId])

  useEffect(() => {
    if (!open || reviewerTouched.current || !reviewersSettled) return

    if (automaticReviewerId) setSelectedReviewerIds([automaticReviewerId])
  }, [open, reviewersSettled, automaticReviewerId])

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

      if (
        !workspaceId ||
        (!demoSigning && !authorPassword) ||
        !authorConfirmation.trim()
      )
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
    onSuccess: async (result) => {
      onOpenChange(false)

      // The review opens with its checks already run, so the reviewer can
      // approve and sign without first having to find them. A failure here is
      // not the author's problem: the review page runs them again.
      try {
        await runDefaultRevisionChecks(notebookDataClient, result.revision.id)
      } catch {
        // retried on the review page
      }

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
      refuseVerification()

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

  const previewErrorMessage = submissionErrorMessage(preview.error)

  const submitErrorMessage = isExpiredSigningSession(submit.error)
    ? t('notebook.submitNotebookDialog.yourSessionHasExpired')
    : submissionErrorMessage(submit.error)

  const checks = submissionReadinessChecks({
    hasUnsavedWork,
    archivedAt,
    lockedAt,
    activeReview,
    reviewerCount: selectedReviewerIds.length,
    minReviewers: reviewWorkflow.enabled ? reviewWorkflow.minReviewers : 1,
    digest: verified?.digest.sourceDigest ?? null,
    digestPending: preview.isPending,
    digestError: previewErrorMessage,
    sheetCount: submissionSheetInstanceIds(blocks).length,
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
  const sheetInstanceIds = submissionSheetInstanceIds(blocks)

  function toggleReviewer(userId: string) {
    reviewerTouched.current = true
    setSelectedReviewerIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    )
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetVerification()

    onOpenChange(next)
  }

  return {
    workflows,
    workflowId,
    setWorkflowId,
    submit,
    shownReviewers,
    canReview,
    selectedReviewers,
    toggleReviewer,
    reviewerNames,
    absences,
    dueDate,
    setDueDate,
    workflow,
    notCertified,
    demoSigning,
    authorPassword,
    setAuthorPassword,
    authorConfirmation,
    setAuthorConfirmation,
    checks,
    sheetInstanceIds,
    verified,
    unreadableReviewers,
    invalidated,
    previewErrorMessage,
    preview,
    submitErrorMessage,
    blocked,
    selectedReviewerIds,
    handleOpenChange,
  }
}

/** Own verification lifetime and reject responses for superseded canonical inputs. */
function useSubmissionPreview({
  open,
  recordId,
  reviewerUserId,
  record,
  blocks,
  hasUnsavedWork,
}: Pick<
  Parameters<typeof useNotebookSubmission>[0],
  'open' | 'recordId' | 'reviewerUserId'
> & {
  record: NotebookRecord | null
  blocks: NotebookBlock[]
  hasUnsavedWork: boolean
}) {
  const [verified, setVerified] = useState<VerifiedSubmission | null>(null)
  const [invalidated, setInvalidated] = useState(false)
  const [session, setSession] = useState({ open, reviewerUserId })

  if (session.open !== open || session.reviewerUserId !== reviewerUserId) {
    setSession({ open, reviewerUserId })

    if (open) {
      setVerified(null)
      setInvalidated(false)
    }
  }

  // Bind the digest to canonical metadata and ordered block versions/payloads.
  const liveSignature = submissionCanonicalSignature({ record, blocks })

  if (verified && verified.signature !== liveSignature) {
    setInvalidated(true)
    setVerified(null)
  }

  // Only committed inputs may supersede the last committed snapshot.
  const inputsRef = useCommittedRef({ record, blocks })
  const liveSignatureRef = useCommittedRef(liveSignature)
  const requestSignatureRef = useRef<string | null>(null)

  const preview = useMutation({
    mutationFn: () => {
      requestSignatureRef.current = liveSignatureRef.current

      return previewSubmissionDigest(notebookDataClient, recordId)
    },
    onSuccess: (result) => {
      const { record: verifiedRecord, blocks: verifiedBlocks } =
        inputsRef.current

      // A response for inputs superseded while the request was pending is stale.
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
        signature: requestSignatureRef.current,
      })
      setInvalidated(false)
    },
  })

  // Check automatically, once per canonical version, and never over a draft.
  const checkedSignature = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      checkedSignature.current = null

      return
    }

    if (hasUnsavedWork || verified || preview.isPending) return

    if (checkedSignature.current === liveSignature) return
    checkedSignature.current = liveSignature
    preview.mutate()
  }, [open, hasUnsavedWork, verified, preview, liveSignature])

  function resetVerification() {
    setVerified(null)
    setInvalidated(false)
  }

  function refuseVerification() {
    setVerified(null)
    // A server refusal usually means the notebook moved on; check again.
    checkedSignature.current = null
  }

  return {
    verified,
    invalidated,
    preview,
    liveSignatureRef,
    resetVerification,
    refuseVerification,
  }
}

/** Resolve project review access, defaults, names and absence cover, not draft choices. */
function useSubmissionCandidates({
  open,
  recordId,
  projectId,
  workspaceId,
  reviewerUserId,
}: Pick<
  Parameters<typeof useNotebookSubmission>[0],
  'open' | 'recordId' | 'projectId' | 'workspaceId' | 'reviewerUserId'
>) {
  // The record's reviewer takes precedence over its project's default.
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

  const absences = useQuery({
    queryKey: absenceKeys.all(workspaceId ?? 'none'),
    queryFn: () => fetchAbsences(notebookDataClient, workspaceId!),
    enabled: open && Boolean(workspaceId),
  })

  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId ?? 'none'),
    queryFn: () => fetchWorkspaceMembers(notebookDataClient, workspaceId!),
    enabled: open && Boolean(workspaceId),
  })

  // Unknown access does not exclude a candidate; the server still owns refusal.
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

  const reviewers = reviewerCandidates(members.data ?? []).filter((member) =>
    canReview(member.userId),
  )

  // Nobody reviews their own work unless they are the only eligible person.
  const others = reviewers.filter((member) => member.userId !== reviewerUserId)

  const shownReviewers =
    others.length > 0
      ? others
      : reviewers.length > 0
        ? reviewers
        : [{ userId: reviewerUserId, role: 'member', suspendedAt: null }]

  const defaultReviewerId = defaultReviewer.data ?? null
  const reviewersSettled = !members.isFetching && !defaultReviewer.isFetching

  const automaticReviewerId = automaticSubmissionReviewer({
    defaultReviewerId,
    reviewerUserId,
    others,
  })

  const { names: reviewerNames } = useUserNames([
    ...shownReviewers.map((member) => member.userId),
    ...(absences.data ?? []).flatMap((absence) =>
      absence.delegateUserId ? [absence.delegateUserId] : [],
    ),
  ])

  return {
    canReview,
    shownReviewers,
    reviewersSettled,
    automaticReviewerId,
    reviewerNames,
    absences,
  }
}

/** Prefer the configured reviewer; otherwise auto-select only an unambiguous choice. */
function automaticSubmissionReviewer({
  defaultReviewerId,
  reviewerUserId,
  others,
}: {
  defaultReviewerId: string | null
  reviewerUserId: string
  others: ReturnType<typeof reviewerCandidates>
}) {
  if (defaultReviewerId && defaultReviewerId !== reviewerUserId)
    return defaultReviewerId

  if (others.length === 0) return reviewerUserId

  return others.length === 1 ? others[0].userId : null
}

function submissionErrorMessage(error: Error | null) {
  return error instanceof Error ? error.message : null
}

export function SubmitNotebookDialog(
  props: Parameters<typeof useNotebookSubmission>[0],
) {
  const { open, projectId, reviewerUserId, workspaceId } = props
  const submission = useNotebookSubmission(props)

  const {
    workflows,
    workflowId,
    setWorkflowId,
    submit,
    shownReviewers,
    canReview,
    selectedReviewers,
    toggleReviewer,
    reviewerNames,
    absences,
    dueDate,
    setDueDate,
    workflow,
    notCertified,
    demoSigning,
    authorPassword,
    setAuthorPassword,
    authorConfirmation,
    setAuthorConfirmation,
    checks,
    sheetInstanceIds,
    verified,
    unreadableReviewers,
    invalidated,
    previewErrorMessage,
    preview,
    submitErrorMessage,
    handleOpenChange,
  } = submission

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader
          title={t('notebook.submitNotebookDialog.title')}
          description={t('notebook.submitNotebookDialog.description')}
        />
        <DialogBody className="text-body">
          {(workflows.data?.length ?? 0) > 1 ? (
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
          ) : null}
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
                      !selectedReviewers.has(member.userId))
                  }
                  checked={selectedReviewers.has(member.userId)}
                  onCheckedChange={() => toggleReviewer(member.userId)}
                />
                <Person
                  userId={member.userId}
                  name={reviewerOptionLabel(
                    {
                      ...member,
                      role:
                        new Map(Object.entries(WORKSPACE_ROLE_LABELS)).get(
                          member.role,
                        ) ?? member.role,
                      name: reviewerNames[member.userId],
                    },
                    reviewerUserId,
                  )}
                />
                {(() => {
                  const away = absenceOf(absences.data ?? [], member.userId)

                  if (!away || absenceState(away) !== 'away') return null
                  const date = formatDate(away.endsOn, { year: false })

                  return (
                    <span className="text-fg-muted">
                      {' · '}
                      {away.delegateUserId
                        ? t('people.away.badgeCovered', {
                            date,
                            name:
                              reviewerNames[away.delegateUserId] ??
                              away.delegateUserId.slice(0, 8),
                          })
                        : t('people.away.badge', { date })}
                    </span>
                  )
                })()}
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
            <SubmissionAuthorSignature
              pending={submit.isPending}
              notCertified={notCertified}
              demoSigning={demoSigning}
              authorPassword={authorPassword}
              setAuthorPassword={setAuthorPassword}
              authorConfirmation={authorConfirmation}
              setAuthorConfirmation={setAuthorConfirmation}
            />
          ) : null}

          {/* NOTE-04: readiness derived from canonical state plus the
              server-owned digest check — no invented validation rules. */}
          <SubmissionReadiness
            checks={checks}
            sheetInstanceIds={sheetInstanceIds}
            projectId={projectId}
          />
          {/* NOTE-04: preview of what submission will pin, rendered from
              the frozen snapshot bound to the verified digest. Reuses the
              read-only block previews; labelled as a preview, not evidence. */}
          {verified ? <SubmissionEvidencePreview verified={verified} /> : null}

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
          {invalidated && !verified ? (
            <p className="text-fg-muted" role="status">
              {t('notebook.submitNotebookDialog.theNotebookChangedSince')}
            </p>
          ) : null}
          {previewErrorMessage ? (
            <Notice tone="bad">
              <p className="m-0">{previewErrorMessage}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={preview.isPending}
                onClick={() => preview.mutate()}
              >
                {t('common.actions.tryAgain')}
              </Button>
            </Notice>
          ) : null}
          {submitErrorMessage ? (
            <Notice tone="bad">{submitErrorMessage}</Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <SubmissionSubmitButton
            submission={submission}
            workspaceId={workspaceId}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SubmissionSubmitButton({
  submission,
  workspaceId,
}: {
  submission: ReturnType<typeof useNotebookSubmission>
  workspaceId?: string
}) {
  const {
    submit,
    preview,
    blocked,
    unreadableReviewers,
    selectedReviewerIds,
    canReview,
    verified,
    workflow,
    notCertified,
    demoSigning,
    authorPassword,
    authorConfirmation,
  } = submission

  return (
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
            (!demoSigning && !authorPassword) ||
            !authorConfirmation.trim())) ||
        selectedReviewerIds.length === 0
      }
      onClick={() => submit.mutate()}
    >
      {t('common.actions.submit')}
    </Button>
  )
}

function SubmissionAuthorSignature({
  pending,
  notCertified,
  demoSigning,
  authorPassword,
  setAuthorPassword,
  authorConfirmation,
  setAuthorConfirmation,
}: Pick<
  ReturnType<typeof useNotebookSubmission>,
  | 'notCertified'
  | 'demoSigning'
  | 'authorPassword'
  | 'setAuthorPassword'
  | 'authorConfirmation'
  | 'setAuthorConfirmation'
> & { pending: boolean }) {
  return (
    <fieldset className="space-y-3" disabled={pending || notCertified}>
      <legend className="text-sm font-medium">
        {t('notebook.submitNotebookDialog.authoredSignature')}
      </legend>
      {notCertified ? (
        <Notice tone="warn">
          <p className="m-0">
            {t('notebook.submitNotebookDialog.thisWorkflowNeedsYour')}
          </p>
          <p className="m-0 mt-1.5 text-label">
            {t('notebook.submitNotebookDialog.certifyInSettingsElectronic')}
          </p>
          <p className="m-0 mt-1.5">
            <Link
              to="/settings/account/signature"
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
      {demoSigning ? (
        <Notice tone="info" title={t('notebook.eSignDialog.demoTitle')}>
          {t('notebook.eSignDialog.demoNotice')}
        </Notice>
      ) : (
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
      )}
      <Field label={t('notebook.submitNotebookDialog.typeYourNameToLabel')}>
        <Input
          aria-label={t(
            'notebook.submitNotebookDialog.authorSignatureConfirmationAriaLabel',
          )}
          autoComplete="off"
          value={authorConfirmation}
          onChange={(event) => setAuthorConfirmation(event.target.value)}
        />
      </Field>
      {demoSigning ? null : (
        <p className="text-xs text-fg-muted">
          {t('notebook.submitNotebookDialog.threeFailedPasswordAttempts')}
        </p>
      )}
    </fieldset>
  )
}

function SubmissionReadiness({
  checks,
  sheetInstanceIds,
  projectId,
}: {
  checks: ReturnType<typeof submissionReadinessChecks>
  sheetInstanceIds: string[]
  projectId: string
}) {
  return (
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
              {check.state === 'pass' ? null : (
                <span className="block text-fg-muted">{check.detail}</span>
              )}
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
  )
}

function SubmissionEvidencePreview({
  verified,
}: {
  verified: VerifiedSubmission
}) {
  const composition = submissionCompositionSummary(verified.blocks)
  const orderedBlocks = [...verified.blocks].sort((a, b) => a.order - b.order)

  return (
    <details
      aria-label={t('notebook.submitNotebookDialog.evidencePreviewAriaLabel')}
      className="rounded-md border"
    >
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-fg">
        {t('notebook.submitNotebookDialog.previewWhatSubmittingWill', {
          blocks: t('notebook.submitNotebookDialog.compositionBlocks', {
            count: composition.blockCount,
          }),
        })}
      </summary>
      <div className="space-y-2 p-3 pt-0">
        <p className="text-xs text-fg-muted">
          {t('notebook.submitNotebookDialog.thisIsAPreview')}
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
      </div>
    </details>
  )
}
