import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  useBlocker,
  useNavigate,
  useRouterState,
  redirect,
} from '@tanstack/react-router'
import { Archive, FileWarning, Lock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  ExtensionObjectActions,
  toExtensionPanelTabs,
} from '#/components/extensions/extension-slots'
import { useExtensionPoints } from '#/components/extensions/use-extension-points'
import {
  describeExtensionInvocationError,
  invokeExtensionContribution,
} from '#/lib/extensions/registry'
import type { ResolvedExtensionContribution } from '#/lib/extensions/registry'
import { SAMPLE_EXTENSION_KEY } from '#/lib/extensions/sample/manifest'
import { SampleExtensionPanel } from '#/lib/extensions/sample/panel'
import {
  CollaborationRoom,
  safeBuildRoomId,
} from '#/components/collaboration/collaboration-room'
import { useCollaborationEnabled } from '#/lib/collaboration/liveblocks.config'
import { PresenceStack } from '#/components/collaboration/presence-avatars'
import { AmendNotebookDialog } from '#/components/notebook/amend-notebook-dialog'
import { DuplicateNotebookDialog } from '#/components/notebook/duplicate-notebook-dialog'
import { NotebookHistoryPanel } from '#/components/notebook/notebook-history-panel'
import { NotebookTemplateUpgradeBanner } from '#/components/notebook/notebook-template-upgrade-banner'
import { ProjectNavigationTree } from '#/components/project-navigation-tree'
import {
  ExportEvidenceButton,
  NotebookPrintStyles,
  PrintNotebookButton,
} from '#/components/notebook/print-notebook'
import { SignNotebookDialog } from '#/components/notebook/sign-notebook-dialog'
import { SubmitNotebookDialog } from '#/components/notebook/submit-notebook-dialog'
import { NotebookDocument } from '#/components/notebook'
import type { SaveResult } from '#/components/notebook'
import {
  canonicalCellFacts,
  NotebookCellProperties,
} from '#/components/notebook/notebook-inspector'
import type { NotebookInspectorCellFacts } from '#/components/notebook/notebook-inspector'
import type { SheetCellSelection } from '#/components/sheet/canonical-sheet-workspace'
import { CommentPanel } from '#/components/comments'
import { useLiveStatus } from '#/components/live/live-event-provider'
import { deviceOfflineEditStore } from '#/components/offline/device-store'
import {
  OfflineEditsProvider,
  useIsOnline,
} from '#/components/offline/offline-edits'
import {
  OfflineStatusBanner,
  UnsyncedChangesSection,
} from '#/components/offline/offline-status'
import { OfflineReplayRunner } from '#/components/offline/offline-replay'
import {
  CONNECTION_REQUIRED_REASONS,
  ConnectionRequired,
} from '#/components/offline/connection-required'
import {
  ActivityFeed,
  ContributorAvatars,
  FileList,
  Inspector,
  InspectorSection,
  LinkToPills,
  TagPills,
  EmptyHint,
} from '#/components/record'
import {
  Property,
  PropertyList,
  ScientificRecordLinker,
  StatusBadge,
} from '#/components/scientific'
import type { InspectorTab } from '#/components/record'
import { SignaturesTable } from '#/components/review/signatures-table'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { NativeSelect } from '#/components/v3/projects/select'
import { Inspector as InspectorPanel, Muted } from '#/components/v3/ui/layout'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import {
  fetchBlocksForRecord,
  fetchChangeEventsForRecord,
  fetchFoldersForProject,
  fetchLatestRevisionForRecord,
  fetchLinksForRecord,
  fetchProject,
  fetchRecord,
  fetchRevisionsForRecord,
  fetchRecordsForProject,
  fetchRevision,
  fetchRevisionSheetEvidence,
  formatDate,
  formatNotebookDateTime,
  formatRelativeTime,
  notebookDataClient,
  notebookQueryKeys,
  recordKindLabel,
  statusDomainForKind,
} from '#/lib/notebook-data'
import { hasCapability } from '#/lib/capability'
import type {
  NotebookBlock as NotebookBlockDomain,
  NotebookLink,
  NotebookRecord,
  RecordActivityItem,
  RevisionWire,
} from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { fetchSignaturesForRecord, signatureQueryKeys } from '#/lib/signatures'
import type { SignatureWire } from '#/lib/signatures'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  defaultPayloadFor,
  deleteBlock,
  duplicateBlock,
  insertBlock,
  insertSheetInstanceBlock,
  moveBlock,
  updateBlockPayload,
} from '#/lib/notebook-mutations'
import { acceptTextDraft } from '#/lib/assist-drafts'
import type { AssistTextDraftProposal } from '#/lib/assist-drafts'
import {
  fetchNotebookTemplate,
  fetchNotebookTemplateVersion,
  fetchNotebookTemplateVersions,
  notebookTemplateDataClient,
} from '#/lib/notebook-template-data'
import { notebookTemplateUpgradeAvailability } from '#/lib/reuse-upgrade'
import {
  fetchSheetInstances,
  sheetInstanceDataClient,
} from '#/lib/sheet-instance-data'
import { freezeChart, unfreezeChart } from '#/lib/chart-data'
import {
  freezeAnalysisBlock,
  unfreezeAnalysisBlock,
} from '#/lib/analysis-definitions-data'
import {
  sheetEvidenceFromEnvelope,
  sheetEvidenceFromRevisionRows,
} from '#/lib/sheet-evidence'
import { toCanonicalEnvelope } from '#/lib/review-workspace'
import { useRecentViewTracking } from '#/lib/recents'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { RelatedWorkPanel } from '#/components/related-work/related-work-panel'
import {
  PinnedRelationshipPanel,
  RelationshipPanel,
} from '#/components/knowledge/relationship-panel'
import { RecordLineageSection } from '#/components/knowledge/record-lineage-section'
import { validateBlock } from '#/lib/blocks'
import { pinProtocolReference } from '#/lib/protocol-materials'
import { attachFileToBlock, AttachFileError } from '#/lib/file-attach'
import {
  blocksFromRevision,
  fetchNotebookReviewContext,
  inspectorEvidenceFromRevision,
  notebookLifecycleLabel,
  notebookReviewActivity,
  notebookReviewRevisionId,
  recordFromRevisionSnapshot,
  updateExperimentMetadata,
} from '#/lib/notebook-experience'
import type {
  NotebookReviewActivity,
  NotebookReviewContext,
} from '#/lib/notebook-experience'
import {
  notebookOutline,
  notebookSectionSpans,
  sectionSpanHidesContent,
} from '#/lib/notebook-outline'
import { NotebookOutlinePanel } from '#/components/notebook/notebook-outline-panel'
import type { NotebookOutlineControls } from '#/components/notebook/notebook-outline-panel'
import { RecordPickerDialog } from '#/components/v3/record-picker/record-picker'
import type { PickerItem } from '#/components/v3/record-picker/record-picker-data'
import { toast } from '#/components/v3/ui/sonner'

/**
 * UI port (roadmap-4/ui-app3): the notebook renders inside app-3's shell, so
 * the old shell wrapper is replaced by a content column with the notebook
 * inspector beside it. Extra shell props callers pass are accepted and ignored.
 */
function RouteShell({
  children,
  inspector,
}: {
  children: ReactNode
  inspector?: ReactNode
  [key: string]: unknown
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {inspector ? (
        <InspectorPanel aria-label="Notebook" className="w-[340px] gap-0 p-0">
          <div className="flex flex-col gap-5 overflow-auto p-4">
            {inspector}
          </div>
        </InspectorPanel>
      ) : null}
    </div>
  )
}

/**
 * ELN-004: the deep-linkable canonical record route. Loads the record,
 * its ordered blocks and its outgoing links through route-aware queries,
 * renders the compact record header and a continuous central document
 * canvas, and pins the project context, status and ownership while the
 * document scrolls. Missing, archived and permission-restricted notebooks
 * each get an honest state. ELN-005 adds editing/insertion on this canvas.
 */

export const Route = createFileRoute('/records/$recordId/notebook')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: ExperimentNotebookRoute,
})

function historicalRevisionFromSearch(search: unknown): string | undefined {
  if (typeof search === 'string') {
    const value = new URLSearchParams(
      search.startsWith('?') ? search.slice(1) : search,
    ).get('revision')
    return value || undefined
  }
  if (search && typeof search === 'object' && 'revision' in search) {
    const value = (search as { revision?: unknown }).revision
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }
  return undefined
}

/**
 * EXP-04.4 — the notebook's selected Sheet cell, held at the route.
 *
 * The cell lives inside the Sheet workspace, so it is lifted here through the
 * `onCellSelectionChange` callback and adapted into inspector facts; the
 * inspector never reaches into the grid. Returns the stable callback the
 * canvas needs and the Properties facts (`null` when nothing is selected, or
 * when a historical view is pinned to frozen evidence).
 */
export function useNotebookCellFacts(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options
  const [selection, setSelection] = useState<SheetCellSelection | null>(null)
  const onCellSelectionChange = useCallback(
    (next: SheetCellSelection | null) => setSelection(next),
    [],
  )
  const cell = useMemo(
    () =>
      enabled && selection
        ? canonicalCellFacts({
            column: selection.column,
            value: selection.value,
            valueState: selection.valueState,
            rowLabel: `row ${selection.rowNumber}`,
            blockLabel: selection.sheetName,
          })
        : null,
    [enabled, selection],
  )
  return { cell, onCellSelectionChange }
}

