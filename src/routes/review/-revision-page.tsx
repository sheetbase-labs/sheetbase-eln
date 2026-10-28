/**
 * REV-007 — Review & Approvals workspace route.
 *
 * `/review/$revisionId` combines the REV-003 version diff, REV-004 anchored
 * comments, REV-005 reviewer check results and the REV-007 review-decision
 * transition RPCs into one cohesive workspace for a submitted revision. The
 * left/main region is a tabbed view (Diff · Comments · Checks · History); the
 * right inspector shows revision identity, integrity digest, the approval
 * stepper, assigned reviewers and the request-changes / reject / approve /
 * withdraw actions with their explicit consequences.
 *
 * Guards are mirrored from the SECURITY DEFINER transition RPCs: the UI never
 * offers an action against a superseded, withdrawn or already-completed
 * review, or to a viewer who lacks the permission the RPC enforces. The RPC
 * remains the authority — every action also passes the digest the actor
 * viewed so a stale-action race surfaces as a recoverable error.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getRouteApi,
  Link,
  useNavigate,
  useParams,
  useSearch,
} from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  CollaborationRoom,
  safeBuildRoomId,
} from '#/components/collaboration/collaboration-room'
import { PresenceStack } from '#/components/collaboration/presence-avatars'
import { ThreadPanel } from '#/components/collaboration/thread-panel'
import { useCollaborationEnabled } from '#/lib/collaboration/liveblocks.config'
import { canCommentInRoom } from '#/lib/collaboration/permissions'
import { ApprovalStepper, RecordHistoryTimeline } from '#/components/audit'
import type { ApprovalStepDef, ApprovalStepStatus } from '#/components/audit'
import { CommentPanel } from '#/components/comments'
import {
  commentsQueryKeys,
  fetchCommentsForRecord,
  fetchCommentsForRevision,
  groupCommentsIntoThreads,
  threadState,
} from '#/lib/comments-data'
import type {
  CommentTarget,
  CommentTargetKind,
  CommentWire,
} from '#/lib/comments-data'
import {
  returnWithCommentsLabel,
  returnWithDraftComments,
  useReviewCommentDrafts,
} from '#/lib/review-comment-drafts'
import type {
  ReviewCommentDraft,
  ReviewCommentDrafts,
} from '#/lib/review-comment-drafts'
import { FrozenSheetEvidencePanel } from '#/components/notebook/notebook-sheet-block'
import type { CanonicalRevisionEnvelope } from '#/lib/revision-diff'
import {
  ReviewCheckResults,
  RevisionDiffReview,
  RevisionDocumentReview,
} from '#/components/review'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { StatusBadge } from '#/components/scientific/status-badge'
import type {
  StatusDefinition,
  StatusVocabulary,
} from '#/components/scientific/status-badge'
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from '#/components/v3/ui/confirm-dialog'
import { SignatureDialog } from '#/components/review/sign-dialogs'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Skeleton } from '#/components/v3/ui/skeleton'
import {
  Tabs,
  TabsRoot,
  TabsList,
  TabsPanel,
  TabsTab,
} from '#/components/v3/ui/tabs'
import { Select } from '#/components/v3/ui/select'
import { Textarea } from '#/components/v3/inventory/list'
import { AmendNotebookDialog } from '#/components/notebook/amend-notebook-dialog'
import { DataClientError } from '#/lib/data-client'
import {
  fetchProjectsForReviews,
  fetchRecordsForReviews,
  reviewQueryKeys,
  reviewsDataClient,
  workflowStepsFor,
} from '#/lib/reviews'
import { formatDate, formatNotebookDateTime } from '#/lib/notebook-data'
import {
  fetchReviewCheckResults,
  reviewCheckQueryKeys,
  runDefaultRevisionChecks,
} from '#/lib/review-checks'
import type { ReviewCheckResultWire } from '#/lib/review-checks'
import {
  approveReview,
  blockedReasonLabel,
  DECISION_CONSEQUENCE,
  DECISION_NEXT_STATE,
  deriveReviewActionPermission,
  fetchReviewDecisions,
  fetchReviewSubmissionByRevision,
  fetchRevisionOptionsForRecord,
  fetchRevisionRow,
  reviewWorkspaceQueryKeys,
  rejectReview,
  requestChangesOnReview,
  toCanonicalEnvelope,
  withdrawReview,
} from '#/lib/review-workspace'
import type {
  ReviewBlockedReason,
  ReviewDecisionInput,
  ReviewDecisionKind,
  ReviewDecisionWire,
  RevisionOptionWire,
} from '#/lib/review-workspace'
import type { ReviewSubmissionWire } from '#/lib/reviews'
import type { RevisionWire } from '#/lib/notebook-data'
import {
  availableSignatureMeanings,
  fetchSignatureEligibility,
  fetchSignatureWitnessCandidates,
  fetchSignaturesForSubmission,
  signatureChecksPassed,
  signatureQueryKeys,
  SIGNATURE_MEANING_LABEL,
  signRevision,
  requestSignatureWitness,
  requestSignatureStepUp,
  expiredSigningSignInSearch,
  isExpiredSigningSession,
} from '#/lib/signatures'
import type {
  PostSubmissionSignatureMeaning,
  SignatureMeaning,
  SignatureWire,
} from '#/lib/signatures'
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  signatureCertificationDataClient,
  signatureCertificationQueryKeys,
} from '#/lib/signature-certification'
import {
  fetchRecordTimeline,
  sign002DataClient,
  sign002QueryKeys,
} from '#/lib/sign-002'
import {
  buildAmendmentChain,
  deriveReviewLifecycle,
  deriveSignatureApplicability,
} from '#/lib/review-lifecycle'
import { Inspector as InspectorPanel } from '#/components/v3/ui/layout'
import { useUserNames } from '#/lib/user-names'
import {
  useRegisterShortcuts,
  useShortcutScope,
} from '#/components/shortcuts/shortcut-provider'
import { reviewShortcuts } from '#/lib/shortcut-scopes'
import { cn } from '#/lib/utils'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { returnToHere } from '#/lib/return-to'
import { reviewNextStep } from '#/lib/review-next-step'
import { ReviewNextStepPanel } from '#/components/review/review-next-step'

import type { WorkspaceSearch } from './-workspace-search'

/**
 * UI port (roadmap-4/ui-app3): the route renders inside app-3's shell, so the
 * old shell wrapper is replaced by a content column with the review inspector
 * beside it. Extra shell props callers pass are accepted and ignored.
 */
