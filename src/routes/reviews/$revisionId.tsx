/**
 * REV-007 — Review & Approvals workspace route.
 *
 * `/reviews/$revisionId` combines the REV-003 version diff, REV-004 anchored
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
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useParams,
  useSearch,
} from '@tanstack/react-router'
import { z } from 'zod'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  FileText,
  Download,
  GitCommit,
  GitCompare,
  History,
  ListChecks,
  Lock,
  MessageSquare,
  PenLine,
  ShieldCheck,
  Undo2,
  XCircle,
} from 'lucide-react'

import {
  CollaborationRoom,
  safeBuildRoomId,
} from '#/components/collaboration/collaboration-room'
import { PresenceStack } from '#/components/collaboration/presence-avatars'
import { ThreadPanel } from '#/components/collaboration/thread-panel'
import { useCollaborationEnabled } from '#/lib/collaboration/liveblocks.config'
import { canCommentInRoom } from '#/lib/collaboration/permissions'
import { useShell } from '#/components/app-shell'
import { ApprovalStepper, RecordHistoryTimeline } from '#/components/audit'
import type { ApprovalStepDef, ApprovalStepStatus } from '#/components/audit'
import { CommentPanel } from '#/components/comments'
import { ReviewCheckResults, RevisionDiffReview } from '#/components/review'
import { StatusBadge } from '#/components/scientific/status-badge'
import type {
  StatusDefinition,
  StatusVocabulary,
} from '#/components/scientific/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import {
  fetchProjectsForReviews,
  fetchRecordsForReviews,
  reviewQueryKeys,
  reviewsDataClient,
  workflowStepsFor,
} from '#/lib/reviews'
import { formatDate } from '#/lib/notebook-data'
import {
  fetchReviewCheckResults,
  reviewCheckQueryKeys,
  runRevisionChecks,
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
  ASSURANCE_LEVEL_STATEMENT,
  fetchSignaturesForSubmission,
  signatureQueryKeys,
  SIGNATURE_MEANING_OPTIONS,
  signRevision,
} from '#/lib/signatures'
import type { SignatureMeaning, SignatureWire } from '#/lib/signatures'
import {
  createAmendment,
  fetchRecordTimeline,
  sign002DataClient,
  sign002QueryKeys,
} from '#/lib/sign-002'
import {
  buildAmendmentChain,
  deriveReviewLifecycle,
  deriveSignatureApplicability,
} from '#/lib/review-lifecycle'
import { cn } from '#/lib/utils'

function RouteShell({
  children,
  ...configuration
}: Parameters<typeof useShell>[0] & { children: ReactNode }) {
  useShell(configuration)
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Deep-linkable search state. `tab` keeps the active panel shareable; the
// comparison revision id lets a reviewer link to a specific before/after
// diff view.
// ---------------------------------------------------------------------------

const workspaceSearchSchema = z.object({
  tab: z.enum(['diff', 'comments', 'checks', 'history']).optional(),
  comparisonRevisionId: z.string().optional(),
})

type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>

export const Route = createFileRoute('/reviews/$revisionId')({
  validateSearch: workspaceSearchSchema,
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ReviewWorkspaceRoute,
})

// ---------------------------------------------------------------------------
// Workspace status vocabulary (mirrors the inbox).
// ---------------------------------------------------------------------------
const workspaceStatusVocabulary: StatusVocabulary = {
  submitted: { label: 'Under review', tone: 'info', icon: ClipboardList },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', icon: Undo2 },
  approved: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  rejected: { label: 'Rejected', tone: 'danger', icon: XCircle },
  returned: { label: 'Changes requested', tone: 'warning', icon: Undo2 },
}

/** GOV-04 derived lifecycle vocabulary (never a second backend state). */
const lifecycleVocabulary: StatusVocabulary = {
  draft: { label: 'Draft', tone: 'neutral', icon: FileText },
  'under-review': {
    label: 'Under review',
    tone: 'info',
    icon: ClipboardList,
  },
  'changes-requested': {
    label: 'Changes requested',
    tone: 'warning',
    icon: Undo2,
  },
  approved: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  'signed-locked': { label: 'Signed & locked', tone: 'violet', icon: Lock },
  superseded: { label: 'Superseded', tone: 'neutral', icon: GitCommit },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', icon: Undo2 },
  rejected: { label: 'Rejected', tone: 'danger', icon: XCircle },
}