function ExperimentNotebookRoute() {
  const { context } = Route.useRouteContext()
  const { recordId } = Route.useParams()
  // FIND-01: this page counts as a "view" for the Recent surface.
  useRecentViewTracking('record', recordId)
  // COLLAB-02: one record room per experiment page; null when the
  // deployment has collaboration disabled or there is no workspace.
  const collaborationEnabled = useCollaborationEnabled()
  const collaborationRoomId = collaborationEnabled
    ? safeBuildRoomId(context.workspace?.id, 'record', recordId)
    : null
  const historicalRevisionId = useRouterState({
    select: (state) => historicalRevisionFromSearch(state.location.search),
  })
  // EXP-04.4: historical views are pinned to frozen evidence, so they never
  // surface live selected-cell facts.
  const { cell: selectedCell, onCellSelectionChange } = useNotebookCellFacts({
    enabled: !historicalRevisionId,
  })

  const queryClient = useQueryClient()
  const [tab, setTab] = useState<NotebookTab>('notebook')

  const recordQuery = useQuery({
    queryKey: notebookQueryKeys.record(recordId),
    queryFn: () => fetchRecord(notebookDataClient, recordId),
    enabled: true,
  })
  const projectId = recordQuery.data?.projectId ?? null
  const projectQuery = useQuery({
    queryKey: notebookQueryKeys.project(projectId ?? 'none'),
    queryFn: () => fetchProject(notebookDataClient, projectId!),
    enabled: Boolean(projectId),
  })
  const projectFoldersQuery = useQuery({
    queryKey: notebookQueryKeys.folders(projectId ?? 'none'),
    queryFn: () => fetchFoldersForProject(notebookDataClient, projectId!),
    enabled: Boolean(projectId),
  })
  const projectRecordsQuery = useQuery({
    queryKey: notebookQueryKeys.records(projectId ?? 'none'),
    queryFn: () => fetchRecordsForProject(notebookDataClient, projectId!),
    enabled: Boolean(projectId),
  })
  const blocksQuery = useQuery({
    queryKey: notebookQueryKeys.blocks(recordId),
    queryFn: () => fetchBlocksForRecord(notebookDataClient, recordId),
    enabled: !historicalRevisionId,
  })
  const linksQuery = useQuery({
    queryKey: notebookQueryKeys.links(recordId),
    queryFn: () => fetchLinksForRecord(notebookDataClient, recordId),
    enabled: !historicalRevisionId,
  })
  const revisionsQuery = useQuery({
    queryKey: notebookQueryKeys.revisions(recordId),
    queryFn: () => fetchRevisionsForRecord(notebookDataClient, recordId),
    enabled: !historicalRevisionId,
  })
  const signaturesQuery = useQuery({
    queryKey: signatureQueryKeys.forRecord(recordId),
    queryFn: () => fetchSignaturesForRecord(notebookDataClient, recordId),
    enabled: !historicalRevisionId,
  })
  const activityQuery = useQuery({
    queryKey: notebookQueryKeys.activity(recordId),
    queryFn: () => fetchChangeEventsForRecord(notebookDataClient, recordId),
    enabled: !historicalRevisionId,
  })
  const historicalRevisionQuery = useQuery({
    queryKey: notebookQueryKeys.revision(historicalRevisionId ?? 'none'),
    queryFn: () => fetchRevision(notebookDataClient, historicalRevisionId!),
    enabled: Boolean(historicalRevisionId),
  })
  const reviewQuery = useQuery({
    queryKey: notebookQueryKeys.review(recordId),
    queryFn: () => fetchNotebookReviewContext(notebookDataClient, recordId),
    enabled: true,
  })
  // EXT-02: enabled-install contributions for this caller. The hook reads
  // the workspace installs through the public client surface and resolves
  // them through the single registry; loading/failure degrades to empty
  // points, never an error surface.
  const workspaceId = context.workspace?.id ?? null
  const workspaceRole = context.workspace?.role ?? null
  const extensionPoints = useExtensionPoints(
    notebookDataClient,
    workspaceId,
    workspaceRole,
  )
  const [samplePanelOpen, setSamplePanelOpen] = useState(false)
  const [extensionError, setExtensionError] = useState<string | null>(null)
  // EXT-02 invocation: the server-side assert gates execution (fail-closed);
  // the sample's read-only affordance then opens its data panel. The
  // returned audit fragment has no durable write to stamp here — writers
  // stamp it into their canonical payload channel.
  const runExtensionContribution = (
    contribution: ResolvedExtensionContribution,
  ) => {
    if (!workspaceId) return
    setExtensionError(null)
    void invokeExtensionContribution(
      notebookDataClient,
      workspaceId,
      contribution,
      async () => undefined,
    )
      .then(() => setSamplePanelOpen(true))
      .catch((cause: unknown) =>
        setExtensionError(describeExtensionInvocationError(cause)),
      )
  }

  // NOTE-04: the document-level unsaved-work signal lives at the route so the
  // submit dialog's readiness checklist reflects unsaved drafts. It mirrors
  // NotebookDocument's own signal; the document re-emits on record change.
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false)
  useEffect(() => {
    setHasUnsavedWork(false)
  }, [recordId, historicalRevisionId])
  // NOTE-02: section collapse is presentation state owned by the route so
  // the inspector's Outline tab and the canvas stay in sync. It resets when
  // the record or the viewed revision changes — never persisted.
  const [collapsedSections, setCollapsedSections] = useState<
    ReadonlySet<string>
  >(() => new Set<string>())
  useEffect(() => {
    setCollapsedSections(new Set())
  }, [recordId, historicalRevisionId])
  const toggleSection = (anchorId: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(anchorId)) next.delete(anchorId)
      else next.add(anchorId)
      return next
    })
  }
  // EXT-02 sample panel content, bound to the ordinary public contract
  // reads this route already performs (record/activity/links queries).
  // The panel receives only this loader — no data import of its own.
  // Hooks discipline: this callback is registered before every early return
  // below and reads query data with null-safety, so loading → loaded
  // transitions never change the hook count.
  const loadSampleSummary = useCallback(async () => {
    const base = recordQuery.data ?? null
    const summaryRecord =
      base && historicalRevisionId && historicalRevisionQuery.data
        ? recordFromRevisionSnapshot(
            base,
            historicalRevisionQuery.data.metadata_snapshot,
          )
        : base
    const summaryActivity = activityQuery.data ?? []
    const summaryLinks = linksQuery.data ?? []
    return {
      heading: summaryRecord?.title ?? '',
      subheading: summaryRecord
        ? `${recordKindLabel(summaryRecord.kind)} · ${summaryRecord.identifier}`
        : '',
      rows: [
        { label: 'Status', value: summaryRecord?.status ?? '' },
        {
          label: 'Updated',
          value: summaryRecord ? formatDate(summaryRecord.updatedAt) : '',
        },
        { label: 'Activity', value: `${summaryActivity.length} events` },
        { label: 'Links', value: `${summaryLinks.length} links` },
      ],
    }
  }, [
    recordQuery.data,
    historicalRevisionQuery.data,
    historicalRevisionId,
    activityQuery.data,
    linksQuery.data,
  ])

  const project = projectQuery.data ?? null
  const record = recordQuery.data ?? null
  const blocks = blocksQuery.data ?? []
  const links = linksQuery.data ?? []
  const revisions = revisionsQuery.data ?? []
  const activity = activityQuery.data ?? []

  const outlineControls = {
    collapsedSections,
    onToggleSection: toggleSection,
    onExpandAllSections: () => setCollapsedSections(new Set()),
    onCollapseAllSections: () => {
      // Only sections that actually own something collapsible can usefully
      // collapse: later blocks (block-granular) or content inside their own
      // rich_text block (same-block node range). An empty span would render
      // a meaningless placeholder.
      const spans = notebookSectionSpans(blocks)
      setCollapsedSections(
        new Set(
          notebookOutline(blocks)
            .filter((entry) => {
              const span = spans.get(entry.anchorId)
              return !!span && sectionSpanHidesContent(span)
            })
            .map((entry) => entry.anchorId),
        ),
      )
    },
  }

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: { name: context.user.name, email: context.user.email },
  }

  // Loading — record is the authoritative gate; project loads in parallel.
  if (recordQuery.isLoading) {
    return (
      <RouteShell
        context={shellContext}
        breadcrumbs={loadingBreadcrumbs(project)}
        inspector={
          <Inspector
            recordType="Experiment"
            title="Loading…"
            tabs={[]}
            state="skeleton"
          />
        }
      >
        <NotebookSkeleton />
      </RouteShell>
    )
  }

  // Error from the proxy (e.g. permission_denied) — distinct from a hidden row.
  if (recordQuery.error) {
    return (
      <RouteShell
        context={shellContext}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Projects', to: '/projects' },
          { label: 'Error' },
        ]}
      >
        <NotebookErrorState
          error={recordQuery.error}
          onRetry={() => recordQuery.refetch()}
        />
      </RouteShell>
    )
  }

  // RLS hid the row (missing or permission-restricted). One honest state.
  if (!record) {
    return (
      <RouteShell
        context={shellContext}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Projects', to: '/projects' },
          { label: 'Notebook unavailable' },
        ]}
      >
        <NotebookUnavailableState />
      </RouteShell>
    )
  }

  const isArchived = record.archivedAt !== null
  const review = reviewQuery.data ?? null
  const reviewActivity = notebookReviewActivity(review)

  if (historicalRevisionId && historicalRevisionQuery.isLoading) {
    return (
      <RouteShell
        context={shellContext}
        breadcrumbs={loadingBreadcrumbs(project)}
        inspector={
          <Inspector
            recordType="Experiment"
            title="Loading…"
            tabs={[]}
            state="skeleton"
          />
        }
      >
        <NotebookSkeleton />
      </RouteShell>
    )
  }

  if (
    historicalRevisionId &&
    (historicalRevisionQuery.error || !historicalRevisionQuery.data)
  ) {
    return (
      <RouteShell
        context={shellContext}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Projects', to: '/projects' },
          { label: 'Notebook unavailable' },
        ]}
      >
        <NotebookErrorState
          error={
            historicalRevisionQuery.error ??
            new DataClientError(
              'not_found',
              'That submitted revision could not be loaded.',
              404,
            )
          }
          onRetry={() => historicalRevisionQuery.refetch()}
        />
      </RouteShell>
    )
  }

  const displayRecord =
    historicalRevisionId && historicalRevisionQuery.data
      ? recordFromRevisionSnapshot(
          record,
          historicalRevisionQuery.data.metadata_snapshot,
        )
      : record
  const historicalEvidence = historicalRevisionQuery.data
    ? inspectorEvidenceFromRevision(historicalRevisionQuery.data)
    : undefined

  // EXT-02 sample panel loader is registered above the early returns;
  // extensionPanelTabs only references it here.
  // Historical revisions show pinned evidence only: live extension panels
  // stay hidden there so frozen state is never mixed with live reads.
  const extensionPanelTabs: InspectorTab[] = historicalRevisionId
    ? []
    : toExtensionPanelTabs(extensionPoints.panels, (panel) =>
        panel.extensionKey === SAMPLE_EXTENSION_KEY ? (
          <SampleExtensionPanel loadSummary={loadSampleSummary} />
        ) : null,
      )
  return (
    // EXP-05.2: one device-store scope for this user and record drives the
    // offline banner, the cell/block markers and the inspector list. It sits
    // inside the live-event provider (root), so the connection signal is the
    // one already in use.
    <OfflineEditsProvider
      store={deviceOfflineEditStore()}
      scope={{ userId: context.user.id, recordId: record.id }}
    >
      {/* COLLAB-02: the whole page (canvas + inspector) lives inside the
          record room; CollaborationRoom renders children unchanged until the
          provider is ready, so SSR markup is unaffected. */}
      <CollaborationRoom roomId={collaborationRoomId}>
        <RouteShell
          fullBleed
          context={shellContext}
          breadcrumbs={[
            { label: 'Home', to: '/' },
            { label: 'Projects', to: '/projects' },
            ...(project
              ? [{ label: project.title, to: `/projects/${project.id}` }]
              : []),
            { label: displayRecord.title },
          ]}
          projectTree={
            project && projectId ? (
              <ProjectNavigationTree
                project={project}
                folders={projectFoldersQuery.data ?? []}
                records={projectRecordsQuery.data ?? []}
                activeRecordId={record.id}
              />
            ) : undefined
          }
          inspectorCollapsible
          // EXT-02: palette commands resolve per caller; historical revisions
          // contribute nothing so frozen evidence stays free of live affordances.
          extensionCommands={
            historicalRevisionId ? [] : extensionPoints.commands
          }
          onExtensionCommand={runExtensionContribution}
          inspector={
            <NotebookInspector
              record={displayRecord}
              outlineControls={
                historicalRevisionId || record.lockedAt || record.archivedAt
                  ? undefined
                  : outlineControls
              }
              projectName={project?.title ?? null}
              ownerName={context.user.name}
              currentUserId={context.user.id}
              currentUserName={context.user.name}
              links={links}
              linksLoading={linksQuery.isLoading}
              blocks={blocks}
              activity={activity}
              activityLoading={activityQuery.isLoading}
              revisionEvidence={historicalEvidence}
              commentsRevisionId={historicalRevisionQuery.data?.id}
              canEditMetadata={
                !record.lockedAt && !record.archivedAt && !historicalRevisionId
              }
              reviewActivity={reviewActivity}
              isHistorical={Boolean(historicalRevisionId)}
              extensionPanels={extensionPanelTabs}
              /* EXP-04.4: the selected Sheet cell, lifted from the grid by
               `useNotebookCellFacts` — null until a cell is selected. */
              cell={selectedCell}
              /* EXP-05.2: the edits waiting to sync, from the device store. */
              unsynced={<UnsyncedChangesSection />}
            />
          }
        >
          <div className="flex-1 overflow-y-auto px-4 pb-16 md:px-6">
            {/* EXP-05.2: the offline banner, full-bleed over the column's
              padding, plus the offline-capabilities note below it. */}
            <OfflineStatusBanner
              className="-mx-4 md:-mx-6"
              capabilitiesClassName="my-3"
            />
            {/* EXP-05.3: when the connection returns, the drafts this device
              held are replayed through their canonical write paths. */}
            <OfflineReplayRunner
              store={deviceOfflineEditStore()}
              scope={{ userId: context.user.id, recordId: record.id }}
              className="my-3"
            />
            <NotebookPrintStyles />
            <StickyRecordHeader
              record={displayRecord}
              projectName={project?.title ?? null}
              projectId={projectId ?? undefined}
              currentUserId={context.user.id}
              currentUserName={context.user.name}
              workspaceId={context.workspace?.id}
              blocks={historicalEvidence?.blocks ?? blocks}
              historicalRevisionId={historicalRevisionId}
              review={review}
              hasUnsavedWork={hasUnsavedWork}
              liveLockedAt={record.lockedAt}
              liveLockedByRevisionId={record.lockedByRevisionId}
              extensionActions={
                historicalRevisionId ? [] : extensionPoints.objectActions
              }
              onExtensionAction={runExtensionContribution}
              extensionError={extensionError}
            />
            {!historicalRevisionId ? (
              <RecordNotebookTabs
                tab={tab}
                onTab={setTab}
                linkCount={links.length}
                revisionCount={revisions.length}
                signatureCount={signaturesQuery.data?.length ?? 0}
              />
            ) : null}
            {tab !== 'notebook' && !historicalRevisionId ? (
              <RecordNotebookPanel
                tab={tab}
                links={links}
                revisions={revisions}
                signatures={signaturesQuery.data ?? []}
                signatureError={signaturesQuery.isError}
                signaturesLoading={signaturesQuery.isPending}
              />
            ) : null}
            {/* EXT-02 sample panel: contributed object-actions and palette
              commands converge here. Rendered through the existing Dialog
              primitive with a labelled title for focus management. */}
            <Dialog open={samplePanelOpen} onOpenChange={setSamplePanelOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader title="Sample panel" />
                <SampleExtensionPanel loadSummary={loadSampleSummary} />
              </DialogContent>
            </Dialog>
            {historicalRevisionId ? (
              <HistoricalEvidenceBanner recordId={record.id} />
            ) : null}
            {isArchived ? <ArchivedBanner /> : null}
            {/* EXP-04.1: the template-version state of the working notebook.
              Frozen evidence and archived records are read-only, so an
              update banner would only dangle there. */}
            {!historicalRevisionId && !isArchived ? (
              <NotebookTemplateUpgradeBanner
                recordId={record.id}
                pinnedVersionId={record.sourceNotebookTemplateVersionId}
              />
            ) : null}
            {!historicalRevisionId && record.lockedAt ? (
              <LockedBanner
                record={record}
                onAmended={() => {
                  void queryClient.invalidateQueries({
                    queryKey: notebookQueryKeys.record(record.id),
                  })
                  void queryClient.invalidateQueries({
                    queryKey: notebookQueryKeys.blocks(record.id),
                  })
                }}
              />
            ) : null}
            {tab !== 'notebook' &&
            !historicalRevisionId ? null : historicalRevisionId ? (
              <HistoricalNotebookCanvas
                record={record}
                revisionId={historicalRevisionId}
                client={notebookDataClient}
              />
            ) : (
              <NotebookCanvas
                record={record}
                blocks={blocks}
                isLoading={blocksQuery.isLoading}
                error={blocksQuery.error}
                onRetry={() => blocksQuery.refetch()}
                client={notebookDataClient}
                queryClient={queryClient}
                collaborationWorkspaceId={context.workspace?.id}
                outline={outlineControls}
                collaborationRole={context.workspace?.role}
                // EXP-04.5: a workspace viewer reads the notebook view-only
                // instead of being handed the editable path for the server to
                // refuse. GOV-01: viewer has no record.create.
                viewOnly={
                  !hasCapability(context.workspace?.role, 'record.create')
                }
                onUnsavedWorkChange={setHasUnsavedWork}
                onCellSelectionChange={onCellSelectionChange}
              />
            )}
          </div>
        </RouteShell>
      </CollaborationRoom>
    </OfflineEditsProvider>
  )
}