function RouteShell({
  children,
  inspector,
}: {
  children: ReactNode
  inspector?: ReactNode
  // The legacy call sites pass shell configuration we no longer use.
  [key: string]: unknown
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {children}
      </div>
      {inspector ? (
        <InspectorPanel aria-label="Review" className="w-[340px] gap-0 p-0">
          {inspector}
        </InspectorPanel>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Deep-linkable search state. `tab` keeps the active panel shareable; the
// comparison revision id lets a reviewer link to a specific before/after
// diff view.
// ---------------------------------------------------------------------------

/**
 * R5-NOTE-01: the review workspace's pending comment target. It started as a
 * frozen-Sheet selection (REV-004); the annotated document also anchors a
 * comment to a block, a change or the whole revision, so the workspace carries
 * the target kind and target the `create_comment` RPC validates.
 */
export type ReviewCommentTarget = {
  targetKind: CommentTargetKind
  target: CommentTarget
}

const COMMENT_TARGET_LABELS: Record<CommentTargetKind, string> = {
  revision: 'the whole revision',
  block: 'a block in the frozen revision',
  table_region: 'a region of a scientific table',
  diff: 'a change in this comparison',
  record: 'the whole notebook',
  sheet_cell: 'a frozen Sheet cell',
  sheet_row: 'a frozen Sheet row',
  sheet_range: 'a frozen Sheet range',
}

/** Human name for the pending comment target, shared with the comments tab. */
export function commentTargetLabel(target: ReviewCommentTarget): string {
  return COMMENT_TARGET_LABELS[target.targetKind]
}

const Route = getRouteApi('/review/$revisionId')

// ---------------------------------------------------------------------------
// Workspace status vocabulary (mirrors the inbox).
// ---------------------------------------------------------------------------
const workspaceStatusVocabulary: StatusVocabulary = {
  submitted: { label: 'Under review', tone: 'info', icon: 'check' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', icon: 'arrowLeft' },
  approved: { label: 'Approved', tone: 'success', icon: 'check' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'x' },
  returned: { label: 'Changes requested', tone: 'warning', icon: 'arrowLeft' },
}

/** GOV-04 derived lifecycle vocabulary (never a second backend state). */
const lifecycleVocabulary: StatusVocabulary = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'download' },
  'under-review': {
    label: 'Under review',
    tone: 'info',
    icon: 'check',
  },
  'changes-requested': {
    label: 'Changes requested',
    tone: 'warning',
    icon: 'arrowLeft',
  },
  approved: { label: 'Approved', tone: 'success', icon: 'check' },
  'signed-locked': { label: 'Signed & locked', tone: 'violet', icon: 'lock' },
  superseded: { label: 'Superseded', tone: 'neutral', icon: 'check' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', icon: 'arrowLeft' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'x' },
}

/** Runtime-safe status label lookup (state values come from the DB/RPC). */
export function statusLabel(state: string): string {
  const def = (
    workspaceStatusVocabulary as Partial<Record<string, StatusDefinition>>
  )[state]
  return def?.label ?? state
}

/**
 * REV-01.3: who may comment on the revision from the review workspace. An
 * active reviewer or the submitter of the current round can comment; once the
 * submission is returned the author (and any workspace member) resolves or
 * replies to the returned threads, matching the comment RPCs' workspace
 * membership boundary.
 */
export function canCommentOnRevision({
  canReview,
  canWithdraw,
  state,
}: {
  canReview: boolean
  canWithdraw: boolean
  state: string | null
}): boolean {
  return canReview || canWithdraw || state === 'returned'
}

// ---------------------------------------------------------------------------
// Route component.
// ---------------------------------------------------------------------------

export function ReviewWorkspaceRoute() {
  const { context } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { revisionId } = useParams({ from: '/review/$revisionId' })
  const search = useSearch({ from: '/review/$revisionId' })

  const currentUserId = context.user.id
  const currentUserName = context.user.name
  const activeTab = search.tab ?? 'diff'
  const commentsPanelRef = useRef<HTMLDivElement>(null)
  const [commentSelection, setCommentSelection] = useState<{
    revisionId: string
    anchor: ReviewCommentTarget
  } | null>(null)
  const commentAnchor =
    commentSelection?.revisionId === revisionId ? commentSelection.anchor : null

  // SHELL-03.3 — the Review scope. The diff registers N/P itself (it owns the
  // change selection); this route adds R to start a reply on the first open
  // thread in the comments panel. The inspector registers Approve and sign
  // only when its current approval or signing action is eligible.
  useShortcutScope('review')
  useRegisterShortcuts(
    useMemo(
      () =>
        reviewShortcuts({
          reply: () => {
            const trigger =
              commentsPanelRef.current?.querySelector<HTMLButtonElement>(
                '[aria-label="Reply to thread"]',
              )
            trigger?.click()
            requestAnimationFrame(() => {
              commentsPanelRef.current
                ?.querySelector<HTMLTextAreaElement>(
                  '[aria-label="Reply body"]',
                )
                ?.focus()
            })
          },
        }),
      [],
    ),
  )

  // --- Data queries -------------------------------------------------------

  const revisionQuery = useQuery({
    queryKey: reviewWorkspaceQueryKeys.revision(revisionId),
    queryFn: () => fetchRevisionRow(reviewsDataClient, revisionId),
  })

  const submissionQuery = useQuery({
    queryKey: reviewWorkspaceQueryKeys.submissionForRevision(revisionId),
    queryFn: () =>
      fetchReviewSubmissionByRevision(reviewsDataClient, revisionId),
  })

  const recordId = revisionQuery.data?.record_id ?? null

  // COLLAB-04: reviewers share the record's canonical collaboration room.
  // Null when collaboration is disabled or the workspace/record identity is
  // incomplete — CollaborationRoom then renders children unchanged.
  const collaborationEnabled = useCollaborationEnabled()
  const collaborationRoomId = collaborationEnabled
    ? safeBuildRoomId(context.workspace?.id, 'record', recordId)
    : null

  const revisionOptionsQuery = useQuery({
    queryKey: reviewWorkspaceQueryKeys.revisionOptions(recordId ?? ''),
    queryFn: () => fetchRevisionOptionsForRecord(reviewsDataClient, recordId!),
    enabled: recordId !== null,
  })

  const submissionId = submissionQuery.data?.id ?? null

  const decisionsQuery = useQuery({
    queryKey: reviewWorkspaceQueryKeys.decisions(submissionId ?? ''),
    queryFn: () => fetchReviewDecisions(reviewsDataClient, submissionId!),
    enabled: submissionId !== null,
  })

  const signaturesQuery = useQuery({
    queryKey: signatureQueryKeys.forSubmission(submissionId ?? ''),
    queryFn: () =>
      fetchSignaturesForSubmission(reviewsDataClient, submissionId!),
    enabled: submissionId !== null,
  })

  const checksQuery = useQuery({
    queryKey: reviewCheckQueryKeys.resultsForRevision(revisionId),
    queryFn: () => fetchReviewCheckResults(reviewsDataClient, revisionId),
  })

  // REV-01.3: the same query key the CommentPanel uses, so react-query dedupes
  // the fetch; the returned banner derives how many threads remain to resolve.
  const commentsQuery = useQuery({
    queryKey: commentsQueryKeys.forRevision(revisionId),
    queryFn: () => fetchCommentsForRevision(reviewsDataClient, revisionId),
  })

  const recordIds = useMemo(() => (recordId ? [recordId] : []), [recordId])
  const recordsQuery = useQuery({
    queryKey: reviewQueryKeys.recordsForReviews(recordIds),
    queryFn: () => fetchRecordsForReviews(reviewsDataClient, recordIds),
    enabled: recordIds.length > 0,
  })
  const projectsQuery = useQuery({
    queryKey: reviewQueryKeys.projectsForReviews(),
    queryFn: () => fetchProjectsForReviews(reviewsDataClient),
  })

  // SIGN-002: complete chronological history for the record, fetched via the
  // record_timeline RPC. Invalidated after review/sign/amendment actions.
  const timelineQuery = useQuery({
    queryKey: sign002QueryKeys.timeline(recordId ?? ''),
    queryFn: () => fetchRecordTimeline(sign002DataClient, recordId!),
    enabled: recordId !== null,
  })

  // --- Derived state ------------------------------------------------------

  const revision = revisionQuery.data ?? null
  const submission = submissionQuery.data ?? null
  const record = useMemo(
    () => (recordsQuery.data ?? []).find((r) => r.id === recordId) ?? null,
    [recordsQuery.data, recordId],
  )
  const isLocked = Boolean(record?.locked_at)
  const project = useMemo(() => {
    const map = projectsQuery.data ?? new Map()
    return record?.project_id ? map.get(record.project_id) : undefined
  }, [projectsQuery.data, record])

  const revisionOptions = revisionOptionsQuery.data ?? []
  const comparisonRevisionId = search.comparisonRevisionId ?? null

  // Default the comparison to the most recent prior revision of the same
  // record (the revision immediately older than the submitted one).
  const defaultComparisonId = useMemo(() => {
    if (!revision) return null
    const prior = revisionOptions
      .filter(
        (option) =>
          option.id !== revision.id &&
          Date.parse(option.created_at) < Date.parse(revision.created_at),
      )
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    return prior[0]?.id ?? null
  }, [revisionOptions, revision])

  const effectiveComparisonId = comparisonRevisionId ?? defaultComparisonId

  const comparisonRevisionQuery = useQuery({
    queryKey: reviewWorkspaceQueryKeys.revision(effectiveComparisonId ?? ''),
    queryFn: () => fetchRevisionRow(reviewsDataClient, effectiveComparisonId!),
    enabled: effectiveComparisonId !== null,
  })

  const decisions = decisionsQuery.data ?? []
  const checkResults = checksQuery.data ?? []
  const signatures = signaturesQuery.data ?? []

  const permission = useMemo(() => {
    if (!submission || !revision) return null
    return deriveReviewActionPermission({
      state: submission.state,
      supersededByRevisionId: revision.superseded_by_revision_id,
      assignedReviewerUserIds: submission.assigned_reviewer_user_ids,
      submittedByUserId: submission.submitted_by_user_id,
      currentUserId,
    })
  }, [submission, revision, currentUserId])

  // REV-01.3: the reviewer drafts comments privately while the review is
  // active; they are only published when the reviewer returns the submission.
  const commentDrafts = useReviewCommentDrafts({
    revisionId,
    userId: currentUserId,
    enabled:
      permission?.canReview === true && submission?.state === 'submitted',
  })

  const openCommentCount = useMemo(
    () =>
      groupCommentsIntoThreads(commentsQuery.data ?? []).filter(
        (thread) => threadState(thread) === 'open',
      ).length,
    [commentsQuery.data],
  )

  const latestReturn = useMemo(
    () =>
      [...decisions]
        .reverse()
        .find((decision) => decision.decision === 'request_changes') ?? null,
    [decisions],
  )

  // QA-180: the banner names who returned the submission. A decision row only
  // carries the actor's id, so resolve it the way the rest of the app does
  // rather than printing a UUID at the author.
  const returnedByUserId = latestReturn?.actor_user_id ?? null
  const returnedByNames = useUserNames(
    returnedByUserId ? [returnedByUserId] : [],
    { id: currentUserId, name: currentUserName },
  )
  const returnedByName = returnedByUserId
    ? (returnedByNames.names[returnedByUserId] ?? 'a colleague')
    : null

  const integrityDigest = revision?.integrity_digest ?? null

  // What happens next, in words, for the reader.
  const nextStepNames = useUserNames(
    [
      ...(submission?.assigned_reviewer_user_ids ?? []).filter(
        (id) => id !== currentUserId,
      ),
      ...(submission ? [submission.submitted_by_user_id] : []),
    ],
    { id: currentUserId, name: currentUserName },
  )
  const nextStep = reviewNextStep({
    state: submission?.state ?? null,
    superseded: Boolean(revision?.superseded_by_revision_id),
    locked: isLocked,
    isSubmitter: submission?.submitted_by_user_id === currentUserId,
    isAssignedReviewer:
      submission?.assigned_reviewer_user_ids.includes(currentUserId) ?? false,
    hasSigned: signatures.some((sig) => sig.signer_user_id === currentUserId),
    reviewerNames: (submission?.assigned_reviewer_user_ids ?? [])
      .filter((id) => id !== currentUserId)
      .map((id) => nextStepNames.names[id] ?? 'a colleague'),
    submitterName: submission
      ? (nextStepNames.names[submission.submitted_by_user_id] ?? null)
      : null,
  })

  // --- Error / permission state ------------------------------------------

  const permissionDenied =
    (revisionQuery.error instanceof DataClientError &&
      (revisionQuery.error.code === 'permission_denied' ||
        revisionQuery.error.code === 'unauthenticated')) ||
    (submissionQuery.error instanceof DataClientError &&
      submissionQuery.error.code === 'permission_denied')

  // --- Derived envelopes (computed before any early return so hook order
  // is stable across renders) --------------------------------------------

  const beforeEnvelope = useMemo(() => {
    if (!comparisonRevisionQuery.data) return null
    return toCanonicalEnvelope(comparisonRevisionQuery.data)
  }, [comparisonRevisionQuery.data])

  const afterEnvelope = useMemo(() => {
    if (!revision) return null
    return toCanonicalEnvelope(revision)
  }, [revision])

  // --- Tab navigation (URL is source of truth) ---------------------------

  function navigateTab(tab: WorkspaceSearch['tab']) {
    void navigate({
      to: '/review/$revisionId',
      params: { revisionId },
      search: { ...search, tab },
      replace: true,
    })
  }

  function navigateComparison(id: string | null) {
    void navigate({
      to: '/review/$revisionId',
      params: { revisionId },
      search: {
        ...search,
        comparisonRevisionId: id ?? undefined,
      },
      replace: true,
    })
  }

  // --- Render -------------------------------------------------------------

  const loading =
    revisionQuery.isLoading ||
    submissionQuery.isLoading ||
    (recordId !== null && recordsQuery.isLoading)

  if (permissionDenied) {
    return (
      <RouteShell
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Inbox', to: '/inbox' },
        ]}
      >
        <PermissionDenied />
      </RouteShell>
    )
  }

  if (!loading && !revision) {
    return (
      <RouteShell
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Inbox', to: '/inbox' },
          { label: 'Unknown revision' },
        ]}
      >
        <MissingRevision />
      </RouteShell>
    )
  }

  // --- Inspector content --------------------------------------------------

  const inspector = (
    <ReviewInspector
      revision={revision}
      submission={submission}
      record={record}
      projectTitle={project?.title ?? null}
      decisions={decisions}
      signatures={signatures}
      permission={permission}
      currentUserId={currentUserId}
      currentUserName={currentUserName}
      integrityDigest={integrityDigest}
      loading={loading}
      isLocked={isLocked}
      recordId={recordId}
      collaborationWorkspaceId={
        collaborationEnabled ? (context.workspace?.id ?? null) : null
      }
      collaborationRole={context.workspace?.role ?? 'viewer'}
      revisionOptions={revisionOptions}
      commentDrafts={commentDrafts}
      onCommentsChanged={async () => {
        await queryClient.invalidateQueries({
          queryKey: commentsQueryKeys.forRevision(revisionId),
        })
      }}
      onAfterAmendment={async () => {
        await queryClient.invalidateQueries({
          queryKey: reviewWorkspaceQueryKeys.revision(revisionId),
        })
        await queryClient.invalidateQueries({
          queryKey: reviewQueryKeys.recordsForReviews(
            recordId ? [recordId] : [],
          ),
        })
        if (recordId) {
          await queryClient.invalidateQueries({
            queryKey: sign002QueryKeys.timeline(recordId),
          })
        }
      }}
    />
  )

  // COLLAB-04: the whole workspace shares the record's collaboration room;
  // CollaborationRoom renders children unchanged until the provider is
  // mounted, so SSR markup is unaffected.
  return (
    <CollaborationRoom roomId={collaborationRoomId}>
      <RouteShell
        fullBleed
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Inbox', to: '/inbox' },
          { label: record?.identifier ?? revisionId },
        ]}
        inspector={inspector}
        inspectorLabel="Review"
        inspectorCollapsible
      >
        <div className="flex h-full flex-col gap-3 p-4 md:p-6">
          <WorkspaceHeader
            submission={submission}
            record={record}
            projectTitle={project?.title ?? null}
            revision={revision}
            permission={permission}
            isLocked={isLocked}
            lockedAt={record?.locked_at ?? null}
            lockedByRevisionId={record?.locked_by_revision_id ?? null}
            recordId={recordId}
          />

          {submission ? (
            <ReviewNextStepPanel
              step={nextStep}
              currentRevisionId={revisionId}
            />
          ) : null}

          {submission?.state === 'returned' ? (
            <ReturnedCommentsBanner
              openCommentCount={openCommentCount}
              returnedByName={returnedByName}
              returnedAt={latestReturn?.created_at ?? null}
              recordId={recordId}
              onGoToComment={() => {
                const firstOpen = groupCommentsIntoThreads(
                  commentsQuery.data ?? [],
                ).find((thread) => threadState(thread) === 'open')
                void navigate({
                  to: '/review/$revisionId',
                  params: { revisionId },
                  search: {
                    ...search,
                    tab: 'comments',
                    commentId: firstOpen?.root.id,
                  },
                  replace: true,
                })
              }}
            />
          ) : null}

          <TabsRoot
            value={activeTab}
            onValueChange={(value) =>
              navigateTab(value as WorkspaceSearch['tab'])
            }
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList aria-label="Review workspace panels">
              <TabsTab value="diff">
                <Icon name="code" size={14} aria-hidden />
                Diff
              </TabsTab>
              <TabsTab value="comments">
                <Icon name="comment" size={14} aria-hidden />
                Comments
              </TabsTab>
              <TabsTab value="checks">
                <Icon name="check" size={14} aria-hidden />
                Checks
              </TabsTab>
              <TabsTab value="history">
                <Icon name="clock" size={14} aria-hidden />
                History
              </TabsTab>
            </TabsList>

            <TabsPanel value="diff" className="min-h-0 flex-1 overflow-y-auto">
              <DiffPanel
                beforeEnvelope={beforeEnvelope}
                afterEnvelope={afterEnvelope}
                revisionOptions={revisionOptions}
                currentRevisionId={revisionId}
                effectiveComparisonId={effectiveComparisonId}
                onComparisonChange={navigateComparison}
                recordId={recordId}
                revisionComments={commentsQuery.data ?? []}
                focusCommentId={search.commentId}
                onOpenComment={(commentId) =>
                  void navigate({
                    to: '/review/$revisionId',
                    params: { revisionId },
                    search: { ...search, tab: 'comments', commentId },
                    replace: true,
                  })
                }
                onCommentTarget={
                  permission?.canReview === true ||
                  permission?.canWithdraw === true
                    ? (anchor) => {
                        setCommentSelection({ revisionId, anchor })
                        navigateTab('comments')
                      }
                    : undefined
                }
                comparisonLoading={
                  effectiveComparisonId !== null &&
                  comparisonRevisionQuery.isLoading
                }
              />
            </TabsPanel>

            <TabsPanel
              value="comments"
              ref={commentsPanelRef}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {submission && revision ? (
                <>
                  {commentAnchor ? (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <p className="text-xs text-fg-muted">
                        New comment target: {commentTargetLabel(commentAnchor)}.
                        Submitted identities only.
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setCommentSelection(null)}
                      >
                        Comment on whole revision
                      </Button>
                    </div>
                  ) : null}
                  <DraftCommentsTray
                    drafts={commentDrafts.drafts}
                    onEdit={commentDrafts.updateBody}
                    onDelete={commentDrafts.remove}
                  />
                  <CommentPanel
                    key={revisionId}
                    revisionId={revisionId}
                    focusCommentId={search.commentId}
                    targetKind={commentAnchor?.targetKind ?? 'revision'}
                    target={commentAnchor?.target ?? {}}
                    currentUserId={currentUserId}
                    currentUserName={currentUserName}
                    canComment={canCommentOnRevision({
                      canReview: permission?.canReview === true,
                      canWithdraw: permission?.canWithdraw === true,
                      state: submission.state,
                    })}
                    onDraftComment={
                      permission?.canReview === true &&
                      submission.state === 'submitted'
                        ? commentDrafts.addDraft
                        : undefined
                    }
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Comments are available once the revision is loaded.
                </p>
              )}
            </TabsPanel>

            <TabsPanel
              value="checks"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <ChecksPanel
                revisionId={revisionId}
                results={checkResults}
                loading={checksQuery.isLoading}
                // run_revision_checks accepts any workspace member who can read
                // the revision, so the author and a witness can run them too:
                // otherwise a signer is told to run checks with no button.
                canRun={integrityDigest !== null}
                onRefresh={() => void checksQuery.refetch()}
              />
            </TabsPanel>

            <TabsPanel
              value="history"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <RecordHistoryTimeline
                events={timelineQuery.data ?? []}
                loading={timelineQuery.isLoading}
                error={timelineQuery.error}
                revisionId={revision?.id ?? null}
                integrityDigest={revision?.integrity_digest ?? null}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                onRefresh={() => void timelineQuery.refetch()}
                refreshing={
                  timelineQuery.isFetching && !timelineQuery.isLoading
                }
              />
            </TabsPanel>
          </TabsRoot>
        </div>
      </RouteShell>
    </CollaborationRoom>
  )
}