/** Runtime-safe status label lookup (state values come from the DB/RPC). */
export function statusLabel(state: string): string {
  const def = (
    workspaceStatusVocabulary as Partial<Record<string, StatusDefinition>>
  )[state]
  return def?.label ?? state
}

const DEFAULT_CHECK_DEFINITION_KEY = 'default-scientific-checks'
const DEFAULT_CHECK_DEFINITION_VERSION = 1

// ---------------------------------------------------------------------------
// Route component.
// ---------------------------------------------------------------------------

export function ReviewWorkspaceRoute() {
  const { context } = Route.useRouteContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { revisionId } = useParams({ from: '/reviews/$revisionId' })
  const search = useSearch({ from: '/reviews/$revisionId' })

  const currentUserId = context.user.id
  const currentUserName = context.user.name
  const activeTab = search.tab ?? 'diff'

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

  const integrityDigest = revision?.integrity_digest ?? null

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
      to: '/reviews/$revisionId',
      params: { revisionId },
      search: { ...search, tab },
      replace: true,
    })
  }

  function navigateComparison(id: string | null) {
    void navigate({
      to: '/reviews/$revisionId',
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
        context={shellContext(context)}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Reviews', to: '/reviews' },
        ]}
      >
        <PermissionDenied />
      </RouteShell>
    )
  }

  if (!loading && !revision) {
    return (
      <RouteShell
        context={shellContext(context)}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Reviews', to: '/reviews' },
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

  const shellContextValue = shellContext(context)

  // COLLAB-04: the whole workspace shares the record's collaboration room;
  // CollaborationRoom renders children unchanged until the provider is
  // mounted, so SSR markup is unaffected.
  return (
    <CollaborationRoom roomId={collaborationRoomId}>
      <RouteShell
        fullBleed
        context={shellContextValue}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Reviews', to: '/reviews' },
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
          />

          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              navigateTab(value as WorkspaceSearch['tab'])
            }
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList aria-label="Review workspace panels">
              <TabsTrigger value="diff">
                <GitCompare className="size-3.5" aria-hidden />
                Diff
              </TabsTrigger>
              <TabsTrigger value="comments">
                <MessageSquare className="size-3.5" aria-hidden />
                Comments
              </TabsTrigger>
              <TabsTrigger value="checks">
                <ListChecks className="size-3.5" aria-hidden />
                Checks
              </TabsTrigger>
              <TabsTrigger value="history">
                <History className="size-3.5" aria-hidden />
                History
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="diff"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <DiffPanel
                beforeEnvelope={beforeEnvelope}
                afterEnvelope={afterEnvelope}
                revisionOptions={revisionOptions}
                currentRevisionId={revisionId}
                effectiveComparisonId={effectiveComparisonId}
                onComparisonChange={navigateComparison}
                comparisonLoading={
                  effectiveComparisonId !== null &&
                  comparisonRevisionQuery.isLoading
                }
              />
            </TabsContent>

            <TabsContent
              value="comments"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {submission && revision ? (
                <CommentPanel
                  revisionId={revisionId}
                  targetKind="revision"
                  target={{}}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  canComment={
                    permission?.canReview === true ||
                    permission?.canWithdraw === true
                  }
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Comments are available once the revision is loaded.
                </p>
              )}
            </TabsContent>

            <TabsContent
              value="checks"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <ChecksPanel
                revisionId={revisionId}
                results={checkResults}
                loading={checksQuery.isLoading}
                canRun={
                  permission?.canReview === true && integrityDigest !== null
                }
                onRefresh={() => void checksQuery.refetch()}
              />
            </TabsContent>

            <TabsContent
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
            </TabsContent>
          </Tabs>
        </div>
      </RouteShell>
    </CollaborationRoom>
  )
}

// ---------------------------------------------------------------------------
// Helpers shared by the route component.
// ---------------------------------------------------------------------------