function loadingBreadcrumbs(project: { id: string; title: string } | null) {
  return [
    { label: 'Home', to: '/' },
    { label: 'Projects', to: '/projects' },
    ...(project
      ? [
          {
            label: project.title,
            to: `/projects/${project.id}`,
          },
        ]
      : []),
    { label: 'Loading…' },
  ]
}

// ---------------------------------------------------------------------------
// Sticky record header. Stays visible while the document scrolls so the
// active project, status and ownership are always present.
// ---------------------------------------------------------------------------

export function StickyRecordHeader({
  record,
  projectName,
  projectId,
  currentUserId,
  currentUserName,
  workspaceId,
  blocks = [],
  historicalRevisionId,
  review = null,
  /** NOTE-04: document-level unsaved-work signal for the submit dialog. */
  hasUnsavedWork = false,
  /**
   * EXT-02: resolved object-actions for this record. Mounted as ghost
   * buttons in the header action row; invocation (with the server-side
   * assert) stays with the host via `onExtensionAction`.
   */
  extensionActions = [],
  onExtensionAction,
  extensionError = null,
  liveLockedAt,
  liveLockedByRevisionId,
}: {
  record: NotebookRecord
  projectName: string | null
  projectId?: string
  currentUserId?: string
  currentUserName?: string
  workspaceId?: string
  blocks?: NotebookBlockDomain[]
  historicalRevisionId?: string
  review?: NotebookReviewContext | null
  /** NOTE-04: NotebookDocument's unsaved-work signal. */
  hasUnsavedWork?: boolean
  extensionActions?: ResolvedExtensionContribution[]
  onExtensionAction?: (action: ResolvedExtensionContribution) => void
  /** Honest invoke-time failure from the last extension action, if any. */
  extensionError?: string | null
  /** Live lock fields when `record` is a historical snapshot overlay. */
  liveLockedAt?: string | null
  liveLockedByRevisionId?: string | null
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // EXP-05.2: submit and sign need a connection; the header disables them
  // and states why while the live-event stream is offline.
  const online = useIsOnline()
  const [submitOpen, setSubmitOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [signOpen, setSignOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [titleDraft, setTitleDraft] = useState(record.title)
  const lockedAt = liveLockedAt ?? record.lockedAt
  const lockedByRevisionId = liveLockedByRevisionId ?? record.lockedByRevisionId
  const reviewActivity = notebookReviewActivity(review)
  // NOTE-04: defensive for the submit dialog's readiness checklist — the
  // dialog only opens from a submittable header, but an active review that
  // appears between render and confirm is surfaced honestly.
  const activeReview = reviewActivity !== 'none'
  const lifecycle = notebookLifecycleLabel({
    lockedAt,
    archivedAt: record.archivedAt,
    reviewActivity,
    isHistorical: Boolean(historicalRevisionId),
  })
  const reviewRevisionId = notebookReviewRevisionId({
    lockedByRevisionId,
    review,
    historicalRevisionId,
  })
  const canSubmit =
    Boolean(projectId && currentUserId) &&
    !lockedAt &&
    !record.archivedAt &&
    !historicalRevisionId &&
    reviewActivity === 'none'
  const canEditTitle = !lockedAt && !record.archivedAt && !historicalRevisionId
  const canOpenReview = Boolean(reviewRevisionId)
  const canSign =
    Boolean(currentUserId && currentUserName) &&
    !historicalRevisionId &&
    !record.archivedAt &&
    (reviewActivity === 'approved' || Boolean(lockedAt && lockedByRevisionId))
  const evidenceRevisionId = reviewRevisionId

  const linkRecords = useMutation({
    mutationFn: (items: PickerItem[]) =>
      Promise.all(
        items.map((item) =>
          notebookDataClient.rpc('create_record_link', {
            p_source_record_id: record.id,
            p_target_kind: pickerRecordKind(item.kind),
            p_target_identifier: item.identifier,
            p_link_type: pickerLinkType(item.kind),
            p_target_record_id: item.id,
          }),
        ),
      ),
    onSuccess: (_result, items) => {
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.links(record.id),
      })
      toast(
        items.length === 1 ? 'Record linked' : `${items.length} records linked`,
      )
    },
    onError: () =>
      toast('Could not link', {
        description: 'The record may already be linked.',
      }),
  })

  const saveTitle = useMutation({
    mutationFn: (title: string) =>
      updateExperimentMetadata(notebookDataClient, {
        recordId: record.id,
        title,
        tags: record.tags,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.record(record.id),
      })
    },
  })

  useEffect(() => {
    setTitleDraft(record.title)
  }, [record.title])

  return (
    <div className="pb-3 pt-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {recordKindLabel(record.kind)}
        </span>
        <StatusBadge domain="experiment" status={record.status} />
        <span
          className={
            lifecycle === 'Submitted'
              ? 'inline-flex items-center gap-1 rounded-full border border-success bg-success/10 px-2 py-0.5 text-xs font-medium text-success-text'
              : lifecycle === 'In review'
                ? 'inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-text'
                : 'inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          {lifecycle === 'Submitted' || lifecycle === 'In review' ? (
            <Lock className="size-3" aria-hidden />
          ) : null}
          {lifecycle}
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {record.identifier}
        </span>
        <div
          className="ml-auto flex flex-wrap items-center gap-2"
          data-print-hide
        >
          {/* COLLAB-01: who else is in this record's room. Self-gates on
              room readiness, so SSR and pre-hydration output are stable. */}
          <PresenceStack />
          {/* FIND-02: deliberate pin for fast return; optimistic, never blocking. */}
          <FavouriteToggle kind="record" objectId={record.id} />
          <PrintNotebookButton className="h-8" />
          <ExportEvidenceButton revisionId={evidenceRevisionId} />
          {!historicalRevisionId && !lockedAt ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setLinkOpen(true)}
            >
              Link records…
            </Button>
          ) : null}
          {projectId && !historicalRevisionId ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setDuplicateOpen(true)}
            >
              Duplicate
            </Button>
          ) : null}
          {canSubmit ? (
            <ConnectionRequired
              online={online}
              reason={CONNECTION_REQUIRED_REASONS.submit}
            >
              {({ disabled, describedBy }) => (
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled}
                  aria-describedby={describedBy}
                  onClick={() => setSubmitOpen(true)}
                >
                  Submit
                </Button>
              )}
            </ConnectionRequired>
          ) : null}
          {canSign ? (
            <ConnectionRequired
              online={online}
              reason={CONNECTION_REQUIRED_REASONS.sign}
            >
              {({ disabled, describedBy }) => (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  aria-describedby={describedBy}
                  onClick={() => setSignOpen(true)}
                >
                  Sign
                </Button>
              )}
            </ConnectionRequired>
          ) : null}
          {canOpenReview && reviewRevisionId ? (
            <Link
              to="/review/$revisionId"
              params={{ revisionId: reviewRevisionId }}
              className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
            >
              Open review
            </Link>
          ) : null}
          {/* EXT-02: enabled extensions' object-actions. Ghost buttons match
              the surrounding utility controls; nothing renders while empty
              (the slot hides contributions the caller could never invoke). */}
          {onExtensionAction ? (
            <ExtensionObjectActions
              actions={extensionActions}
              onSelect={onExtensionAction}
            />
          ) : null}
        </div>
      </div>

      {canEditTitle ? (
        <>
          {/* The title is editable, so the document heading is kept for
              assistive tech and the page-level h1 contract. */}
          <h1 className="sr-only">{record.title}</h1>
          <Input
            className="mt-1.5 h-auto border-transparent bg-transparent px-0 font-display text-xl font-semibold leading-7 tracking-[-0.025em] shadow-none sm:text-2xl sm:leading-8"
            value={titleDraft}
            aria-label="Notebook title"
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => {
              const next = titleDraft.trim()
              if (!next || next === record.title) {
                setTitleDraft(record.title)
                return
              }
              saveTitle.mutate(next)
            }}
          />
        </>
      ) : (
        <h1 className="mt-1.5 font-display text-xl font-semibold leading-7 tracking-[-0.025em] text-foreground sm:text-2xl sm:leading-8">
          {record.title}
        </h1>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>
          Created{' '}
          <span className="text-foreground">
            {formatDate(record.createdAt)}
          </span>
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span>
          Updated{' '}
          <span className="text-foreground">
            {formatDate(record.updatedAt)}
          </span>
        </span>
        {projectName ? (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-foreground">{projectName}</span>
          </>
        ) : null}
      </div>
      {extensionError ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {extensionError}
        </p>
      ) : null}
      {canSubmit && submitOpen && projectId && currentUserId ? (
        <SubmitNotebookDialog
          open={submitOpen}
          onOpenChange={setSubmitOpen}
          recordId={record.id}
          projectId={projectId}
          reviewerUserId={currentUserId}
          workspaceId={workspaceId}
          record={record}
          blocks={blocks}
          hasUnsavedWork={hasUnsavedWork}
          archivedAt={record.archivedAt}
          lockedAt={liveLockedAt ?? record.lockedAt}
          activeReview={activeReview}
        />
      ) : null}
      {duplicateOpen && projectId && !historicalRevisionId ? (
        <DuplicateNotebookDialog
          open={duplicateOpen}
          onOpenChange={setDuplicateOpen}
          source={record}
          blocks={blocks}
          onDuplicated={(copy) => {
            void navigate({
              to: '/records/$recordId',
              params: { recordId: copy.id },
            })
          }}
        />
      ) : null}
      {linkOpen ? (
        <RecordPickerDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          title="Link records"
          allowed={['Sample', 'Material', 'Experiment']}
          multiple
          confirmLabel={(n) => `Link ${n}`}
          onPick={(items) => linkRecords.mutate(items)}
        />
      ) : null}
      {signOpen && reviewRevisionId && currentUserId && currentUserName ? (
        <SignNotebookDialog
          open={signOpen}
          onOpenChange={setSignOpen}
          revisionId={reviewRevisionId}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
        />
      ) : null}
    </div>
  )
}