// ---------------------------------------------------------------------------
// Helpers shared by the route component.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workspace header — record identity, status, stale/superseded banners.
// ---------------------------------------------------------------------------

/** NOTE-04: exported for tests — asserts the working-Notebook/evidence links. */
export function WorkspaceHeader({
  submission,
  record,
  projectTitle,
  revision,
  permission,
  isLocked,
  lockedAt,
  lockedByRevisionId,
  recordId,
}: {
  submission: ReviewSubmissionWire | null
  record: { identifier?: string; title?: string; kind?: string } | null
  projectTitle: string | null
  revision: RevisionWire | null
  permission: ReturnType<typeof deriveReviewActionPermission> | null
  isLocked: boolean
  lockedAt: string | null
  lockedByRevisionId: string | null
  /** NOTE-04: the reviewed record, for working-Notebook/evidence links. */
  recordId?: string | null
}) {
  const isSuperseded =
    revision?.superseded_by_revision_id !== null && revision !== null
  const state = submission?.state ?? null
  // GOV-04: one derived lifecycle from authoritative fields — never a
  // second state machine. Viewed-revision supersession outranks the
  // record-level lock, so an amended predecessor can never present its
  // successor's lock as its own.
  const lifecycle = deriveReviewLifecycle({
    submissionState: state,
    lockedAt: lockedAt,
    lockedByRevisionId: lockedByRevisionId,
    viewedRevisionId: revision?.id ?? null,
    supersededByRevisionId: revision?.superseded_by_revision_id ?? null,
  })
  return (
    <header className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {record?.kind ?? 'Record'}
          </p>
          <h1 className="truncate text-base font-semibold text-foreground">
            {record?.title ?? 'Untitled record'}
          </h1>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {record?.identifier && recordId ? (
              <ObjectLink
                kind={record.kind === 'experiment' ? 'experiment' : 'record'}
                id={recordId}
                identifier={record.identifier}
              />
            ) : (
              (record?.identifier ?? revision?.id)
            )}
          </p>
          {/* NOTE-04: from the submit flow's success state, the working
              Notebook and the frozen evidence view must both stay reachable —
              audit history (this review) is not the same as the snapshot. */}
          {recordId && revision ? (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
              <Link
                to="/records/$recordId"
                params={{ recordId }}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Open working Notebook
              </Link>
              <Link
                to="/evidence/$revisionId"
                params={{ revisionId: revision.id }}
                className="text-muted-foreground underline-offset-4 hover:underline"
              >
                View submitted evidence
              </Link>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          {/* COLLAB-04: who else is reviewing right now; renders null before
              the room mounts and when nobody else is present. */}
          <PresenceStack className="justify-end" />
          <StatusBadge
            status={lifecycle.status}
            vocabulary={lifecycleVocabulary}
            size="sm"
          />
          {projectTitle ? (
            <span className="text-xs text-muted-foreground">
              {projectTitle}
            </span>
          ) : null}
        </div>
      </div>
      {isLocked ? (
        <div
          role="status"
          className="rounded-md border border-success bg-success-wash px-3 py-2 text-xs text-success-text"
        >
          <Icon
            name="lock"
            size={12}
            className="mr-1 inline align-text-bottom"
            aria-hidden
          />
          This record is locked by an approved signature
          {lockedByRevisionId ? (
            <>
              {' '}
              (revision{' '}
              <span className="font-mono">
                {lockedByRevisionId.slice(0, 8)}
              </span>
              )
            </>
          ) : null}
          . Scientific evidence is frozen — start an amendment to edit again.
          {lockedAt ? (
            <span className="ml-1 text-success-text">
              Locked {formatDate(lockedAt)}.
            </span>
          ) : null}
        </div>
      ) : null}
      {isSuperseded ? (
        <div
          role="status"
          className="rounded-md border border-warning-border bg-warning-wash px-3 py-2 text-xs text-warning-text"
        >
          This revision has been superseded by a newer submission. No review
          actions are available.
        </div>
      ) : null}
      {state && state !== 'submitted' && !isSuperseded ? (
        <div
          role="status"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          This review is no longer active — it has been{' '}
          {statusLabel(state).toLowerCase()}. No further actions are available.
        </div>
      ) : null}
      {permission &&
      !permission.canReview &&
      !permission.canWithdraw &&
      state === 'submitted' &&
      !isSuperseded ? (
        <div
          role="status"
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          You do not have permission to act on this review.
        </div>
      ) : null}
    </header>
  )
}

// ---------------------------------------------------------------------------
// REV-01.3 — returned banner (author) and private draft tray (reviewer).
// ---------------------------------------------------------------------------

/**
 * The author-facing banner on a returned submission: who returned it, how many
 * threads remain to resolve, a jump to the first open comment, and a resubmit
 * action that stays disabled until every returned comment is resolved.
 */
export function ReturnedCommentsBanner({
  openCommentCount,
  returnedByName,
  returnedAt,
  recordId,
  onGoToComment,
}: {
  openCommentCount: number
  /** Display name of the reviewer who returned it, when the workspace can name them. */
  returnedByName: string | null
  returnedAt: string | null
  recordId: string | null
  onGoToComment: () => void
}) {
  const noun = openCommentCount === 1 ? 'comment' : 'comments'
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-wash px-3 py-2 text-xs text-warning-text"
    >
      <Icon name="arrowLeft" size={14} aria-hidden />
      <span>
        <span className="font-semibold">Returned for changes</span>
        {returnedByName ? ` by ${returnedByName}` : ''}
        {returnedAt ? ` · ${formatDate(returnedAt)}` : ''} · {openCommentCount}{' '}
        {noun} to resolve before you resubmit
      </span>
      <span className="flex-1" />
      {openCommentCount > 0 ? (
        <Button size="sm" variant="secondary" onClick={onGoToComment}>
          Go to comment
        </Button>
      ) : null}
      {recordId ? (
        openCommentCount > 0 ? (
          <Button
            size="sm"
            variant="primary"
            disabled
            title="Resolve the returned comments first."
          >
            Resubmit ({openCommentCount} open)
          </Button>
        ) : (
          <Link
            to="/records/$recordId"
            params={{ recordId }}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground no-underline hover:bg-primary/90"
          >
            Resubmit
          </Link>
        )
      ) : null}
    </div>
  )
}

/** One reviewer draft: edit its body in place or delete it before returning. */
function DraftCommentRow({
  draft,
  onEdit,
  onDelete,
}: {
  draft: ReviewCommentDraft
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(draft.body)
  useEffect(() => {
    setBody(draft.body)
  }, [draft.body])
  const target =
    draft.targetKind === 'revision'
      ? 'whole revision'
      : draft.targetKind.replace(/^sheet_/, '').replace(/_/g, ' ')
  return (
    <li className="rounded-md border bg-card p-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">You</span>
        <span className="text-fg-muted">draft · not sent</span>
        <span className="text-fg-muted">anchored to {target}</span>
        <span className="flex-1" />
        {!editing ? (
          <>
            <Button
              size="sm"
              variant="quiet"
              aria-label="Edit draft comment"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="quiet"
              aria-label="Delete draft comment"
              onClick={() => onDelete(draft.id)}
            >
              Delete
            </Button>
          </>
        ) : null}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            className="min-h-[60px] w-full rounded-md border bg-surface px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Draft comment body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!body.trim()}
              onClick={() => {
                onEdit(draft.id, body.trim())
                setEditing(false)
              }}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setBody(draft.body)
                setEditing(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="leading-5 text-foreground">{draft.body}</p>
      )}
    </li>
  )
}

/**
 * The reviewer's private drafts. They are held in the reviewer's browser and
 * are not written to the database — and so not visible to the author — until
 * the reviewer returns the submission with them.
 */
export function DraftCommentsTray({
  drafts,
  onEdit,
  onDelete,
}: {
  drafts: ReviewCommentDraft[]
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
}) {
  if (drafts.length === 0) return null
  const count = drafts.length
  return (
    <section
      aria-label="Draft comments"
      className="mb-3 rounded-lg border border-dashed bg-surface-muted/30 p-3"
    >
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="chg">
          {count} draft {count === 1 ? 'comment' : 'comments'}
        </Badge>
        <span className="text-xs text-fg-muted">
          Private — not visible to the author until you{' '}
          {returnWithCommentsLabel(count).toLowerCase()}.
        </span>
      </header>
      <ol className="space-y-2">
        {drafts.map((draft) => (
          <DraftCommentRow
            key={draft.id}
            draft={draft}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </ol>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Diff panel — version comparison with a selectable baseline revision.
// ---------------------------------------------------------------------------

function DiffPanel({
  beforeEnvelope,
  afterEnvelope,
  revisionOptions,
  currentRevisionId,
  effectiveComparisonId,
  onComparisonChange,
  comparisonLoading,
  onCommentTarget,
  onOpenComment,
  recordId,
  revisionComments,
  focusCommentId,
}: {
  beforeEnvelope: CanonicalRevisionEnvelope | null
  afterEnvelope: CanonicalRevisionEnvelope | null
  revisionOptions: RevisionOptionWire[]
  currentRevisionId: string
  effectiveComparisonId: string | null
  onComparisonChange: (id: string | null) => void
  comparisonLoading: boolean
  onCommentTarget?: (target: ReviewCommentTarget) => void
  /** Comment → comments panel: reveal this thread beside the document. */
  onOpenComment?: (commentId: string) => void
  recordId: string | null
  /** The frozen revision's own comments (the workspace's existing query). */
  revisionComments: CommentWire[]
  focusCommentId?: string
}) {
  const comparableOptions = revisionOptions.filter(
    (option) => option.id !== currentRevisionId,
  )
  // R5-NOTE-01: the document reads by default; the change list stays one
  // click away for reviews that are better read as a list of changes.
  const [view, setView] = useState<'document' | 'changes'>('document')

  /**
   * R5-NOTE-01: an amendment creates a new revision, so a comment written
   * against an earlier round is anchored to that earlier revision. The record
   * read is the canonical `record_comments` RPC the comments panel already
   * uses; only threads anchored to an older revision of this record are taken,
   * and they are reported as no longer applying rather than re-anchored.
   */
  const reviewedAt = revisionOptions.find(
    (option) => option.id === currentRevisionId,
  )?.created_at
  const recordCommentsQuery = useQuery({
    queryKey: commentsQueryKeys.forRecord(recordId ?? ''),
    queryFn: () => fetchCommentsForRecord(reviewsDataClient, recordId!),
    enabled:
      view === 'document' && recordId !== null && reviewedAt !== undefined,
  })
  const earlierComments = useMemo(() => {
    if (!reviewedAt) return []
    const reviewed = Date.parse(reviewedAt)
    return (recordCommentsQuery.data ?? []).filter(
      (comment) =>
        comment.revision_id !== null &&
        comment.revision_id !== currentRevisionId &&
        Number.isFinite(reviewed) &&
        Date.parse(
          revisionOptions.find((option) => option.id === comment.revision_id)
            ?.created_at ?? '',
        ) < reviewed,
    )
  }, [currentRevisionId, recordCommentsQuery.data, reviewedAt, revisionOptions])
  const revisionLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const option of revisionOptions) {
      labels.set(
        option.id,
        `${formatDate(option.created_at)} · ${option.reason}`,
      )
    }
    return labels
  }, [revisionOptions])
  const documentComments = useMemo(
    () => [...earlierComments, ...revisionComments],
    [earlierComments, revisionComments],
  )

  if (!afterEnvelope) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Loading revision snapshot…
        </p>
      </div>
    )
  }

  return (
    <section aria-label="Version comparison" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3">
        <div className="min-w-0">
          <label
            htmlFor="review-comparison-select"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Compare against
          </label>
          <Select
            id="review-comparison-select"
            className="mt-1 max-w-xs"
            value={effectiveComparisonId ?? ''}
            onChange={(event) => onComparisonChange(event.target.value || null)}
          >
            <option value="">No earlier revision available</option>
            {comparableOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {formatDate(option.created_at)} · {option.reason}
                {option.superseded_by_revision_id ? ' (superseded)' : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {comparisonLoading ? (
            <span className="text-xs text-muted-foreground">
              Loading comparison…
            </span>
          ) : null}
          <Tabs
            mode="state"
            variant="segment"
            label="Reading view"
            value={view}
            onValueChange={(next) => setView(next as 'document' | 'changes')}
            items={[
              { key: 'document', label: 'Document' },
              { key: 'changes', label: 'Change list' },
            ]}
          />
        </div>
      </div>

      {view === 'document' ? (
        <RevisionDocumentReview
          after={afterEnvelope}
          before={beforeEnvelope}
          revisionId={currentRevisionId}
          comparisonRevisionId={effectiveComparisonId}
          beforeLabel="Earlier revision"
          afterLabel="Submitted revision"
          comments={documentComments}
          focusCommentId={focusCommentId}
          onOpenComment={onOpenComment}
          onCommentTarget={onCommentTarget}
          onSheetCommentTarget={onCommentTarget}
          revisionLabels={revisionLabels}
        />
      ) : !beforeEnvelope ? (
        <>
          <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <h2 className="text-sm font-semibold">
              No earlier revision to compare
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              This is the first submitted revision for this record. Earlier
              revisions, when they exist, can be selected above to show a
              navigable text, table and formula diff.
            </p>
          </div>
          {afterEnvelope.sheetEvidence?.map((evidence) => (
            <FrozenSheetEvidencePanel
              key={`${currentRevisionId}:${evidence.blockId}`}
              evidence={evidence}
              onCommentTarget={onCommentTarget}
            />
          ))}
        </>
      ) : (
        <RevisionDiffReview
          key={currentRevisionId}
          before={beforeEnvelope}
          after={afterEnvelope}
          beforeLabel="Earlier revision"
          afterLabel="Submitted revision"
          onCommentTarget={onCommentTarget}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Checks panel — run reviewer + data-integrity checks and list results.
// ---------------------------------------------------------------------------

function ChecksPanel({
  revisionId,
  results,
  loading,
  canRun,
  onRefresh,
}: {
  revisionId: string
  results: ReviewCheckResultWire[]
  loading: boolean
  canRun: boolean
  onRefresh: () => void
}) {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRun() {
    setRunning(true)
    setError(null)
    try {
      await runDefaultRevisionChecks(reviewsDataClient, revisionId)
      await queryClient.invalidateQueries({
        queryKey: reviewCheckQueryKeys.resultsForRevision(revisionId),
      })
    } catch (err) {
      setError(renderError(err))
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  return (
    <section aria-label="Reviewer checks" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Reviewer checks</h2>
          <p className="text-xs text-muted-foreground">
            Checks run against the frozen revision snapshot — live data changes
            cannot affect the result.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
          {canRun ? (
            <Button size="sm" onClick={handleRun} disabled={running}>
              <Icon name="check" size={14} aria-hidden />
              {running ? 'Running…' : 'Run checks'}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      {results.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center">
          <p className="text-sm font-medium">No check results yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run the reviewer and data-integrity checks to record immutable
            evidence against this revision.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {results.map((result) => (
            <li key={result.id} className="rounded-lg border bg-card p-3">
              <ReviewCheckResults result={result} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// History panel — SIGN-002 replaces the narrow submission/decisions list with
// the complete RPC-backed RecordHistoryTimeline (rendered in the route
// component above). The legacy HistoryPanel and its helpers were removed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inspector — revision identity, integrity, approval stepper, actions.
// ---------------------------------------------------------------------------

function ReviewInspector({
  revision,
  submission,
  record,
  projectTitle,
  decisions,
  signatures,
  permission,
  currentUserId,
  currentUserName,
  integrityDigest,
  loading,
  isLocked,
  recordId,
  collaborationWorkspaceId,
  collaborationRole,
  onAfterAmendment,
  revisionOptions,
  commentDrafts,
  onCommentsChanged,
}: {
  revision: RevisionWire | null
  submission: ReviewSubmissionWire | null
  record: {
    identifier?: string
    title?: string
    kind?: string
    project_id?: string | null
  } | null
  projectTitle: string | null
  decisions: ReviewDecisionWire[]
  signatures: SignatureWire[]
  permission: ReturnType<typeof deriveReviewActionPermission> | null
  currentUserId: string
  currentUserName: string
  integrityDigest: string | null
  loading: boolean
  isLocked: boolean
  recordId: string | null
  /** COLLAB-04: workspace identity for the shared record discussion room. */
  collaborationWorkspaceId: string | null
  /** COLLAB-04: workspace role hint for the discussion composer. */
  collaborationRole: string
  onAfterAmendment: () => Promise<void>
  /** All revisions of this record, for the amendment chain view. */
  revisionOptions: RevisionOptionWire[]
  /** REV-01.3: the reviewer's private comment drafts. */
  commentDrafts: ReviewCommentDrafts
  /** REV-01.3: refresh the comment list after drafts are published. */
  onCommentsChanged: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [signingOpen, setSigningOpen] = useState(false)
  // REV-03.4: Control+Shift+Enter approves and then opens the signing dialog.
  // The handler is stable so `ReviewInspector`'s shortcut definitions keep one
  // identity across renders; an unstable array re-registers every render and
  // the shortcut registry's state update loops.
  const openSigningAfterApproval = useCallback(() => setSigningOpen(true), [])
  // QA-180: an assigned reviewer is a person, not a UUID. Resolve them to names
  // the way the rest of the app does; initials come from the name.
  const reviewerNames = useUserNames(
    submission?.assigned_reviewer_user_ids ?? [],
    { id: currentUserId, name: currentUserName },
  )
  const actorIds = useMemo(
    () => [
      ...(submission ? [submission.submitted_by_user_id] : []),
      ...decisions.map((decision) => decision.actor_user_id),
    ],
    [submission, decisions],
  )
  const { userLabel: actorLabel } = useUserNames(actorIds, {
    id: currentUserId,
    name: currentUserName,
  })

  if (loading && !revision) {
    return (
      <div className="space-y-3 p-3" aria-busy="true">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (!revision) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        No revision loaded.
      </div>
    )
  }

  const steps = buildApprovalSteps(submission)
  const reviewState = buildStepperState(submission, decisions, actorLabel)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <Icon name="lock" size={16} className="text-fg-muted" aria-hidden />
          <span className="text-sm font-semibold">Review & approvals</span>
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {record?.identifier ?? revision.id}
        </p>
        {submission ? (
          <StatusBadge
            status={submission.state}
            vocabulary={workspaceStatusVocabulary}
            size="sm"
          />
        ) : (
          <Badge variant="kind">No submission</Badge>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        <dl className="space-y-1.5">
          <InspectorProp label="Record">{record?.title ?? '—'}</InspectorProp>
          <InspectorProp label="Project">{projectTitle ?? '—'}</InspectorProp>
          <InspectorProp label="Revision">
            <span className="font-mono text-xs">{revision.id.slice(0, 8)}</span>
          </InspectorProp>
          <InspectorProp label="Integrity">
            <span className="font-mono text-xs">
              {integrityDigest ? `${integrityDigest.slice(0, 16)}…` : '—'}
            </span>
          </InspectorProp>
          <InspectorProp label="Submitted">
            {submission ? formatDate(submission.submitted_at) : '—'}
          </InspectorProp>
          <InspectorProp label="Reason">{revision.reason}</InspectorProp>
        </dl>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Approval workflow
          </h2>
          <ApprovalStepper steps={steps} reviewState={reviewState} />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assigned reviewers
          </h2>
          {submission && submission.assigned_reviewer_user_ids.length > 0 ? (
            <ul className="space-y-1">
              {submission.assigned_reviewer_user_ids.map((userId) => {
                const name =
                  reviewerNames.names[userId] ?? 'Unknown workspace member'
                return (
                  <li
                    key={userId}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {name.slice(0, 2).toUpperCase()}
                    </span>
                    <span>{name}</span>
                    {userId === currentUserId ? (
                      <span className="text-xs font-medium text-link">you</span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No assignees.</p>
          )}
        </section>

        {/* COLLAB-04: the same record-level discussion thread as the record
            page, embedded compactly in the review inspector. It mounts its
            own CollaborationRoom because the shell renders the inspector
            outside this route's subtree; the panel gates on room readiness,
            so SSR/pre-hydration output stays empty. */}
        {collaborationWorkspaceId && recordId ? (
          <section aria-label="Discussion">
            <CollaborationRoom
              roomId={safeBuildRoomId(
                collaborationWorkspaceId,
                'record',
                recordId,
              )}
            >
              <ThreadPanel
                anchor={{
                  anchorType: 'record',
                  workspaceId: collaborationWorkspaceId,
                  recordId,
                }}
                currentRole={collaborationRole}
                canComment={canCommentInRoom(collaborationRole)}
                compact
              />
            </CollaborationRoom>
          </section>
        ) : null}

        {submission ? (
          <SignaturePanel
            submission={submission}
            revision={revision}
            projectId={record?.project_id ?? null}
            signatures={signatures}
            integrityDigest={integrityDigest}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            open={signingOpen}
            onOpenChange={setSigningOpen}
          />
        ) : null}

        <RevisionChainSection
          revisionOptions={revisionOptions}
          currentRevisionId={revision.id}
        />

        <EvidenceExportSection revisionId={revision.id} />

        {isLocked && recordId ? (
          <AmendmentSection
            recordId={recordId}
            onAfterAmendment={onAfterAmendment}
          />
        ) : null}
      </div>

      <div className="shrink-0 space-y-2 border-t p-3">
        <Button
          variant="secondary"
          nativeButton={false}
          className="w-full"
          render={<Link to="/inbox" role="link" />}
        >
          <Icon
            name="chevronRight"
            size={16}
            className="rotate-180"
            aria-hidden
          />
          Back to inbox
        </Button>
        {submission && permission ? (
          <ActionButtons
            submission={submission}
            permission={permission}
            integrityDigest={integrityDigest}
            draftCommentCount={commentDrafts.count}
            onApprovedForSigning={openSigningAfterApproval}
            onAfterDecision={async (kind, input) => {
              // REV-01.3: returning carries the reviewer's private drafts —
              // the decision is taken first (the drafts cannot leak if the
              // return is refused), then the drafts are published together.
              if (kind === 'request_changes' && commentDrafts.count > 0) {
                await returnWithDraftComments(reviewsDataClient, {
                  revisionId: revision.id,
                  drafts: commentDrafts.drafts,
                  decision: input,
                })
                commentDrafts.clear()
                await onCommentsChanged()
              } else {
                await runDecision(kind, input)
              }
              if (submission.id) {
                await queryClient.invalidateQueries({
                  queryKey: reviewWorkspaceQueryKeys.decisions(submission.id),
                })
                await queryClient.invalidateQueries({
                  queryKey: reviewWorkspaceQueryKeys.submissionForRevision(
                    revision.id,
                  ),
                })
              }
            }}
          />
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Actions are available once the submission loads.
          </p>
        )}
      </div>
    </div>
  )
}

async function runDecision(
  kind: ReviewDecisionKind,
  input: ReviewDecisionInput,
) {
  switch (kind) {
    case 'request_changes':
      return requestChangesOnReview(reviewsDataClient, input)
    case 'reject':
      return rejectReview(reviewsDataClient, input)
    case 'approve':
      return approveReview(reviewsDataClient, input)
    case 'withdraw':
      return withdrawReview(reviewsDataClient, input)
  }
}

// ---------------------------------------------------------------------------
// Action buttons — request changes, reject, approve, withdraw, each behind a
// confirmation dialog that states the explicit consequence.
// ---------------------------------------------------------------------------

export function ActionButtons({
  submission,
  permission,
  integrityDigest,
  draftCommentCount = 0,
  onAfterDecision,
  onApprovedForSigning,
}: {
  submission: ReviewSubmissionWire
  permission: ReturnType<typeof deriveReviewActionPermission>
  integrityDigest: string | null
  /** REV-01.3: how many private drafts a return would carry. */
  draftCommentCount?: number
  onAfterDecision: (
    kind: ReviewDecisionKind,
    input: ReviewDecisionInput,
  ) => Promise<void>
  onApprovedForSigning?: () => void
}) {
  const [note, setNote] = useState('')
  const [pendingKind, setPendingKind] = useState<ReviewDecisionKind | null>(
    null,
  )
  // QA-182: the decision RPC is awaited, so the dialog must not close under a
  // failed action and the button must not accept a second submission.
  const [submittingKind, setSubmittingKind] =
    useState<ReviewDecisionKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  useRegisterShortcuts(
    useMemo(
      () =>
        reviewShortcuts({
          approveAndSign:
            permission.canReview && integrityDigest && onApprovedForSigning
              ? () => {
                  setNote('')
                  setError(null)
                  setPendingKind('approve')
                }
              : undefined,
        }),
      [permission.canReview, integrityDigest, onApprovedForSigning],
    ),
  )

  if (integrityDigest === null) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        Fingerprint unavailable — actions disabled.
      </p>
    )
  }

  async function confirm() {
    if (!pendingKind || submittingKind) return
    const kind = pendingKind
    setError(null)
    setSubmittingKind(kind)
    try {
      await onAfterDecision(kind, {
        submissionId: submission.id,
        note: note.trim() || undefined,
        expectedRevisionDigest: integrityDigest!,
      })
      setPendingKind(null)
      setNote('')
      // Approving leads straight into signing; the dialog offers Sign later.
      if (kind === 'approve') onApprovedForSigning?.()
    } catch (err) {
      setError(renderError(err))
    } finally {
      setSubmittingKind(null)
    }
  }

  const reviewActions: {
    kind: ReviewDecisionKind
    label: string
    variant: 'default' | 'secondary' | 'danger'
    icon: IconName
  }[] = [
    {
      kind: 'approve',
      label: 'Approve',
      variant: 'default',
      icon: 'check',
    },
    {
      kind: 'request_changes',
      // REV-01.3: the return action states how many draft comments it carries.
      label:
        draftCommentCount > 0
          ? returnWithCommentsLabel(draftCommentCount)
          : 'Request changes',
      variant: 'secondary',
      icon: 'arrowLeft',
    },
    { kind: 'reject', label: 'Reject', variant: 'danger', icon: 'x' },
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {reviewActions.map((action) => {
          const blocked = !permission.canReview
          const disabled = blocked
          return (
            <DecisionDialog
              key={action.kind}
              kind={action.kind}
              label={action.label}
              variant={action.variant}
              icon={action.icon}
              disabled={disabled}
              blockedReason={permission.reviewBlockedReason ?? undefined}
              draftCommentCount={
                action.kind === 'request_changes' ? draftCommentCount : 0
              }
              note={note}
              setNote={setNote}
              open={pendingKind === action.kind}
              error={pendingKind === action.kind ? error : null}
              submitting={submittingKind === action.kind}
              onOpen={() => {
                setNote('')
              }}
              onConfirm={confirm}
              onOpenChange={(open) => {
                if (open) {
                  setPendingKind(action.kind)
                  setError(null)
                } else if (
                  submittingKind === null &&
                  pendingKind === action.kind
                ) {
                  setPendingKind(null)
                }
              }}
            />
          )
        })}
      </div>

      <DecisionDialog
        kind="withdraw"
        label="Withdraw"
        variant="secondary"
        icon="arrowLeft"
        disabled={!permission.canWithdraw}
        blockedReason={permission.withdrawBlockedReason ?? undefined}
        note={note}
        setNote={setNote}
        open={pendingKind === 'withdraw'}
        error={pendingKind === 'withdraw' ? error : null}
        submitting={submittingKind === 'withdraw'}
        onOpen={() => setNote('')}
        onConfirm={confirm}
        onOpenChange={(open) => {
          if (open) {
            setPendingKind('withdraw')
            setError(null)
          } else if (submittingKind === null && pendingKind === 'withdraw') {
            setPendingKind(null)
          }
        }}
      />
    </div>
  )
}

function DecisionDialog({
  kind,
  label,
  variant,
  icon: iconName,
  disabled,
  blockedReason,
  draftCommentCount = 0,
  note,
  setNote,
  error,
  submitting,
  onOpen,
  onConfirm,
  onOpenChange,
  open,
}: {
  kind: ReviewDecisionKind
  label: string
  variant: 'default' | 'secondary' | 'danger'
  icon: IconName
  disabled: boolean
  blockedReason?: ReviewBlockedReason
  /** REV-01.3: draft comments this return will publish together. */
  draftCommentCount?: number
  note: string
  setNote: (value: string) => void
  /** QA-182: why the decision failed, shown where the action was taken. */
  error?: string | null
  submitting?: boolean
  onOpen: () => void
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open?: boolean
}) {
  const nextState = DECISION_NEXT_STATE[kind]
  const triggerClass = cn(
    'h-9 text-xs',
    variant === 'default' &&
      'bg-primary text-primary-foreground hover:bg-primary/90',
    variant === 'danger' &&
      'border-danger text-danger-text hover:bg-danger-wash',
  )
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange}>
      <ConfirmDialogTrigger asChild>
        <Button
          variant={variant === 'default' ? 'primary' : 'secondary'}
          size="sm"
          className={triggerClass}
          disabled={disabled}
          onClick={onOpen}
          aria-label={label}
          title={blockedReason ? blockedReasonLabel(blockedReason) : undefined}
        >
          <Icon name={iconName} size={14} aria-hidden />
          {label}
        </Button>
      </ConfirmDialogTrigger>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{label} this review?</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {DECISION_CONSEQUENCE[kind]}
            <br />
            <br />
            The submission will move to “{statusLabel(nextState)}”. This cannot
            be undone from the workspace.
            {kind === 'request_changes' && draftCommentCount > 0 ? (
              <>
                <br />
                <br />
                This return sends your {draftCommentCount} draft{' '}
                {draftCommentCount === 1 ? 'comment' : 'comments'} to the
                author; they become visible on the revision and must be resolved
                before it can be resubmitted.
              </>
            ) : null}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <Textarea
          className="min-h-[70px]"
          placeholder={
            kind === 'approve'
              ? 'Optional note for the audit trail…'
              : 'Explain the reason for the audit trail…'
          }
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label={`${label} note`}
        />
        {error ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            {error}
          </p>
        ) : null}
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={submitting}>
            Cancel
          </ConfirmDialogCancel>
          {/* QA-182: the action is a plain button, not a DialogClose — the
              dialog stays open for as long as the transition RPC runs, so a
              refusal is read where the action was taken. */}
          <Button variant="primary" disabled={submitting} onClick={onConfirm}>
            {submitting ? 'Submitting…' : label}
          </Button>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

// ---------------------------------------------------------------------------
// Approval stepper derivation.
// ---------------------------------------------------------------------------

export function buildApprovalSteps(
  submission: ReviewSubmissionWire | null,
): ApprovalStepDef[] {
  if (!submission) return []
  const workflowSteps = workflowStepsFor(submission.workflow_definition_key)
  const steps: ApprovalStepDef[] = [
    { id: 'submission', title: 'Submitted', role: 'Author' },
    ...workflowSteps.map((step) => ({
      id: step.key,
      title: step.label,
      role: step.required ? 'Reviewer' : undefined,
    })),
    { id: 'approved', title: 'Approved & locked' },
  ]
  return steps
}

export function buildStepperState(
  submission: ReviewSubmissionWire | null,
  decisions: ReviewDecisionWire[],
  userLabel: (userId: string) => string,
): Record<string, ApprovalStepStatus> {
  if (!submission) return {}
  // Each step names the person who did it, not whoever is looking at the page.
  const state: Record<string, ApprovalStepStatus> = {
    submission: {
      state: 'completed',
      actor: { name: userLabel(submission.submitted_by_user_id) },
    },
  }
  const workflowSteps = workflowStepsFor(submission.workflow_definition_key)
  const activeStepKey = workflowSteps[0]?.key
  if (submission.state === 'submitted' && activeStepKey) {
    state[activeStepKey] = { state: 'active' }
  }
  const reviewDecision = decisions.find(
    (d) =>
      d.decision === 'approve' ||
      d.decision === 'reject' ||
      d.decision === 'request_changes',
  )
  if (reviewDecision && activeStepKey) {
    state[activeStepKey] = {
      state:
        reviewDecision.decision === 'approve'
          ? 'completed'
          : reviewDecision.decision === 'reject'
            ? 'rejected'
            : 'returned',
      actor: { name: userLabel(reviewDecision.actor_user_id) },
    }
  }
  if (submission.state === 'approved') {
    const approval = decisions.find((d) => d.decision === 'approve')
    state.approved = {
      state: 'completed',
      actor: approval ? { name: userLabel(approval.actor_user_id) } : undefined,
    }
  } else if (submission.state === 'rejected') {
    state.approved = { state: 'unavailable' }
  } else if (submission.state === 'withdrawn') {
    state[activeStepKey || 'approved'] = {
      state: 'unavailable',
    }
  }
  return state
}

// ---------------------------------------------------------------------------
// Inspector property row.
// ---------------------------------------------------------------------------

function InspectorProp({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">
        {children}
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error / empty states.
// ---------------------------------------------------------------------------

function PermissionDenied() {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-6 text-center">
      <Icon name="x" size={32} className="text-fg-muted" aria-hidden />
      <p className="text-sm font-semibold">Permission denied</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        You may not have access to this workspace, or your session has expired.
        Sign in again to continue.
      </p>
    </div>
  )
}

function MissingRevision() {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-6 text-center">
      <Icon name="check" size={32} className="text-fg-muted" aria-hidden />
      <p className="text-sm font-semibold">Revision not found</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        This revision does not exist in your workspace, or it has been removed.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared error rendering for action mutations.
// ---------------------------------------------------------------------------

export function renderError(err: unknown): string {
  if (err instanceof DataClientError) {
    if (err.code === 'SB004') return 'This review is no longer active.'
    if (err.code === 'SB005')
      return 'The review state changed before your action landed. Refresh and try again.'
    if (err.code === 'SB006')
      return 'This revision has been superseded — act on the latest submission instead.'
    if (err.code === 'SB001')
      return 'The revision you were viewing is no longer the active one. Refresh and try again.'
    if (err.code === 'SB002')
      return 'Your session has expired. Sign in again to sign this revision.'
    if (err.code === 'SB007')
      return 'This review has not been approved — only an approved review can be signed.'
    if (err.code === 'SB008')
      return 'Required checks have not passed. Run the reviewer checks and resolve any blocking failures before signing.'
    if (err.code === 'SB009')
      return 'The confirmation you typed does not match your recorded name. Type your name exactly to confirm signing intent.'
    if (err.code === 'SB010') return 'You have already signed this submission.'
    if (err.code === '42501' || err.code === 'permission_denied')
      return 'You do not have permission to perform this action.'
    return err.message
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'Action failed.'
}

// ---------------------------------------------------------------------------
// SIGN-001 — Signature panel and dialog.
//
// Signing is offered only after a review is approved, and only to an assigned
// reviewer who has not already signed. The dialog states the signature
// meaning, the target revision identity and integrity digest, and the
// assurance level honestly — without compliance labelling. The signer must
// type their recorded name to verify current signing intent at the 'standard'
// assurance level.
// ---------------------------------------------------------------------------

export function SignaturePanel({
  submission,
  revision,
  projectId,
  signatures,
  integrityDigest,
  currentUserId,
  currentUserName,
  open,
  onOpenChange,
}: {
  submission: ReviewSubmissionWire
  revision: RevisionWire
  projectId: string | null
  signatures: SignatureWire[]
  integrityDigest: string | null
  currentUserId: string
  currentUserName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)
  const [witnessUserId, setWitnessUserId] = useState('')
  const [requestingWitness, setRequestingWitness] = useState(false)
  const search = useSearch({ from: '/review/$revisionId' })
  const navigate = useNavigate()
  const { revisionId } = useParams({ from: '/review/$revisionId' })
  const eligibility = useQuery({
    queryKey: signatureQueryKeys.eligibility(submission.id, currentUserId),
    queryFn: () =>
      fetchSignatureEligibility(reviewsDataClient, submission, currentUserId),
  })
  // DEC-04 / ADR-0045: a signature requires a current certification. Read the
  // signer's own attestation so the panel states the requirement instead of
  // letting the step-up refuse the password attempt opaquely.
  const certifications = useQuery({
    queryKey: signatureCertificationQueryKeys.workspace(
      submission.workspace_id,
    ),
    queryFn: () =>
      fetchWorkspaceCertifications(
        signatureCertificationDataClient,
        submission.workspace_id,
      ),
  })
  const certificationCurrent = isCurrentStatement(
    (certifications.data ?? []).find((row) => row.userId === currentUserId),
  )
  // The sign target requires the revision's checks to have passed for the
  // signed digest (SB008). Read them so the panel states the requirement
  // instead of letting the password attempt be refused opaquely.
  const checksQuery = useQuery({
    queryKey: reviewCheckQueryKeys.resultsForRevision(submission.revision_id),
    queryFn: () =>
      fetchReviewCheckResults(reviewsDataClient, submission.revision_id),
  })
  const checksPassed = checksQuery.isSuccess
    ? signatureChecksPassed(checksQuery.data, integrityDigest)
    : true
  const meanings = availableSignatureMeanings({
    submission,
    currentUserId,
    integrityDigest,
    supersededByRevisionId: revision.superseded_by_revision_id,
    eligibility: eligibility.data,
    certificationCurrent,
    checksPassed,
    signatures,
  })
  const members = useQuery({
    queryKey: ['signature-witness-candidates', submission.id],
    queryFn: () =>
      projectId
        ? fetchSignatureWitnessCandidates(reviewsDataClient, submission.id)
        : Promise.resolve([]),
    enabled: projectId !== null,
  })
  const canRequestWitness =
    projectId !== null &&
    eligibility.data?.writer &&
    integrityDigest &&
    ['submitted', 'approved'].includes(submission.state) &&
    revision.superseded_by_revision_id === null &&
    (submission.submitted_by_user_id === currentUserId ||
      submission.assigned_reviewer_user_ids.includes(currentUserId))
  const witnesses = members.data ?? []
  const selectedWitness = witnesses.find(
    (member) => member.user_id === witnessUserId,
  )
  const isAssignedReviewer =
    submission.assigned_reviewer_user_ids.includes(currentUserId)
  const alreadySigned = signatures.some(
    (sig) => sig.signer_user_id === currentUserId,
  )

  const canSign = meanings.length > 0
  const canApproveAndSign = meanings.includes('reviewed-and-approved')
  useRegisterShortcuts(
    useMemo(
      () =>
        reviewShortcuts({
          approveAndSign:
            canApproveAndSign && integrityDigest
              ? () => {
                  setError(null)
                  onOpenChange(true)
                }
              : undefined,
        }),
      [canApproveAndSign, integrityDigest, onOpenChange],
    ),
  )

  async function handleSigned(
    meaning: PostSubmissionSignatureMeaning,
    confirmation: string,
    password: string,
  ) {
    if (!integrityDigest) {
      setError('Integrity digest unavailable — signing disabled.')
      return
    }
    setSigning(true)
    setError(null)
    try {
      const proof = await requestSignatureStepUp({
        workspaceId: submission.workspace_id,
        purpose: 'sign',
        password,
        submissionId: submission.id,
        revisionDigest: integrityDigest,
        signatureMeaning: meaning,
      })
      await signRevision(reviewsDataClient, {
        submissionId: submission.id,
        signatureMeaning: meaning,
        confirmationPhrase: confirmation,
        expectedRevisionDigest: integrityDigest,
        signingToken: proof.token,
      })
      await queryClient.invalidateQueries({
        queryKey: signatureQueryKeys.forSubmission(submission.id),
      })
      await queryClient.invalidateQueries({
        queryKey: signatureQueryKeys.forRecord(submission.record_id),
      })
      onOpenChange(false)
    } catch (err) {
      // R5-SHELL-05: when the session behind the step-up has already ended, a
      // retry can never succeed. Send the person to sign in and back to this
      // review instead of leaving an error they cannot act on.
      if (isExpiredSigningSession(err)) {
        onOpenChange(false)
        void navigate({
          to: '/sign-in',
          search: expiredSigningSignInSearch(`/review/${revisionId}`),
        })
        return
      }
      setError(renderError(err))
    } finally {
      setSigning(false)
    }
  }

  async function handleWitnessRequested() {
    if (
      !canRequestWitness ||
      !integrityDigest ||
      !selectedWitness ||
      // REV-03: a witness who cannot read this record would never see the work
      // item, so the request is refused before it is made.
      !selectedWitness.can_read_record ||
      members.isFetching ||
      members.isError
    )
      return
    setRequestingWitness(true)
    setError(null)
    try {
      await requestSignatureWitness(reviewsDataClient, {
        submissionId: submission.id,
        witnessUserId,
        expectedRevisionDigest: integrityDigest,
        dueAt: null,
      })
      await queryClient.invalidateQueries({ queryKey: ['work-items'] })
      setWitnessUserId('')
    } catch (err) {
      setError(renderError(err))
    } finally {
      setRequestingWitness(false)
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Signatures
      </h2>

      {signatures.length > 0 ? (
        <ul className="space-y-2">
          {signatures.map((sig) => (
            <li
              key={sig.id}
              className="rounded-md border bg-muted/20 p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {sig.signer_name ??
                    `Historical signer ${sig.signer_user_id.slice(0, 8)}`}
                </span>
                <span className="text-muted-foreground">
                  {formatNotebookDateTime(sig.signed_at, { zone: true })}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {signatureMeaningLabel(sig.signature_meaning)}
              </p>
              {(() => {
                // GOV-04: does this immutable signature still attest the
                // revision being viewed? Amendments never move signatures.
                const validity = deriveSignatureApplicability({
                  signatureDigest: sig.revision_integrity_digest,
                  viewedRevisionDigest: integrityDigest,
                  viewedRevisionSupersededBy:
                    revision.superseded_by_revision_id,
                })
                const tone =
                  validity.applicability === 'current'
                    ? 'text-success-text'
                    : validity.applicability === 'superseded'
                      ? 'text-warning-text'
                      : 'text-destructive'
                return (
                  <p className={`mt-1 text-xs ${tone}`}>
                    {validity.explanation}
                  </p>
                )
              })()}
              <p className="mt-0.5 font-mono text-xs text-muted-foreground/70">
                {sig.assurance_level} · {sig.auth_method} ·{' '}
                {sig.revision_integrity_digest.slice(0, 12)}…
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No signatures recorded yet.
        </p>
      )}

      {['submitted', 'approved'].includes(submission.state) ? (
        <div className="mt-2">
          {canSign ? (
            <SignatureDialog
              open={open}
              onOpenChange={(next) => {
                onOpenChange(next)
                if (next) setError(null)
              }}
              revision={revision}
              integrityDigest={integrityDigest}
              meanings={meanings}
              requestedMeaning={search.signatureMeaning}
              currentUserName={currentUserName}
              signing={signing}
              error={error}
              // An approved review waits for the signature; leaving the dialog
              // is a choice to sign later, and the Inbox keeps the reminder.
              cancelLabel={
                submission.state === 'approved' ? 'Sign later' : undefined
              }
              onConfirm={handleSigned}
            />
          ) : certifications.isError || eligibility.isError ? (
            <p className="text-xs text-muted-foreground">
              Your certification and signing eligibility could not be checked,
              so signing is unavailable here. Reload the review to try again.
            </p>
          ) : certifications.isSuccess &&
            !alreadySigned &&
            !certificationCurrent ? (
            <p className="text-xs text-warning-text">
              Certification is required before you can sign. An uncertified
              signature is not accepted — certify in{' '}
              <Link
                to="/settings/my-signature"
                search={{ returnTo: returnToHere() }}
                className="underline"
              >
                Settings → Electronic signatures
              </Link>
              .
            </p>
          ) : alreadySigned ? (
            <p className="text-xs text-muted-foreground">
              You have already signed this submission.
            </p>
          ) : submission.submitted_by_user_id === currentUserId ? (
            <p className="text-xs text-muted-foreground">
              You submitted this revision, so you cannot sign it. A signature
              must come from an assigned nonauthor reviewer or an explicit
              witness request.
            </p>
          ) : !isAssignedReviewer ? (
            <p className="text-xs text-muted-foreground">
              Signing requires assignment as a nonauthor reviewer or an explicit
              witness request.
            </p>
          ) : !integrityDigest ? (
            <p className="text-xs text-muted-foreground">
              The revision's fingerprint is unavailable, so signing is disabled.
            </p>
          ) : revision.superseded_by_revision_id !== null ? (
            <p className="text-xs text-muted-foreground">
              This revision has been superseded — sign the active submission
              instead.
            </p>
          ) : eligibility.isSuccess && !eligibility.data.writer ? (
            <p className="text-xs text-muted-foreground">
              Your workspace role cannot sign revisions.
            </p>
          ) : checksQuery.isSuccess && !checksPassed ? (
            <p className="text-xs text-muted-foreground">
              Signing requires this revision's review checks to have passed for
              its digest. Run the checks and resolve any blocking failures
              first.
            </p>
          ) : eligibility.isSuccess && certifications.isSuccess ? (
            // QA-184: signing has an off switch for every reason the panel can
            // withhold it, so a person never faces an unexplained gap. Both
            // lookups must be settled first, or the statement would be a guess.
            <p className="text-xs text-muted-foreground">
              Signing is not available for you on this revision.
            </p>
          ) : null}
        </div>
      ) : null}
      {canRequestWitness ? (
        <div className="mt-3 space-y-2">
          <label htmlFor="signature-witness" className="text-xs font-medium">
            Request a witness for this frozen revision
          </label>
          <Select
            id="signature-witness"
            value={witnessUserId}
            disabled={
              requestingWitness || members.isFetching || members.isError
            }
            onChange={(event) => setWitnessUserId(event.target.value)}
          >
            <option value="">Choose another permitted member</option>
            {witnesses.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.workspace_role
                  ? `${member.name} · ${member.workspace_role}`
                  : member.name}
                {/* REV-03: the server's answer for this person, stated here so
                    a member who cannot read the record reads as not askable. */}
                {member.can_read_record ? '' : ' — cannot read this record'}
              </option>
            ))}
          </Select>
          {/* QA-183: a greyed picker states why it cannot be used. */}
          {members.isError ? (
            <p className="text-xs text-muted-foreground">
              The members who may witness could not be loaded, so nobody can be
              asked here. Reload the review to try again.
            </p>
          ) : members.isFetching ? (
            <p className="text-xs text-muted-foreground">
              Loading the members who may witness…
            </p>
          ) : witnesses.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No other member of this project may witness this revision, so
              there is nobody to ask.
            </p>
          ) : null}
          {/* REV-03: the picker states the refusal before the call, with the
              reason the server enforces — this person cannot read this record,
              so the request would be a dead end. */}
          {selectedWitness && !selectedWitness.can_read_record ? (
            <p role="alert" className="text-xs text-destructive">
              {selectedWitness.name} cannot read this record, so they cannot
              witness it. Choose a member who can see this record.
            </p>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={
              !selectedWitness ||
              !selectedWitness.can_read_record ||
              requestingWitness ||
              members.isFetching ||
              members.isError
            }
            onClick={() => void handleWitnessRequested()}
          >
            Request witness
          </Button>
        </div>
      ) : null}
      {error && !open ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function signatureMeaningLabel(meaning: SignatureMeaning): string {
  return SIGNATURE_MEANING_LABEL[meaning]
}

// ---------------------------------------------------------------------------
// SIGN-002 — Evidence export and amendment sections.
//
// EvidenceExportSection fetches the machine-readable evidence bundle from the
// export_revision_evidence RPC and offers it as a JSON download with a stable
// filename. The bundle is deterministic (formatVersion 1) so it can be archived
// or diffed. AmendmentSection is the explicit, traceable way to begin a new
// draft from a locked record — it calls create_amendment, which records an
// 'amend' revision, supersedes the locked revision and unlocks the record.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GOV-04 — Amendment chain. Ordered oldest-first from the authoritative
// superseded_by edges; makes "signed, then amended" legible without moving
// any signature or inventing relationships.
// ---------------------------------------------------------------------------

export function RevisionChainSection({
  revisionOptions,
  currentRevisionId,
}: {
  revisionOptions: RevisionOptionWire[]
  currentRevisionId: string
}) {
  const chain = useMemo(
    () => buildAmendmentChain(revisionOptions),
    [revisionOptions],
  )
  if (chain.length < 2) return null

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Amendment chain
      </h2>
      <ol className="space-y-1">
        {chain.map((entry) => {
          const isCurrent = entry.id === currentRevisionId
          return (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <Link
                to="/review/$revisionId"
                params={{ revisionId: entry.id }}
                className="min-w-0 truncate font-mono no-underline hover:underline"
              >
                {entry.id.slice(0, 8)}
              </Link>
              <span className="truncate text-muted-foreground">
                {entry.reason}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatDate(entry.createdAt)}
              </span>
              {isCurrent ? (
                <Badge variant="kind" className="h-4 shrink-0 px-1 text-[10px]">
                  viewed
                </Badge>
              ) : null}
            </li>
          )
        })}
      </ol>
      <p className="mt-1 text-xs text-muted-foreground">
        Signatures stay attached to their original frozen revision — an
        amendment never moves them.
      </p>
    </section>
  )
}

function EvidenceExportSection({ revisionId }: { revisionId: string }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Evidence export
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">
        Download a deterministic evidence package (ZIP): machine-readable JSON,
        frozen Sheet grids as CSV, the pinned file manifest and a sha256
        checksum list. Submitted revisions are immutable; the package never
        changes after download-time content is captured.
      </p>
      <Button
        variant="secondary"
        nativeButton={false}
        className="w-full"
        render={
          <a href={`/api/export/revision/${revisionId}/package`} role="link" />
        }
      >
        <Icon name="download" className="size-3.5 shrink-0" aria-hidden />
        Download evidence package (ZIP)
      </Button>
    </section>
  )
}

/** SIGN-002: begin an amendment from a locked record. Exported for tests. */
export function AmendmentSection({
  recordId,
  onAfterAmendment,
}: {
  recordId: string
  onAfterAmendment: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{
    revisionId: string
    unlockedAt: string
  } | null>(null)

  if (result) {
    return (
      <section
        role="status"
        className="rounded-md border border-success bg-success-wash p-2 text-xs text-success-text"
      >
        <Icon
          name="check"
          className="mr-1 inline size-3 align-text-bottom"
          aria-hidden
        />
        Amendment started — revision{' '}
        <span className="font-mono">{result.revisionId.slice(0, 8)}</span>. The
        record is unlocked and ready to edit.
      </section>
    )
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Amendment
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">
        This record is locked. Start an amendment to create a new draft
        revision, supersede the locked one and unlock the record for editing.
        The amendment and its reason are recorded in the audit trail.
      </p>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        <Icon name="check" size={14} aria-hidden />
        Start amendment
      </Button>
      <AmendNotebookDialog
        open={open}
        onOpenChange={setOpen}
        recordId={recordId}
        onAmended={async (amended) => {
          setResult({
            revisionId: amended.revisionId,
            unlockedAt: amended.unlockedAt,
          })
          await onAfterAmendment()
        }}
      />
    </section>
  )
}