function shellContext(context: {
  user: { name: string; email: string }
  workspace: { name: string; role: string } | null
}) {
  return {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }
}

// ---------------------------------------------------------------------------
// Workspace header — record identity, status, stale/superseded banners.
// ---------------------------------------------------------------------------

function WorkspaceHeader({
  submission,
  record,
  projectTitle,
  revision,
  permission,
  isLocked,
  lockedAt,
  lockedByRevisionId,
}: {
  submission: ReviewSubmissionWire | null
  record: { identifier?: string; title?: string; kind?: string } | null
  projectTitle: string | null
  revision: RevisionWire | null
  permission: ReturnType<typeof deriveReviewActionPermission> | null
  isLocked: boolean
  lockedAt: string | null
  lockedByRevisionId: string | null
}) {
  const isSuperseded =
    revision?.superseded_by_revision_id !== null && revision !== null
  const state = submission?.state ?? null
  // GOV-04: one derived lifecycle from authoritative fields — never a
  // second state machine. Signed-locked wins; supersession next.
  const lifecycle = deriveReviewLifecycle({
    submissionState: state,
    lockedAt: lockedAt,
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
            {record?.identifier ?? revision?.id}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {/* COLLAB-04: who else is reviewing right now; renders null before
              the room mounts and when nobody else is present. */}
          <PresenceStack className="justify-end" />
          {state ? (
            <StatusBadge
              status={lifecycle.status}
              vocabulary={lifecycleVocabulary}
              size="sm"
            />
          ) : null}
          {!state ? (
            <StatusBadge
              status={lifecycle.status}
              vocabulary={lifecycleVocabulary}
              size="sm"
            />
          ) : null}
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
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        >
          <Lock className="mr-1 inline size-3 align-text-bottom" aria-hidden />
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
            <span className="ml-1 text-emerald-700 dark:text-emerald-300">
              Locked {formatDate(lockedAt)}.
            </span>
          ) : null}
        </div>
      ) : null}
      {isSuperseded ? (
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
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
      {permission && !permission.canReview && !permission.canWithdraw ? (
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
}: {
  beforeEnvelope: ReturnType<typeof toCanonicalEnvelope> | null
  afterEnvelope: ReturnType<typeof toCanonicalEnvelope> | null
  revisionOptions: RevisionOptionWire[]
  currentRevisionId: string
  effectiveComparisonId: string | null
  onComparisonChange: (id: string | null) => void
  comparisonLoading: boolean
}) {
  const comparableOptions = revisionOptions.filter(
    (option) => option.id !== currentRevisionId,
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
          <select
            id="review-comparison-select"
            className="mt-1 block w-full max-w-xs rounded-md border bg-background px-2 py-1 text-sm"
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
          </select>
        </div>
        {comparisonLoading ? (
          <span className="text-xs text-muted-foreground">
            Loading comparison…
          </span>
        ) : null}
      </div>

      {!beforeEnvelope ? (
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
      ) : (
        <RevisionDiffReview
          before={beforeEnvelope}
          after={afterEnvelope}
          beforeLabel="Earlier revision"
          afterLabel="Submitted revision"
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
      await runRevisionChecks(reviewsDataClient, {
        revisionId,
        checkDefinitionKey: DEFAULT_CHECK_DEFINITION_KEY,
        checkDefinitionVersion: DEFAULT_CHECK_DEFINITION_VERSION,
        idempotencyKey: `workspace-${revisionId}-${Date.now()}`,
      })
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
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
          {canRun ? (
            <Button size="sm" onClick={handleRun} disabled={running}>
              <ListChecks className="size-3.5" aria-hidden />
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
}: {
  revision: RevisionWire | null
  submission: ReviewSubmissionWire | null
  record: { identifier?: string; title?: string; kind?: string } | null
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
}) {
  const queryClient = useQueryClient()

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
  const reviewState = buildStepperState(submission, decisions, currentUserName)

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
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
          <Badge variant="outline">No submission</Badge>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
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
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Approval workflow
          </h3>
          <ApprovalStepper steps={steps} reviewState={reviewState} />
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assigned reviewers
          </h3>
          {submission && submission.assigned_reviewer_user_ids.length > 0 ? (
            <ul className="space-y-1">
              {submission.assigned_reviewer_user_ids.map((userId) => (
                <li
                  key={userId}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {userId.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="font-mono">{userId}</span>
                  {userId === currentUserId ? (
                    <span className="text-xs font-medium text-primary">
                      you
                    </span>
                  ) : null}
                </li>
              ))}
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
            signatures={signatures}
            integrityDigest={integrityDigest}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
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

      <div className="space-y-2 border-t p-3">
        <Link
          to="/reviews"
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border text-sm font-medium no-underline hover:bg-muted"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Back to inbox
        </Link>
        {submission && permission ? (
          <ActionButtons
            submission={submission}
            permission={permission}
            integrityDigest={integrityDigest}
            onAfterDecision={async (kind, input) => {
              await runDecision(kind, input)
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
  onAfterDecision,
}: {
  submission: ReviewSubmissionWire
  permission: ReturnType<typeof deriveReviewActionPermission>
  integrityDigest: string | null
  onAfterDecision: (
    kind: ReviewDecisionKind,
    input: ReviewDecisionInput,
  ) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [pendingKind, setPendingKind] = useState<ReviewDecisionKind | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  if (integrityDigest === null) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        Integrity digest unavailable — actions disabled.
      </p>
    )
  }

  async function confirm() {
    if (!pendingKind) return
    setError(null)
    try {
      await onAfterDecision(pendingKind, {
        submissionId: submission.id,
        note: note.trim() || undefined,
        expectedRevisionDigest: integrityDigest!,
      })
      setPendingKind(null)
      setNote('')
    } catch (err) {
      setError(renderError(err))
    }
  }

  const reviewActions: {
    kind: ReviewDecisionKind
    label: string
    variant: 'default' | 'outline' | 'danger'
    icon: typeof CheckCircle2
  }[] = [
    {
      kind: 'approve',
      label: 'Approve',
      variant: 'default',
      icon: CheckCircle2,
    },
    {
      kind: 'request_changes',
      label: 'Request changes',
      variant: 'outline',
      icon: Undo2,
    },
    { kind: 'reject', label: 'Reject', variant: 'danger', icon: XCircle },
  ]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
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
              note={note}
              setNote={setNote}
              onOpen={() => setNote('')}
              onConfirm={confirm}
              onOpenChange={(open) => {
                if (open) {
                  setPendingKind(action.kind)
                  setError(null)
                } else if (pendingKind === action.kind) {
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
        variant="outline"
        icon={Undo2}
        disabled={!permission.canWithdraw}
        blockedReason={permission.withdrawBlockedReason ?? undefined}
        note={note}
        setNote={setNote}
        onOpen={() => setNote('')}
        onConfirm={confirm}
        onOpenChange={(open) => {
          if (open) {
            setPendingKind('withdraw')
            setError(null)
          } else if (pendingKind === 'withdraw') {
            setPendingKind(null)
          }
        }}
      />

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

function DecisionDialog({
  kind,
  label,
  variant,
  icon: Icon,
  disabled,
  blockedReason,
  note,
  setNote,
  onOpen,
  onConfirm,
  onOpenChange,
}: {
  kind: ReviewDecisionKind
  label: string
  variant: 'default' | 'outline' | 'danger'
  icon: typeof CheckCircle2
  disabled: boolean
  blockedReason?: ReviewBlockedReason
  note: string
  setNote: (value: string) => void
  onOpen: () => void
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const nextState = DECISION_NEXT_STATE[kind]
  const triggerClass = cn(
    'h-9 text-xs',
    variant === 'default' &&
      'bg-primary text-primary-foreground hover:bg-primary/90',
    variant === 'danger' &&
      'border-destructive text-destructive hover:bg-destructive/10',
  )
  return (
    <AlertDialog onOpenChange={(open) => onOpenChange(open)}>
      <AlertDialogTrigger asChild>
        <Button
          variant={variant === 'default' ? 'default' : 'outline'}
          size="sm"
          className={triggerClass}
          disabled={disabled}
          onClick={onOpen}
          aria-label={label}
          title={blockedReason ? blockedReasonLabel(blockedReason) : undefined}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label} this review?</AlertDialogTitle>
          <AlertDialogDescription>
            {DECISION_CONSEQUENCE[kind]}
            <br />
            <br />
            The submission will move to “{statusLabel(nextState)}”. This cannot
            be undone from the workspace.
          </AlertDialogDescription>
        </AlertDialogHeader>
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
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  currentUserName: string,
): Record<string, ApprovalStepStatus> {
  if (!submission) return {}
  const state: Record<string, ApprovalStepStatus> = {
    submission: { state: 'completed', actor: { name: currentUserName } },
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
      actor: { name: currentUserName },
    }
  }
  if (submission.state === 'approved') {
    state.approved = { state: 'completed', actor: { name: currentUserName } }
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
      <XCircle className="size-8 text-muted-foreground" aria-hidden />
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
      <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
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

function SignaturePanel({
  submission,
  revision,
  signatures,
  integrityDigest,
  currentUserId,
  currentUserName,
}: {
  submission: ReviewSubmissionWire
  revision: RevisionWire
  signatures: SignatureWire[]
  integrityDigest: string | null
  currentUserId: string
  currentUserName: string
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)

  const isApproved = submission.state === 'approved'
  const isAssignedReviewer =
    submission.assigned_reviewer_user_ids.includes(currentUserId)
  const alreadySigned = signatures.some(
    (sig) => sig.signer_user_id === currentUserId,
  )

  const canSign = isApproved && isAssignedReviewer && !alreadySigned

  async function handleSigned(meaning: SignatureMeaning, confirmation: string) {
    if (!integrityDigest) {
      setError('Integrity digest unavailable — signing disabled.')
      return
    }
    setSigning(true)
    setError(null)
    try {
      await signRevision(reviewsDataClient, {
        submissionId: submission.id,
        signatureMeaning: meaning,
        confirmationPhrase: confirmation,
        expectedRevisionDigest: integrityDigest,
      })
      await queryClient.invalidateQueries({
        queryKey: signatureQueryKeys.forSubmission(submission.id),
      })
      setOpen(false)
    } catch (err) {
      setError(renderError(err))
    } finally {
      setSigning(false)
    }
  }

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Signatures
      </h3>

      {signatures.length > 0 ? (
        <ul className="space-y-2">
          {signatures.map((sig) => (
            <li
              key={sig.id}
              className="rounded-md border bg-muted/20 p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {sig.signer_user_id === currentUserId
                    ? currentUserName
                    : sig.signer_user_id.slice(0, 8)}
                </span>
                <span className="text-muted-foreground">
                  {formatDate(sig.signed_at)}
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
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : validity.applicability === 'superseded'
                      ? 'text-amber-700 dark:text-amber-300'
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

      {isApproved ? (
        <div className="mt-2">
          {canSign ? (
            <SignatureDialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next)
                if (next) setError(null)
              }}
              revision={revision}
              integrityDigest={integrityDigest}
              currentUserName={currentUserName}
              signing={signing}
              error={error}
              onConfirm={handleSigned}
            />
          ) : alreadySigned ? (
            <p className="text-xs text-muted-foreground">
              You have already signed this submission.
            </p>
          ) : !isAssignedReviewer ? (
            <p className="text-xs text-muted-foreground">
              Only an assigned reviewer may sign an approved revision.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function SignatureDialog({
  open,
  onOpenChange,
  revision,
  integrityDigest,
  currentUserName,
  signing,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  revision: RevisionWire
  integrityDigest: string | null
  currentUserName: string
  signing: boolean
  error: string | null
  onConfirm: (meaning: SignatureMeaning, confirmation: string) => void
}) {
  const [meaning, setMeaning] = useState<SignatureMeaning>('approve-for-record')
  const [confirmation, setConfirmation] = useState('')

  const selected = SIGNATURE_MEANING_OPTIONS.find((o) => o.value === meaning)!
  const confirmationMatches =
    confirmation.trim().toLowerCase() === currentUserName.trim().toLowerCase()

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setMeaning('approve-for-record')
          setConfirmation('')
        }
        onOpenChange(next)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" className="h-9 w-full text-xs">
          <PenLine className="size-3.5" aria-hidden />
          Sign revision
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign this revision</AlertDialogTitle>
          <AlertDialogDescription>
            You are signing revision{' '}
            <span className="font-mono">{revision.id.slice(0, 8)}</span> as an
            attestation of your review. This is an internal electronic
            signature, not a regulatory compliance certification.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
          <InspectorPropStatic label="Revision">
            <span className="font-mono">{revision.id.slice(0, 12)}…</span>
          </InspectorPropStatic>
          <InspectorPropStatic label="Integrity">
            <span className="font-mono">
              {integrityDigest ? `${integrityDigest.slice(0, 16)}…` : '—'}
            </span>
          </InspectorPropStatic>
          <InspectorPropStatic label="Reason">
            {revision.reason}
          </InspectorPropStatic>
        </dl>

        <div className="space-y-2">
          <label
            htmlFor="signature-meaning"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Signature meaning
          </label>
          <select
            id="signature-meaning"
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
          <p className="text-xs text-muted-foreground">
            {selected.description}
          </p>
        </div>

        <p className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground">
          {ASSURANCE_LEVEL_STATEMENT.standard}
        </p>

        <div className="space-y-2">
          <label
            htmlFor="signature-confirmation"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Type your name to confirm
          </label>
          <input
            id="signature-confirmation"
            type="text"
            className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={currentUserName}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Type your recorded name exactly to verify your signing intent.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={signing || !confirmationMatches}
            onClick={() => onConfirm(meaning, confirmation)}
          >
            {signing ? 'Signing…' : 'Sign'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function signatureMeaningLabel(meaning: SignatureMeaning): string {
  const option = SIGNATURE_MEANING_OPTIONS.find((o) => o.value === meaning)
  return option?.label ?? meaning
}

function InspectorPropStatic({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">
        {children}
      </dd>
    </div>
  )
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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Amendment chain
      </h3>
      <ol className="space-y-1">
        {chain.map((entry) => {
          const isCurrent = entry.id === currentRevisionId
          return (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <Link
                to="/reviews/$revisionId"
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
                <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Evidence export
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Download a deterministic evidence package (ZIP): machine-readable JSON,
        frozen Sheet grids as CSV, the pinned file manifest and a sha256
        checksum list. Submitted revisions are immutable; the package never
        changes after download-time content is captured.
      </p>
      <a
        href={`/api/export/revision/${revisionId}/package`}
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border text-sm font-medium hover:bg-accent"
      >
        <Download className="size-3.5" aria-hidden />
        Download evidence package (ZIP)
      </a>
    </section>
  )
}

function AmendmentSection({
  recordId,
  onAfterAmendment,
}: {
  recordId: string
  onAfterAmendment: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    revisionId: string
    unlockedAt: string
  } | null>(null)

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await createAmendment(sign002DataClient, {
        recordId,
        note: note.trim() || undefined,
      })
      setResult({
        revisionId: res.revisionId,
        unlockedAt: res.unlockedAt,
      })
      await onAfterAmendment()
      setOpen(false)
      setNote('')
    } catch (err) {
      setError(renderError(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <section
        role="status"
        className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      >
        <GitCommit
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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Amendment
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">
        This record is locked. Start an amendment to create a new draft
        revision, supersede the locked one and unlock the record for editing.
        The amendment is recorded in the audit trail.
      </p>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setNote('')
            setError(null)
          }
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 w-full text-xs">
            <GitCommit className="size-3.5" aria-hidden />
            Start amendment
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start an amendment?</AlertDialogTitle>
            <AlertDialogDescription>
              A new revision will be created from the current record, the locked
              revision will be superseded, and the record will be unlocked so
              you can edit again. This is recorded in the audit trail and cannot
              be undone from the workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            className="min-h-[70px]"
            placeholder="Describe the reason for the amendment (optional)…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-label="Amendment note"
          />
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={handleConfirm}>
              {submitting ? 'Starting…' : 'Start amendment'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