function pickerRecordKind(kind: PickerItem['kind']): string {
  if (kind === 'Sample') return 'sample'
  if (kind === 'Material') return 'reagent'
  if (kind === 'Experiment') return 'experiment'
  return 'dataset'
}

function pickerLinkType(kind: PickerItem['kind']): string {
  if (kind === 'Sample') return 'sample'
  if (kind === 'Material') return 'reagent'
  return 'general'
}

type NotebookTab = 'notebook' | 'links' | 'revisions' | 'signatures'

const NOTEBOOK_TABS: { id: NotebookTab; label: string }[] = [
  { id: 'notebook', label: 'Notebook' },
  { id: 'links', label: 'Links' },
  { id: 'revisions', label: 'Revisions' },
  { id: 'signatures', label: 'Signatures' },
]

function RecordNotebookTabs({
  tab,
  onTab,
  linkCount,
  revisionCount,
  signatureCount,
}: {
  tab: NotebookTab
  onTab: (t: NotebookTab) => void
  linkCount: number
  revisionCount: number
  signatureCount: number
}) {
  const counts: Record<NotebookTab, number | undefined> = {
    notebook: undefined,
    links: linkCount,
    revisions: revisionCount,
    signatures: signatureCount,
  }
  return (
    <nav
      aria-label="Notebook sections"
      className="mt-3 flex gap-5 border-b border-border"
      data-print-hide
    >
      {NOTEBOOK_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-current={tab === t.id ? 'page' : undefined}
          onClick={() => onTab(t.id)}
          className={
            tab === t.id
              ? 'inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-link bg-transparent px-0.5 text-body font-medium text-fg'
              : 'inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted hover:text-fg'
          }
        >
          {t.label}
          {counts[t.id] != null ? (
            <span className="text-label font-normal text-fg-muted">
              {counts[t.id]}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  )
}

function RecordNotebookPanel({
  tab,
  links,
  revisions,
  signatures,
  signatureError,
  signaturesLoading,
}: {
  tab: Exclude<NotebookTab, 'notebook'>
  links: NotebookLink[]
  revisions: RevisionWire[]
  signatures: SignatureWire[]
  signatureError: boolean
  signaturesLoading: boolean
}) {
  const names = useUserNames(
    [
      ...links.map((l) => l.createdByUserId ?? ''),
      ...revisions.map((r) => r.created_by_user_id),
    ].filter(Boolean),
  )
  if (tab === 'links') {
    return (
      <section aria-label="Links" className="py-4">
        {links.length ? (
          <div className="overflow-hidden rounded-md border border-border">
            <Table aria-label="Linked records">
              <TableHeader>
                <TableRow>
                  <TableHead className="first:pl-3">Kind</TableHead>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Relation</TableHead>
                  <TableHead className="pr-3">Linked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="first:pl-3 capitalize">
                      {l.targetKind.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell className="mono">{l.targetIdentifier}</TableCell>
                    <TableCell className="text-fg-muted">
                      {l.linkType}
                    </TableCell>
                    <TableCell className="pr-3 text-fg-muted">
                      {l.createdAt.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Muted>Nothing is linked to this record yet.</Muted>
        )}
      </section>
    )
  }
  if (tab === 'signatures') {
    return (
      <SignaturesTable
        signatures={signatures}
        isLoading={signaturesLoading}
        isError={signatureError}
        revisionVersions={Object.fromEntries(
          revisions.map((revision) => [
            revision.id,
            revision.structure_version,
          ]),
        )}
      />
    )
  }
  const rows = revisions
  return (
    <section aria-label={tab} className="py-4">
      {rows.length ? (
        <div className="overflow-hidden rounded-md border border-border">
          <Table aria-label="Revisions">
            <TableHeader>
              <TableRow>
                <TableHead className="first:pl-3">Revision</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="pr-3">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="first:pl-3 mono">
                    v{r.structure_version}
                  </TableCell>
                  <TableCell className="text-fg-muted">{r.reason}</TableCell>
                  <TableCell>{names.userLabel(r.created_by_user_id)}</TableCell>
                  <TableCell className="pr-3 text-fg-muted">
                    {r.created_at.slice(0, 16).replace('T', ' ')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Muted>No revisions yet.</Muted>
      )}
    </section>
  )
}

export function HistoricalEvidenceBanner({ recordId }: { recordId: string }) {
  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
    >
      <span className="text-foreground">
        Viewing submitted evidence. The working Notebook is unchanged.
      </span>
      <Link
        to="/records/$recordId"
        params={{ recordId }}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        Return to working Notebook
      </Link>
    </div>
  )
}

export function ArchivedBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
    >
      <Archive className="size-3.5 text-warning" aria-hidden="true" />
      <span className="text-foreground">
        This notebook is archived. It is read-only until restored.
      </span>
    </div>
  )
}

/**
 * LockedBanner — SIGN-002. Shown when an approve-for-record signature has
 * locked the record. The scientific evidence is frozen; editing resumes only
 * after an amendment (api.create_amendment) unlocks the record.
 */
export function LockedBanner({
  record,
  onAmended,
}: {
  record: {
    id?: string
    lockedAt: string | null
    lockedByRevisionId?: string | null
  }
  onAmended?: () => void
}) {
  const [amendOpen, setAmendOpen] = useState(false)
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border border-success bg-success/10 px-3 py-2 text-xs"
    >
      <Lock className="size-3.5 text-success-text" aria-hidden="true" />
      <span className="text-foreground">
        This Notebook is submitted
        {record.lockedAt
          ? ` since ${formatNotebookDateTime(record.lockedAt)}`
          : ''}
        . Scientific evidence is frozen — start an amendment to edit again.
      </span>
      {record.id && onAmended ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="ml-auto h-7"
            data-print-hide
            onClick={() => setAmendOpen(true)}
          >
            Amend
          </Button>
          <AmendNotebookDialog
            open={amendOpen}
            onOpenChange={setAmendOpen}
            recordId={record.id}
            onAmended={onAmended}
          />
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Central document canvas.
// ---------------------------------------------------------------------------

export function NotebookCanvas({
  record,
  blocks,
  isLoading,
  error,
  onRetry,
  client,
  queryClient,
  collaborationWorkspaceId,
  collaborationRole = 'viewer',
  outline,
  viewOnly = false,
  onCellSelectionChange,
}: {
  record: NotebookRecord
  blocks: NotebookBlockDomain[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  /**
   * Required for the editable path. Omit (or pass undefined) to render the
   * notebook read-only — used by presentational tests that do not mount a
   * QueryClient provider and by any caller that only needs the frame.
   */
  client?: DataClient
  queryClient?: QueryClient
  /** COLLAB-02: active workspace id for block comment anchors. */
  collaborationWorkspaceId?: string
  /** COLLAB-02: workspace role hint for the block comment composer. */
  collaborationRole?: string
  /** NOTE-02: shared section-collapse controls (route-owned presentation state). */
  outline?: NotebookOutlineControls
  /**
   * EXP-04.5: the reader has no record.create capability, so the notebook is a
   * view-only surface — read-only with the viewer's actions — rather than the
   * editable path that only the server would refuse.
   */
  viewOnly?: boolean
  /**
   * EXP-04.4: the selected Sheet cell, lifted to the route so the inspector
   * can describe it. The view-only path publishes too — a viewer may select a
   * cell to read its properties — while locked and historical notebooks mount
   * frozen evidence instead of a grid, so they publish nothing.
   */
  onCellSelectionChange?: (selection: SheetCellSelection | null) => void
  /** NOTE-04: notified with NotebookDocument's unsaved-work signal. */
  onUnsavedWorkChange?: (hasUnsavedWork: boolean) => void
}) {
  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border bg-card"
          />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p role="alert" className="text-sm text-destructive">
          Could not load the notebook document.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-sm font-medium"
        >
          Try again
        </button>
      </div>
    )
  }
  if (
    record.archivedAt ||
    record.lockedAt ||
    !client ||
    !queryClient ||
    viewOnly
  ) {
    // Archived and locked notebooks, plus provider-less callers, render
    // read-only through the same document component so the visual frame and
    // anchors match the editable state. SIGN-002: a locked record's
    // scientific evidence is frozen until an amendment unlocks it.
    if (blocks.length === 0) return <EmptyNotebook record={record} />
    if ((record.archivedAt || record.lockedAt) && client && queryClient) {
      return (
        <LockedNotebook
          record={record}
          blocks={blocks}
          client={client}
          collaborationWorkspaceId={collaborationWorkspaceId}
          collaborationRole={collaborationRole}
          onCellSelectionChange={onCellSelectionChange}
        />
      )
    }
    return (
      <NotebookDocument
        record={record}
        blocks={blocks}
        readOnly
        collaborationWorkspaceId={collaborationWorkspaceId}
        onSaveBlock={async () => ({ ok: true })}
        onInsertBlock={async () => undefined}
        onDuplicateBlock={async () => undefined}
        onDeleteBlock={async () => undefined}
        collaborationRole={collaborationRole}
        onCellSelectionChange={onCellSelectionChange}
      />
    )
  }
  return (
    <EditableNotebook
      record={record}
      blocks={blocks}
      client={client}
      queryClient={queryClient}
      collaborationWorkspaceId={collaborationWorkspaceId}
      collaborationRole={collaborationRole}
      outline={outline}
      onCellSelectionChange={onCellSelectionChange}
    />
  )
}

// ---------------------------------------------------------------------------
// Editable notebook — wires the NotebookDocument callbacks to TanStack Query
// mutations. Each mutation performs its RPC, reconciles the canonical
// (id, order, version) shape returned by the RPC into the blocks query cache,
// and surfaces stale_version as an inline error so the user can retry. The
// record's structure_version is updated in the record query cache so the next
// mutation sends the right expected version.
// ---------------------------------------------------------------------------

function EditableNotebook({
  record,
  blocks,
  client,
  queryClient,
  collaborationWorkspaceId,
  collaborationRole = 'viewer',
  outline,
  onUnsavedWorkChange,
  onCellSelectionChange,
}: {
  record: NotebookRecord
  blocks: NotebookBlockDomain[]
  client: DataClient
  queryClient: QueryClient
  /** COLLAB-02: active workspace id for block comment anchors. */
  collaborationWorkspaceId?: string
  /** COLLAB-02: workspace role hint for the block comment composer. */
  collaborationRole?: string
  /** NOTE-02: shared section-collapse controls. */
  outline?: NotebookOutlineControls
  /** NOTE-04: notified with NotebookDocument's unsaved-work signal. */
  onUnsavedWorkChange?: (hasUnsavedWork: boolean) => void
  /** EXP-04.4: the selected Sheet cell, lifted to the route's inspector. */
  onCellSelectionChange?: (selection: SheetCellSelection | null) => void
}) {
  const blocksKey = notebookQueryKeys.blocks(record.id)
  const recordKey = notebookQueryKeys.record(record.id)
  const liveStatus = useLiveStatus()
  const offline = liveStatus.status === 'offline'
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [embedAfterBlockId, setEmbedAfterBlockId] = useState<
    string | undefined
  >()
  const [embedInstanceId, setEmbedInstanceId] = useState('')
  const embedCandidates = useQuery({
    queryKey: ['sheet-instances', 'embed-picker', record.id],
    queryFn: () => fetchSheetInstances(sheetInstanceDataClient),
    enabled: embedOpen,
  })
  const blocker = useBlocker({
    shouldBlockFn: () => hasUnsavedWork,
    enableBeforeUnload: false,
    withResolver: true,
  })

  const proceedRef = useRef<(() => void) | null>(null)
  const resetRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (blocker.status === 'blocked') {
      proceedRef.current = blocker.proceed
      resetRef.current = blocker.reset
    } else {
      proceedRef.current = null
      resetRef.current = null
    }
  }, [blocker])

  function setRecordStructureVersion(next: number) {
    queryClient.setQueryData<NotebookRecord | null>(recordKey, (prev) =>
      prev ? { ...prev, structureVersion: next } : prev,
    )
  }

  function upsertBlock(block: NotebookBlockDomain) {
    queryClient.setQueryData<NotebookBlockDomain[]>(blocksKey, (prev) => {
      if (!prev) return [block]
      const without = prev.filter((b) => b.id !== block.id)
      const next = [...without, block]
      next.sort((a, b) => a.order - b.order)
      return next
    })
  }

  function removeBlock(blockId: string) {
    queryClient.setQueryData<NotebookBlockDomain[]>(blocksKey, (prev) =>
      prev ? prev.filter((b) => b.id !== blockId) : prev,
    )
  }

  /**
   * Reconcile the canonical (id, order) list returned by move_block /
   * delete_block into the blocks cache: keep the known block objects but
   * drop any ids no longer present, apply the new order values, and sort.
   * Unknown ids (rare; only on a concurrent external insert we have not yet
   * fetched) are filtered out — the subsequent invalidation refetches them.
   */
  function reorderBlocks(order: Array<{ id: string; order: number }>) {
    queryClient.setQueryData<NotebookBlockDomain[]>(blocksKey, (prev) => {
      if (!prev) return prev
      const byId = new Map(prev.map((b) => [b.id, b]))
      const next: NotebookBlockDomain[] = []
      for (const entry of order) {
        const block = byId.get(entry.id)
        if (!block) continue
        next.push({ ...block, order: entry.order })
      }
      next.sort((a, b) => a.order - b.order)
      return next
    })
  }

  async function refreshStructure() {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: blocksKey }),
      queryClient.refetchQueries({ queryKey: recordKey }),
    ])
  }

  // --- Save (update payload) ---------------------------------------------
  // --- Insert ------------------------------------------------------------
  const insertMutation = useMutation({
    mutationFn: async ({
      type,
      afterBlockId,
      options,
    }: {
      type: string
      afterBlockId?: string
      options?: { datasetSchemaId?: string; instanceId?: string }
    }) => {
      const current = queryClient.getQueryData<NotebookRecord | null>(recordKey)
      if (type === 'sheet' || type === 'sheet_shared') {
        return insertSheetInstanceBlock(client, {
          recordId: record.id,
          afterBlockId,
          expectedStructureVersion:
            current?.structureVersion ?? record.structureVersion,
          instanceId: options?.instanceId,
        })
      }
      const payload = defaultPayloadFor(type)
      return insertBlock(client, {
        recordId: record.id,
        type,
        payload,
        afterBlockId,
        expectedStructureVersion:
          current?.structureVersion ?? record.structureVersion,
      })
    },
    onSuccess: (res) => {
      upsertBlock(res.block)
      setRecordStructureVersion(res.structureVersion)
    },
    onError: async (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        await refreshStructure()
      }
    },
  })
  // --- ASSIST-02 accepted text draft (ordinary insert_block, same cache
  // reconciliation as a manual insert) ------------------------------------
  const draftAcceptMutation = useMutation({
    mutationFn: async (proposal: AssistTextDraftProposal) => {
      const current = queryClient.getQueryData<NotebookRecord | null>(recordKey)
      return acceptTextDraft(client, {
        recordId: record.id,
        proposal,
        expectedStructureVersion:
          current?.structureVersion ?? record.structureVersion,
      })
    },
    onSuccess: (res) => {
      upsertBlock(res.block)
      setRecordStructureVersion(res.structureVersion)
    },
    onError: async (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        await refreshStructure()
      }
    },
  })

  // --- Duplicate ---------------------------------------------------------
  const duplicateMutation = useMutation({
    mutationFn: async (block: NotebookBlockDomain) => {
      const current = queryClient.getQueryData<NotebookRecord | null>(recordKey)
      return duplicateBlock(client, {
        block,
        expectedStructureVersion:
          current?.structureVersion ?? record.structureVersion,
      })
    },
    onSuccess: (res) => {
      upsertBlock(res.block)
      setRecordStructureVersion(res.structureVersion)
    },
    onError: async (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        await refreshStructure()
      }
    },
  })

  // --- Delete ------------------------------------------------------------
  const deleteMutation = useMutation({
    mutationFn: async (block: NotebookBlockDomain) => {
      const current = queryClient.getQueryData<NotebookRecord | null>(recordKey)
      return deleteBlock(client, {
        blockId: block.id,
        expectedStructureVersion:
          current?.structureVersion ?? record.structureVersion,
      })
    },
    onSuccess: (res, vars) => {
      removeBlock(vars.id)
      setRecordStructureVersion(res.structureVersion)
    },
    onError: async (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        await refreshStructure()
      }
    },
  })

  // Undo restores the deleted payload at its original neighbours in one
  // server-authoritative operation: insert_block accepts both anchors, so
  // even the first-block case (after=null, before=neighbour) resolves
  // atomically on the server. There is no second corrective move to fail —
  // either the block is restored at its original position (and the RPC's
  // (id, order) list reconciles the cache) or nothing was written.
  const undoDeleteMutation = useMutation({
    mutationFn: async ({
      type,
      payload,
      destination,
    }: {
      type: string
      payload: Record<string, unknown>
      destination: {
        afterBlockId: string | null
        beforeBlockId: string | null
      }
    }) => {
      const current = queryClient.getQueryData<NotebookRecord | null>(recordKey)
      // NOTE-01 atomic undo: insert_block positions against both anchors and
      // returns the full (id, order) list (migration 0154), so the cache
      // reconciles from the insert alone — no second move. The historical
      // move-after-insert is deleted, not kept as a fallback: a missing
      // order list already degrades to upsert-only like every other insert.
      const inserted = await insertBlock(client, {
        recordId: record.id,
        type,
        payload,
        afterBlockId: destination.afterBlockId ?? undefined,
        beforeBlockId: destination.beforeBlockId ?? undefined,
        expectedStructureVersion:
          current?.structureVersion ?? record.structureVersion,
      })
      return { ...inserted, order: inserted.order ?? null }
    },
    onSuccess: (res) => {
      upsertBlock(res.block)
      if (res.order) reorderBlocks(res.order)
      setRecordStructureVersion(res.structureVersion)
    },
    onError: async (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        await refreshStructure()
      }
    },
  })

  // --- Move (ELN-006) ----------------------------------------------------
  // Atomically reorder a block via fractional indexing. The current
  // structure_version is read from the record cache (not the stale `record`
  // prop) so back-to-back moves send the latest version. On success the
  // canonical (id, order) list returned by the RPC replaces the blocks
  // cache and the structure_version bumps. On a stale-version rejection we
  // refetch both caches so the next move targets the right baseline; the
  // thrown error propagates to NotebookDocument, which rolls back the
  // optimistic ordering it applied.
  const moveMutation = useMutation({
    mutationFn: async ({
      block,
      destination,
    }: {
      block: NotebookBlockDomain
      destination: { afterBlockId: string | null; beforeBlockId: string | null }
    }) => {
      const current = queryClient.getQueryData<NotebookRecord | null>(recordKey)
      return moveBlock(client, {
        blockId: block.id,
        afterBlockId: destination.afterBlockId,
        beforeBlockId: destination.beforeBlockId,
        expectedStructureVersion:
          current?.structureVersion ?? record.structureVersion,
      })
    },
    onSuccess: (res) => {
      reorderBlocks(res.order)
      setRecordStructureVersion(res.structureVersion)
    },
    onError: async (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        await refreshStructure()
      }
    },
  })

  async function handleSave(
    block: NotebookBlockDomain,
    payload: Record<string, unknown>,
  ): Promise<SaveResult<Record<string, unknown>>> {
    // ELN-007 — read the latest block version from the cache at call time
    // so an autosave firing after a live-event version bump targets the
    // right version. The client identity is attached automatically by
    // `createDataClient` (LIVE-003); no explicit argument is needed here.
    const cached =
      queryClient.getQueryData<NotebookBlockDomain[]>(blocksKey) ?? blocks
    const current = cached.find((b) => b.id === block.id) ?? block
    const result = validateBlock({
      type: current.type,
      payload,
      payloadSchemaVersion: current.payloadSchemaVersion,
    })
    if (!result.ok) {
      return {
        ok: false,
        kind: 'validation',
        message: result.errors.map((e) => e.message).join('; '),
      }
    }
    try {
      const updated = await updateBlockPayload(client, {
        blockId: current.id,
        payload,
        expectedVersion: current.version,
        payloadSchemaVersion: current.payloadSchemaVersion,
      })
      upsertBlock({ ...current, ...updated })
      return { ok: true }
    } catch (err) {
      if (err instanceof DataClientError && err.code === 'stale_version') {
        // Refetch the canonical block so we can offer the server value as
        // the conflict alternative; never silently overwrite the draft.
        await queryClient.refetchQueries({ queryKey: blocksKey })
        const refreshed =
          queryClient.getQueryData<NotebookBlockDomain[]>(blocksKey) ?? []
        const serverBlock = refreshed.find((b) => b.id === block.id)
        return {
          ok: false,
          kind: 'conflict',
          message:
            'This block was changed elsewhere. Your edits are preserved below.',
          serverValue: serverBlock?.payload ?? block.payload,
        }
      }
      if (err instanceof DataClientError && err.code === 'validation_error') {
        return { ok: false, kind: 'validation', message: err.message }
      }
      return {
        ok: false,
        kind: 'transient',
        message:
          err instanceof Error ? err.message : 'Could not save the block.',
      }
    }
  }
  // ASSIST-02: insert an accepted text draft; the document owns the
  // preview, this route owns the canonical mutation + cache update.
  async function handleAcceptDraft(proposal: AssistTextDraftProposal) {
    await draftAcceptMutation.mutateAsync(proposal)
  }

  async function handleInsert(
    type: string,
    afterBlockId?: string,
    options?: { datasetSchemaId?: string; instanceId?: string },
  ) {
    if (type === 'sheet_shared' && !options?.instanceId) {
      setEmbedAfterBlockId(afterBlockId)
      setEmbedInstanceId('')
      setEmbedOpen(true)
      return undefined
    }
    const res = await insertMutation.mutateAsync({
      type,
      afterBlockId,
      options,
    })
    return res.block.id
  }

  async function handlePinProtocol(
    block: NotebookBlockDomain,
    protocolRecordId: string,
  ) {
    const currentRecord =
      queryClient.getQueryData<NotebookRecord | null>(recordKey) ?? record
    const currentBlocks =
      queryClient.getQueryData<NotebookBlockDomain[]>(blocksKey) ?? blocks
    const currentBlock =
      currentBlocks.find((item) => item.id === block.id) ?? block
    await pinProtocolReference(client, {
      blockId: currentBlock.id,
      protocolRecordId,
      expectedBlockVersion: currentBlock.version,
      expectedStructureVersion: currentRecord.structureVersion,
    })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: blocksKey }),
      queryClient.invalidateQueries({ queryKey: recordKey }),
      queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.links(record.id),
      }),
    ])
  }

  async function handleAttachFile(block: NotebookBlockDomain, file: File) {
    const currentBlocks =
      queryClient.getQueryData<NotebookBlockDomain[]>(blocksKey) ?? blocks
    const currentBlock =
      currentBlocks.find((item) => item.id === block.id) ?? block
    try {
      await attachFileToBlock(client, {
        blockId: currentBlock.id,
        expectedBlockVersion: currentBlock.version,
        projectId: record.projectId ?? '',
        file,
      })
    } catch (cause) {
      // Re-throw AttachFileError verbatim so the editor shows its message;
      // wrap anything else for a comprehensible failure.
      if (cause instanceof AttachFileError) throw cause
      throw new AttachFileError(
        cause instanceof Error ? cause.message : 'Could not attach the file.',
        'server_error',
      )
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: blocksKey }),
      queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.links(record.id),
      }),
    ])
  }

  // SCI-004 — freeze a chart into an immutable snapshot through the
  // transactional SECURITY DEFINER RPC. Reads the latest block version from
  // the cache so an action after a live-event version bump targets the
  // right version; invalidates the blocks cache so the frozen payload and
  // new version reconcile. Unfreeze is the inverse (rejected by the DB once
  // the chart is bound to a submitted revision).
  async function handleFreezeChart(block: NotebookBlockDomain) {
    const currentBlocks =
      queryClient.getQueryData<NotebookBlockDomain[]>(blocksKey) ?? blocks
    const currentBlock =
      currentBlocks.find((item) => item.id === block.id) ?? block
    await freezeChart(client, {
      blockId: currentBlock.id,
      expectedVersion: currentBlock.version,
    })
    await queryClient.invalidateQueries({ queryKey: blocksKey })
  }

  async function handleUnfreezeChart(block: NotebookBlockDomain) {
    const currentBlocks =
      queryClient.getQueryData<NotebookBlockDomain[]>(blocksKey) ?? blocks
    const currentBlock =
      currentBlocks.find((item) => item.id === block.id) ?? block
    await unfreezeChart(client, {
      blockId: currentBlock.id,
      expectedVersion: currentBlock.version,
    })
    await queryClient.invalidateQueries({ queryKey: blocksKey })
  }

  async function handleFreezeAnalysis(block: NotebookBlockDomain) {
    const currentBlocks =
      queryClient.getQueryData<NotebookBlockDomain[]>(blocksKey) ?? blocks
    const currentBlock =
      currentBlocks.find((item) => item.id === block.id) ?? block
    await freezeAnalysisBlock(client, {
      blockId: currentBlock.id,
      expectedVersion: currentBlock.version,
    })
    await queryClient.invalidateQueries({ queryKey: blocksKey })
  }

  async function handleUnfreezeAnalysis(block: NotebookBlockDomain) {
    const currentBlocks =
      queryClient.getQueryData<NotebookBlockDomain[]>(blocksKey) ?? blocks
    const currentBlock =
      currentBlocks.find((item) => item.id === block.id) ?? block
    await unfreezeAnalysisBlock(client, {
      blockId: currentBlock.id,
      expectedVersion: currentBlock.version,
    })
    await queryClient.invalidateQueries({ queryKey: blocksKey })
  }

  async function handleDuplicate(block: NotebookBlockDomain) {
    const duplicated = await duplicateMutation.mutateAsync(block)
    return duplicated.block.id
  }

  async function handleDelete(block: NotebookBlockDomain) {
    await deleteMutation.mutateAsync(block)
  }

  /**
   * Replace a block with a new type (slash command). Inserts the new block
   * after the current one, then deletes the current one — both reading the
   * latest structure_version from the query cache so back-to-back
   * operations succeed. Returns the new block's id so the caller can select
   * and focus it.
   */
  async function handleReplaceBlock(
    block: NotebookBlockDomain,
    type: string,
    options?: { datasetSchemaId?: string },
  ): Promise<string | undefined> {
    const newId = await handleInsert(type, block.id, options)
    await deleteMutation.mutateAsync(block)
    return newId
  }

  async function handleUndoDelete(
    type: string,
    payload: Record<string, unknown>,
    destination: {
      afterBlockId: string | null
      beforeBlockId: string | null
    },
  ) {
    const restored = await undoDeleteMutation.mutateAsync({
      type,
      payload,
      destination,
    })
    return { id: restored.block.id, moved: true }
  }

  async function handleMove(
    block: NotebookBlockDomain,
    destination: { afterBlockId: string | null; beforeBlockId: string | null },
  ) {
    await moveMutation.mutateAsync({ block, destination })
  }

  return (
    <>
      <NotebookDocument
        record={record}
        blocks={blocks}
        onSaveBlock={handleSave}
        offline={offline}
        onUnsavedWorkChange={(value) => {
          setHasUnsavedWork(value)
          onUnsavedWorkChange?.(value)
        }}
        onInsertBlock={handleInsert}
        onAcceptDraft={handleAcceptDraft}
        onPinProtocol={handlePinProtocol}
        onAttachFile={handleAttachFile}
        onFreezeChart={handleFreezeChart}
        onUnfreezeChart={handleUnfreezeChart}
        onFreezeAnalysis={handleFreezeAnalysis}
        onUnfreezeAnalysis={handleUnfreezeAnalysis}
        onDuplicateBlock={handleDuplicate}
        onDeleteBlock={handleDelete}
        onUndoDelete={handleUndoDelete}
        onMoveBlock={handleMove}
        onReplaceBlock={handleReplaceBlock}
        collaborationWorkspaceId={collaborationWorkspaceId}
        collaborationRole={collaborationRole}
        collapsedSections={outline?.collapsedSections}
        onToggleSection={outline?.onToggleSection}
        onCellSelectionChange={onCellSelectionChange}
      />
      <Dialog open={embedOpen} onOpenChange={setEmbedOpen}>
        <DialogContent>
          <DialogHeader
            title="Link an existing Sheet"
            description="This Notebook will show the same live Sheet. Editing it here changes it everywhere it is used."
          />
          <Field label="Sheet">
            <NativeSelect
              id="link-sheet-instance"
              value={embedInstanceId}
              onChange={(event) => setEmbedInstanceId(event.target.value)}
            >
              <option value="">Select a Sheet…</option>
              {(embedCandidates.data ?? [])
                .filter((instance) => instance.lifecycle === 'active')
                .map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name}
                    {instance.sourceDefinitionVersionId
                      ? ' (from a Sheet Definition)'
                      : ' (ad hoc Sheet)'}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEmbedOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!embedInstanceId || insertMutation.isPending}
              onClick={() => {
                void handleInsert('sheet_shared', embedAfterBlockId, {
                  instanceId: embedInstanceId,
                }).then(() => setEmbedOpen(false))
              }}
            >
              Link Sheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function HistoricalNotebookCanvas({
  record,
  revisionId,
  client,
}: {
  record: NotebookRecord
  revisionId: string
  client: DataClient
}) {
  const revision = useQuery({
    queryKey: notebookQueryKeys.revision(revisionId),
    queryFn: () => fetchRevision(client, revisionId),
  })
  const storedEvidence = useQuery({
    queryKey: ['revision-sheet-evidence-rows', revisionId],
    queryFn: () => fetchRevisionSheetEvidence(client, revisionId),
  })
  if (revision.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border bg-card"
          />
        ))}
      </div>
    )
  }
  if (revision.error || !revision.data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p role="alert" className="text-sm text-destructive">
          Could not load the submitted Notebook.
        </p>
      </div>
    )
  }
  const frozenSheetEvidence = storedEvidence.data?.length
    ? sheetEvidenceFromRevisionRows(storedEvidence.data)
    : sheetEvidenceFromEnvelope(toCanonicalEnvelope(revision.data))
  return (
    <NotebookDocument
      record={record}
      blocks={blocksFromRevision(revision.data)}
      readOnly
      frozenSheetEvidence={frozenSheetEvidence}
      onSaveBlock={async () => ({ ok: true })}
      onInsertBlock={async () => undefined}
      onDuplicateBlock={async () => undefined}
      onDeleteBlock={async () => undefined}
    />
  )
}

function LockedNotebook({
  record,
  blocks,
  client,
  collaborationWorkspaceId,
  collaborationRole = 'viewer',
  onCellSelectionChange,
}: {
  record: NotebookRecord
  blocks: NotebookBlockDomain[]
  client: DataClient
  /** COLLAB-02: active workspace id for block comment anchors. */
  collaborationWorkspaceId?: string
  /** COLLAB-02: workspace role hint for the block comment composer. */
  collaborationRole?: string
  /** EXP-04.4: the selected Sheet cell, lifted to the route's inspector. */
  onCellSelectionChange?: (selection: SheetCellSelection | null) => void
}) {
  const revision = useQuery({
    queryKey: ['revision-sheet-evidence', record.id, record.lockedByRevisionId],
    queryFn: () =>
      record.lockedByRevisionId
        ? fetchRevision(client, record.lockedByRevisionId)
        : fetchLatestRevisionForRecord(client, record.id),
  })
  const revisionId = revision.data?.id ?? record.lockedByRevisionId
  const storedEvidence = useQuery({
    queryKey: ['revision-sheet-evidence-rows', revisionId],
    enabled: Boolean(revisionId),
    queryFn: () => fetchRevisionSheetEvidence(client, revisionId!),
  })
  const frozenSheetEvidence = storedEvidence.data?.length
    ? sheetEvidenceFromRevisionRows(storedEvidence.data)
    : sheetEvidenceFromEnvelope(
        revision.data ? toCanonicalEnvelope(revision.data) : null,
      )
  return (
    <NotebookDocument
      record={record}
      blocks={blocks}
      readOnly
      frozenSheetEvidence={frozenSheetEvidence}
      onSaveBlock={async () => ({ ok: true })}
      onInsertBlock={async () => undefined}
      onDuplicateBlock={async () => undefined}
      onDeleteBlock={async () => undefined}
      collaborationWorkspaceId={collaborationWorkspaceId}
      collaborationRole={collaborationRole}
      onCellSelectionChange={onCellSelectionChange}
    />
  )
}

export function EmptyNotebook({ record }: { record: NotebookRecord }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
      <h2 className="text-base font-semibold text-foreground">
        This notebook is ready for its first block
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {recordKindLabel(record.kind)}{' '}
        <span className="font-mono">{record.identifier}</span> has no content
        yet. Start with a text block for the objective — section headings and
        prose stay together so the team can read the same document structure.
      </p>
    </div>
  )
}

export function NotebookSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-16 animate-pulse rounded-lg border bg-card" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
      ))}
    </div>
  )
}

export function NotebookErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const message =
    error instanceof DataClientError && error.code === 'permission_denied'
      ? 'You do not have access to this notebook.'
      : 'Could not load the notebook.'
  return (
    <div className="space-y-2">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium"
      >
        Try again
      </button>
    </div>
  )
}

export function NotebookUnavailableState() {
  return (
    <div className="max-w-md space-y-3 rounded-md border border-border bg-muted/30 p-6">
      <div className="flex items-center gap-2 text-muted-foreground">
        <FileWarning className="size-4" aria-hidden="true" />
        <h2 className="text-base font-semibold text-foreground">
          Notebook unavailable
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        The notebook may have been deleted, or you may not have access to it. If
        you reached it from a link, ask the record owner to confirm your
        workspace membership.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/projects"
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium no-underline"
        >
          All projects
        </Link>
      </div>
    </div>
  )
}

export function PermissionRestrictedState() {
  return (
    <div className="max-w-md space-y-3 rounded-md border border-border bg-muted/30 p-6">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Lock className="size-4" aria-hidden="true" />
        <h2 className="text-base font-semibold text-foreground">
          Permission restricted
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        You do not have access to view this notebook.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inspector. Route-owned so it composes against the live record/links data
// or, under `?revision=`, snapshot evidence only.
// Inspector tabs: Properties, History, and (live only) Activity.
// ---------------------------------------------------------------------------

const OPERATION_LABELS: Record<string, string> = {
  create: 'created',
  update: 'updated',
  move: 'moved',
  delete: 'deleted',
  archive: 'archived',
  restore: 'restored',
  link: 'linked',
  unlink: 'unlinked',
  quarantine: 'quarantined',
}

const ENTITY_LABELS: Record<string, string> = {
  block: 'a block',
  record: 'the record',
  record_link: 'a link',
  file: 'a file',
  project: 'the project',
  folder: 'a folder',
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** Build file-list items from file block payloads (no extra fetch needed). */
function fileItemsFromBlocks(
  blocks: NotebookBlockDomain[],
  options: { includeDownloadHref?: boolean } = {},
): {
  id: string
  name: string
  meta: string
  size: string
  mediaType: string
  href?: string
}[] {
  const includeDownloadHref = options.includeDownloadHref ?? true
  return blocks.map((b) => {
    const p = b.payload
    const displayName =
      typeof p.displayName === 'string' ? p.displayName : 'File'
    const mediaType = typeof p.mediaType === 'string' ? p.mediaType : ''
    const byteSize = typeof p.byteSize === 'number' ? p.byteSize : 0
    const fileRecordId =
      typeof p.fileRecordId === 'string' ? p.fileRecordId : ''
    return {
      id: b.id,
      name: displayName,
      meta: mediaType || 'unknown',
      mediaType,
      size: formatBytes(byteSize),
      href:
        includeDownloadHref && fileRecordId
          ? `/api/files/${fileRecordId}/download`
          : undefined,
    }
  })
}

function activityItemsFromEvents(
  activity: RecordActivityItem[],
  currentUserId?: string | null,
): {
  id: string
  actor: { name: string; initials?: string }
  action: string
  target?: string
  at: string
}[] {
  return activity.map((event) => {
    const isSelf = currentUserId && event.actorUserId === currentUserId
    const actor = isSelf
      ? { name: 'You', initials: 'Y' }
      : { name: 'A collaborator', initials: '••' }
    const action = OPERATION_LABELS[event.operation] ?? event.operation
    const target = ENTITY_LABELS[event.entityType] ?? event.entityType
    return {
      id: event.id,
      actor,
      action,
      target,
      at: formatRelativeTime(event.createdAt),
    }
  })
}

/** Derive unique contributors from activity events + the owner. */
function contributorsFromActivity(
  activity: RecordActivityItem[],
  ownerName: string | null | undefined,
  currentUserId: string | null | undefined,
): { id: string; name: string; initials?: string }[] {
  const seen = new Set<string>()
  const contributors: { id: string; name: string; initials?: string }[] = []

  // Owner is the first contributor.
  if (ownerName) {
    const id = currentUserId ?? 'owner'
    contributors.push({
      id,
      name: ownerName,
      initials: ownerName
        .split(' ')
        .map((p) => p[0])
        .join('')
        .slice(0, 2),
    })
    seen.add(id)
  }

  // Add unique actors from activity.
  for (const event of activity) {
    const actorId = event.actorUserId ?? 'unknown'
    if (seen.has(actorId)) continue
    seen.add(actorId)
    const isSelf = currentUserId != null && actorId === currentUserId
    contributors.push({
      id: actorId,
      name: isSelf ? 'You' : 'A collaborator',
      initials: isSelf ? 'Y' : '••',
    })
  }

  return contributors
}

/** Group links by target kind for the "Link to" count pills. */
const LINK_KIND_LABELS: Record<string, string> = {
  sample: 'Samples',
  reagent: 'Reagents',
  protocol_template: 'Protocols',
  dataset: 'Datasets',
  experiment: 'Experiments',
  report: 'Reports',
}

function linkCountsByKind(
  links: NotebookLink[],
): { label: string; count: number; kind: string }[] {
  const counts = new Map<string, number>()
  for (const link of links) {
    const kind = link.targetKind
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([kind, count]) => ({
    label: LINK_KIND_LABELS[kind] ?? `${recordKindLabel(kind)}s`,
    count,
    kind,
  }))
}

function NotebookTemplateVersionLabel({ versionId }: { versionId: string }) {
  const version = useQuery({
    queryKey: ['notebook-template-version', versionId],
    queryFn: () =>
      fetchNotebookTemplateVersion(versionId, notebookTemplateDataClient),
  })
  const template = useQuery({
    queryKey: ['notebook-template', version.data?.templateId],
    enabled: Boolean(version.data?.templateId),
    queryFn: () =>
      fetchNotebookTemplate(
        version.data!.templateId,
        notebookTemplateDataClient,
      ),
  })
  const versions = useQuery({
    queryKey: ['notebook-template-versions', version.data?.templateId],
    enabled: Boolean(version.data?.templateId),
    queryFn: () =>
      fetchNotebookTemplateVersions(
        version.data!.templateId,
        notebookTemplateDataClient,
      ),
  })
  // REUSE-03: governed pin vs published lineage. Badge-only: never
  // auto-applies, never an error style, silent unless a newer published
  // version exists.
  const availability = notebookTemplateUpgradeAvailability(
    version.data
      ? { id: version.data.id, version: version.data.version }
      : null,
    versions.data ?? [],
  )
  if (version.isLoading || template.isLoading) {
    return (
      <span className="text-xs text-muted-foreground" role="status">
        Loading template…
      </span>
    )
  }
  if (!version.data) {
    return <span className="text-xs">Notebook template</span>
  }
  const name = template.data?.name ?? 'Notebook template'
  return (
    <span className="inline-flex items-center gap-2 text-right text-xs">
      <span>
        {name} · version {version.data.version}
      </span>
      {availability.status === 'upgrade-available' &&
      availability.latestVersion ? (
        <Badge variant="kind" className="text-xs">
          Upgrade available · v{availability.latestVersion.version}
        </Badge>
      ) : null}
    </span>
  )
}

function NotebookTagsEditor({ record }: { record: NotebookRecord }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(record.tags.join(', '))
  const save = useMutation({
    mutationFn: (tags: string[]) =>
      updateExperimentMetadata(notebookDataClient, {
        recordId: record.id,
        title: record.title,
        tags,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.record(record.id),
      })
    },
  })
  return (
    <div className="space-y-1">
      <Input
        value={draft}
        aria-label="Notebook tags"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const tags = draft
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
          save.mutate(tags)
        }}
      />
      <p className="text-xs text-muted-foreground">Comma-separated tags.</p>
    </div>
  )
}

export function NotebookInspector({
  record,
  projectName,
  ownerName,
  currentUserId,
  currentUserName,
  links,
  linksLoading,
  blocks,
  activity,
  activityLoading,
  defaultTab,
  canEditMetadata = false,
  reviewActivity = 'none',
  isHistorical = false,
  revisionEvidence,
  commentsRevisionId,
  outlineControls,
  cell = null,
  unsynced = null,
  /**
   * EXT-02: host-composed extension panel tabs, appended after the
   * canonical tabs. Empty (and always empty in historical mode) unless
   * the route resolved an installed extension it can render.
   */
  extensionPanels = [],
}: {
  record: NotebookRecord
  projectName?: string | null
  ownerName?: string | null
  currentUserId?: string | null
  currentUserName?: string
  links: NotebookLink[]
  linksLoading: boolean
  blocks?: NotebookBlockDomain[]
  activity?: RecordActivityItem[]
  activityLoading?: boolean
  /** Initial active tab id. Defaults to the first tab (Properties). */
  defaultTab?: string
  canEditMetadata?: boolean
  reviewActivity?: NotebookReviewActivity
  isHistorical?: boolean
  /** Snapshot blocks and links for `?revision=`. Live props are ignored. */
  revisionEvidence?: {
    blocks: NotebookBlockDomain[]
    links: NotebookLink[]
  }
  /** Exact loaded revision for historical comments. Never fetch live threads. */
  commentsRevisionId?: string
  /** NOTE-02: section-collapse controls; absent on read-only/historical views. */
  outlineControls?: NotebookOutlineControls
  /**
   * EXP-04.4: the selected Sheet cell's facts. Rendered at the head of the
   * Properties tab, above the record's own metadata. Null (the default) when
   * nothing is selected, so the tab is unchanged.
   */
  cell?: NotebookInspectorCellFacts | null
  /**
   * EXP-05.2: the edits waiting to sync, rendered at the head of the
   * Properties tab. Null (the default) leaves the tab unchanged.
   */
  unsynced?: ReactNode
  extensionPanels?: InspectorTab[]
}) {
  const evidenceBlocks = isHistorical
    ? (revisionEvidence?.blocks ?? [])
    : (blocks ?? [])
  const evidenceLinks = isHistorical ? (revisionEvidence?.links ?? []) : links
  const evidenceActivity = isHistorical ? [] : (activity ?? [])
  const fileBlocks = evidenceBlocks.filter((b) => b.type === 'file')
  const fileItems = fileItemsFromBlocks(fileBlocks, {
    includeDownloadHref: !isHistorical,
  })
  const activityItems = activityItemsFromEvents(evidenceActivity, currentUserId)
  const contributors = contributorsFromActivity(
    evidenceActivity,
    ownerName,
    currentUserId,
  )
  const linkCounts = linkCountsByKind(evidenceLinks)
  const fmtDateTime = (iso: string) => formatNotebookDateTime(iso)
  const lifecycle = notebookLifecycleLabel({
    lockedAt: record.lockedAt,
    archivedAt: record.archivedAt,
    reviewActivity,
    isHistorical,
  })

  // NOTE-02: the outline is a projection of the (evidence or live) blocks —
  // the same heading nodes the editor writes, never a second structure.
  const outlineEntries = notebookOutline(evidenceBlocks)

  const tabs = [
    {
      id: 'properties',
      label: 'Properties',
      content: (
        <div className="space-y-2">
          {/* EXP-05.2: what is waiting to sync, from the device store. */}
          {unsynced}
          {/* EXP-04.4: the selected Sheet cell — its value, validation,
              provenance and column definition — heads the tab. The record's
              own metadata below is unchanged, so the panel is an addition to
              this live surface rather than a replacement of it. */}
          {cell ? <NotebookCellProperties cell={cell} /> : null}
          {/* Core metadata — Type & Status as semantic badges, then
                  dense key-value rows matching the mockup's layout. */}
          <PropertyList>
            <Property label="Type">
              <Badge variant="kind" className="text-xs">
                {recordKindLabel(record.kind)}
              </Badge>
            </Property>
            <Property label="Status">
              <StatusBadge
                domain={statusDomainForKind(record.kind)}
                status={record.status}
              />
            </Property>
            <Property label="ID" mono>
              {record.identifier}
            </Property>
            {projectName ? (
              <Property label="Project">{projectName}</Property>
            ) : null}
            <Property label="Created">{fmtDateTime(record.createdAt)}</Property>
            <Property label="Updated">{fmtDateTime(record.updatedAt)}</Property>
            {ownerName ? (
              <Property label="Created by">{ownerName}</Property>
            ) : null}
          </PropertyList>

          {/* Contributors + Review status — same key-value rhythm. */}
          {contributors.length > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">
                Contributors
              </span>
              <ContributorAvatars contributors={contributors} />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">
              Notebook state
            </span>
            {lifecycle === 'Submitted' ? (
              <Badge variant="add" className="text-xs">
                Submitted — evidence frozen
              </Badge>
            ) : lifecycle === 'In review' ? (
              <Badge variant="kind" className="text-xs">
                In review
              </Badge>
            ) : lifecycle === 'Archived' ? (
              <Badge variant="kind" className="text-xs">
                Archived
              </Badge>
            ) : (
              <Badge variant="kind" className="text-xs">
                Working
              </Badge>
            )}
          </div>
          {record.sourceNotebookTemplateVersionId ? (
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">
                Template
              </span>
              <NotebookTemplateVersionLabel
                versionId={record.sourceNotebookTemplateVersionId}
              />
            </div>
          ) : null}

          {/* Tags — coloured pills, always visible */}
          <InspectorSection title="Tags">
            {canEditMetadata ? (
              <NotebookTagsEditor record={record} />
            ) : record.tags.length > 0 ? (
              <TagPills tags={record.tags} />
            ) : (
              <p className="text-xs text-muted-foreground">No tags</p>
            )}
          </InspectorSection>

          {/* Link to — snapshot pills only in historical mode */}
          <InspectorSection title="Link to">
            {isHistorical ? (
              linkCounts.length > 0 ? (
                <LinkToPills
                  items={linkCounts.map((lc) => ({
                    label: lc.label,
                    count: lc.count,
                  }))}
                />
              ) : (
                <EmptyHint>No linked records in this revision</EmptyHint>
              )
            ) : linksLoading ? (
              <EmptyHint>Loading links…</EmptyHint>
            ) : (
              <>
                <LinkToPills
                  items={linkCounts.map((lc) => ({
                    label: lc.label,
                    count: lc.count,
                  }))}
                />
                <ScientificRecordLinker
                  sourceRecordId={record.id}
                  links={evidenceLinks}
                  hideSummaries
                />
              </>
            )}
          </InspectorSection>
          {/* FIND-03: contextual discovery across links, provenance and
              project membership. Silent when empty. */}
          {isHistorical ? null : (
            <RelatedWorkPanel kind="record" id={record.id} />
          )}
          {/* KNOW-01: complete bidirectional typed traversal. Related work
              above is ranked discovery with reasons; this panel is the full
              incoming/outgoing edge list with lifecycle states. Historical
              revisions show the pinned outgoing snapshot without actions. */}
          {isHistorical ? (
            <PinnedRelationshipPanel links={evidenceLinks} />
          ) : (
            <RelationshipPanel
              recordId={record.id}
              sourceModelKey={record.kind}
            />
          )}
          {/* KNOW-02: per-object lineage — the existing traversal BFS seeded
              from this record at a bounded depth. Historical revisions show
              pinned evidence only, so the live traversal stays hidden there. */}
          {isHistorical ? null : <RecordLineageSection recordId={record.id} />}

          <InspectorSection title="Files">
            <FileList items={fileItems} />
          </InspectorSection>
        </div>
      ),
    },
    {
      id: 'outline',
      label: 'Outline',
      content: (
        <NotebookOutlinePanel
          entries={outlineEntries}
          controls={outlineControls}
        />
      ),
    },
    {
      id: 'history',
      label: 'History',
      content:
        currentUserId && currentUserName ? (
          <NotebookHistoryPanel
            recordId={record.id}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
          />
        ) : (
          <EmptyHint>Sign in to see Notebook history.</EmptyHint>
        ),
    },
    {
      id: 'comments',
      label: 'Comments',
      content: isHistorical ? (
        commentsRevisionId && revisionEvidence ? (
          <CommentPanel
            key={commentsRevisionId}
            revisionId={commentsRevisionId}
            targetKind="revision"
            target={{}}
            currentUserId={currentUserId ?? null}
            currentUserName={currentUserName ?? 'Reviewer'}
            canComment={false}
          />
        ) : (
          <EmptyHint>
            Comments are unavailable without revision evidence.
          </EmptyHint>
        )
      ) : (
        <CommentPanel
          recordId={record.id}
          currentUserId={currentUserId ?? null}
          currentUserName={currentUserName ?? 'Reviewer'}
          canComment={canEditMetadata && !record.archivedAt}
        />
      ),
    },
    ...(isHistorical
      ? []
      : [
          {
            id: 'activity',
            label: 'Activity',
            content: activityLoading ? (
              <EmptyHint>Loading activity…</EmptyHint>
            ) : (
              <ActivityFeed items={activityItems} />
            ),
          },
        ]),
    // EXT-02: contributed panels render as ordinary inspector tabs after
    // the canonical ones — same tab affordances, labels and focus order.
    ...extensionPanels,
  ]

  return (
    <Inspector
      hideHeader
      title={record.title}
      defaultTab={defaultTab}
      tabs={tabs}
    />
  )
}
