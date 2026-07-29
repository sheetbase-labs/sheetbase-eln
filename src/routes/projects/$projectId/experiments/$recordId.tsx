import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  Outlet,
  useBlocker,
  useRouterState,
} from '@tanstack/react-router'
import {
  Archive,
  ChevronDown,
  FileWarning,
  FlaskConical,
  Folder,
  Lock,
  Share2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useShell } from '#/components/app-shell'
import { NotebookDocument } from '#/components/notebook'
import type { SaveResult } from '#/components/notebook'
import { useLiveStatus } from '#/components/live/live-event-provider'
import {
  ActivityFeed,
  CheckList,
  FileList,
  Inspector,
  InspectorSection,
  PropertyList,
  Property,
  LinkedRecordList,
  EmptyHint,
} from '#/components/record'
import { ScientificRecordLinker, StatusBadge } from '#/components/scientific'
import { Badge, Button } from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import {
  fetchBlocksForRecord,
  fetchChangeEventsForRecord,
  fetchLinksForRecord,
  fetchProject,
  fetchRecord,
  formatRelativeTime,
  notebookDataClient,
  notebookQueryKeys,
  recordKindLabel,
} from '#/lib/notebook-data'
import type {
  NotebookBlock as NotebookBlockDomain,
  NotebookLink,
  NotebookRecord,
  RecordActivityItem,
} from '#/lib/notebook-data'
import {
  defaultPayloadFor,
  deleteBlock,
  duplicateBlock,
  insertBlock,
  insertSheetBlock,
  moveBlock,
  updateBlockPayload,
} from '#/lib/notebook-mutations'
import { freezeChart, unfreezeChart } from '#/lib/chart-data'
import { validateBlock } from '#/lib/blocks'
import { pinProtocolReference } from '#/lib/protocol-materials'
import { attachFileToBlock, AttachFileError } from '#/lib/file-attach'

function RouteShell({
  children,
  ...configuration
}: Parameters<typeof useShell>[0] & { children: ReactNode }) {
  useShell(configuration)
  return <>{children}</>
}

/**
 * ELN-004: the deep-linkable experiment notebook route. Loads the record,
 * its ordered blocks and its outgoing links through route-aware queries,
 * renders the compact record header and a continuous central document
 * canvas, and pins the project context, status and ownership while the
 * document scrolls. Missing, archived and permission-restricted notebooks
 * each get an honest state. ELN-005 adds editing/insertion on this canvas.
 */

export const Route = createFileRoute(
  '/projects/$projectId/experiments/$recordId',
)({
  component: ExperimentNotebookRoute,
})

function ExperimentNotebookRoute() {
  const { context } = Route.useRouteContext()
  const { projectId, recordId } = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isNotebookIndex =
    pathname === `/projects/${projectId}/experiments/${recordId}`

  const queryClient = useQueryClient()

  const projectQuery = useQuery({
    queryKey: notebookQueryKeys.project(projectId),
    queryFn: () => fetchProject(notebookDataClient, projectId),
    enabled: isNotebookIndex,
  })
  const recordQuery = useQuery({
    queryKey: notebookQueryKeys.record(recordId),
    queryFn: () => fetchRecord(notebookDataClient, recordId),
    enabled: isNotebookIndex,
  })
  const blocksQuery = useQuery({
    queryKey: notebookQueryKeys.blocks(recordId),
    queryFn: () => fetchBlocksForRecord(notebookDataClient, recordId),
    enabled: isNotebookIndex,
  })
  const linksQuery = useQuery({
    queryKey: notebookQueryKeys.links(recordId),
    queryFn: () => fetchLinksForRecord(notebookDataClient, recordId),
    enabled: isNotebookIndex,
  })
  const activityQuery = useQuery({
    queryKey: notebookQueryKeys.activity(recordId),
    queryFn: () => fetchChangeEventsForRecord(notebookDataClient, recordId),
    enabled: isNotebookIndex,
  })

  // Child routes (e.g. /overview) render through the Outlet; the notebook
  // queries only run for the exact experiment path.
  if (!isNotebookIndex) return <Outlet />

  const project = projectQuery.data ?? null
  const record = recordQuery.data ?? null
  const blocks = blocksQuery.data ?? []
  const links = linksQuery.data ?? []
  const activity = activityQuery.data ?? []

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: { name: context.user.name, email: context.user.email },
  }

  // Loading — record is the authoritative gate; project loads in parallel.
  if (recordQuery.isLoading) {
    return (
      <RouteShell
        context={shellContext}
        breadcrumbs={loadingBreadcrumbs(project, projectId)}
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
        <NotebookUnavailableState projectId={projectId} />
      </RouteShell>
    )
  }

  const isArchived = record.archivedAt !== null

  return (
    <RouteShell
      context={shellContext}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        { label: 'Projects', to: '/projects' },
        ...(project
          ? [{ label: project.title, to: `/projects/${projectId}` }]
          : []),
        { label: record.title },
      ]}
      projectTree={
        project ? (
          <NotebookProjectTree
            projectId={projectId}
            projectName={project.title}
            recordId={record.id}
            recordTitle={record.title}
          />
        ) : undefined
      }
      inspectorCollapsible
      inspector={
        <NotebookInspector
          record={record}
          projectName={project?.title ?? null}
          ownerName={context.user.name}
          currentUserId={context.user.id}
          links={links}
          linksLoading={linksQuery.isLoading}
          blocks={blocks}
          activity={activity}
          activityLoading={activityQuery.isLoading}
        />
      }
    >
      <div className="-my-6 mx-auto w-full max-w-3xl px-4 pb-16 md:px-6">
          <StickyRecordHeader
            record={record}
            projectName={project?.title ?? null}
            projectId={projectId}
            onAddBlock={
              record.lockedAt
                ? undefined
                : () => document.getElementById('notebook-add-block')?.click()
            }
          />
          {isArchived ? <ArchivedBanner /> : null}
          {record.lockedAt ? <LockedBanner record={record} /> : null}
          <NotebookCanvas
              record={record}
              blocks={blocks}
              isLoading={blocksQuery.isLoading}
              error={blocksQuery.error}
              onRetry={() => blocksQuery.refetch()}
              client={notebookDataClient}
              queryClient={queryClient}
            />
      </div>
    </RouteShell>
  )
}

export function NotebookProjectTree({
  projectId,
  projectName,
  recordId,
  recordTitle,
}: {
  projectId: string
  projectName: string
  recordId: string
  recordTitle: string
}) {
  return (
    <div className="space-y-0.5 text-sm">
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className="flex h-8 items-center gap-2 rounded-md px-2 font-medium text-sidebar-foreground no-underline hover:bg-sidebar-accent/60"
      >
        <ChevronDown className="size-3.5 text-muted-foreground" />
        <Folder className="size-4 text-muted-foreground" />
        <span className="truncate">{projectName}</span>
      </Link>
      <Link
        to="/projects/$projectId/experiments/$recordId"
        params={{ projectId, recordId }}
        className="ml-5 flex min-h-8 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-xs font-medium text-sidebar-accent-foreground no-underline"
      >
        <FlaskConical className="size-3.5 shrink-0" />
        <span className="line-clamp-2">{recordTitle}</span>
      </Link>
    </div>
  )
}

function loadingBreadcrumbs(
  project: { title: string } | null,
  projectId: string,
) {
  return [
    { label: 'Home', to: '/' },
    { label: 'Projects', to: '/projects' },
    ...(project
      ? [
          {
            label: project.title,
            to: `/projects/${projectId}`,
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
  onAddBlock,
}: {
  record: NotebookRecord
  projectName: string | null
  projectId?: string
  onAddBlock?: () => void
}) {
  return (
    <div className="pb-3 pt-4">
      {/* Row 1: type · status · identifier — compact inline */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {recordKindLabel(record.kind)}
        </span>
        <StatusBadge domain="experiment" status={record.status} />
        {record.lockedAt ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <Lock className="size-3" aria-hidden />
            Locked
          </span>
        ) : null}
        <span className="font-mono tabular-nums text-muted-foreground">
          {record.identifier}
        </span>
      </div>

      {/* Row 2: title — tight to the badge row above */}
      <h1 className="mt-1.5 font-display text-xl font-semibold leading-7 tracking-[-0.025em] text-foreground sm:text-2xl sm:leading-8">
        {record.title}
      </h1>

      {/* Row 3: metadata + actions — single compact line */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            Created{' '}
            <span className="text-foreground">
              {new Date(record.createdAt).toLocaleDateString()}
            </span>
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>
            Updated{' '}
            <span className="text-foreground">
              {new Date(record.updatedAt).toLocaleDateString()}
            </span>
          </span>
          {projectName ? (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-foreground">{projectName}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Share experiment"
            title="Sharing coming soon"
            onClick={() => {
              /* placeholder — sharing arrives in a later ticket */
            }}
          >
            <Share2 className="size-3.5" />
            <span>Share</span>
          </Button>
          {onAddBlock ? (
            <Button size="sm" onClick={onAddBlock}>
              + Block
            </Button>
          ) : null}
        </div>
      </div>
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
}: {
  record: { lockedAt: string | null; lockedByRevisionId?: string | null }
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs"
    >
      <Lock
        className="size-3.5 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
      <span className="text-foreground">
        This record is locked by an approved signature. Scientific evidence is
        frozen — start an amendment to edit again.
        {record.lockedByRevisionId ? (
          <span className="ml-1 font-mono text-muted-foreground">
            (revision {record.lockedByRevisionId.slice(0, 8)})
          </span>
        ) : null}
      </span>
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
  if (blocks.length === 0) {
    return <EmptyNotebook record={record} />
  }
  if (record.archivedAt || record.lockedAt || !client || !queryClient) {
    // Archived and locked notebooks, plus provider-less callers, render
    // read-only through the same document component so the visual frame and
    // anchors match the editable state. SIGN-002: a locked record's
    // scientific evidence is frozen until an amendment unlocks it.
    return (
      <NotebookDocument
        record={record}
        blocks={blocks}
        readOnly
        onSaveBlock={async () => ({ ok: true })}
        onInsertBlock={async () => undefined}
        onDuplicateBlock={async () => undefined}
        onDeleteBlock={async () => undefined}
      />
    )
  }
  return (
    <EditableNotebook
      record={record}
      blocks={blocks}
      client={client}
      queryClient={queryClient}
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
}: {
  record: NotebookRecord
  blocks: NotebookBlockDomain[]
  client: DataClient
  queryClient: QueryClient
}) {
  const blocksKey = notebookQueryKeys.blocks(record.id)
  const recordKey = notebookQueryKeys.record(record.id)
  const liveStatus = useLiveStatus()
  const offline = liveStatus.status === 'offline'

  // ELN-007 — block in-app navigation only when unsaved work genuinely
  // remains at risk. The document reports the aggregate signal via
  // `onUnsavedWorkChange`; `beforeunload` (tab close) is handled inside
  // the document. The router blocker uses `withResolver` so we can show
  // a comprehensible confirmation rather than blocking silently.
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false)
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
      options?: { datasetSchemaId?: string }
    }) => {
      if (type === 'sheet') {
        return insertSheetBlock(client, {
          recordId: record.id,
          afterBlockId,
          expectedStructureVersion: record.structureVersion,
          datasetSchemaId: options?.datasetSchemaId,
        })
      }
      const payload = defaultPayloadFor(type)
      return insertBlock(client, {
        recordId: record.id,
        type,
        payload,
        afterBlockId,
        expectedStructureVersion: record.structureVersion,
      })
    },
    onSuccess: (res) => {
      upsertBlock(res.block)
      setRecordStructureVersion(res.structureVersion)
    },
    onError: (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        void queryClient.invalidateQueries({ queryKey: blocksKey })
        void queryClient.invalidateQueries({ queryKey: recordKey })
      }
    },
  })

  // --- Duplicate ---------------------------------------------------------
  const duplicateMutation = useMutation({
    mutationFn: async (block: NotebookBlockDomain) =>
      duplicateBlock(client, {
        block,
        expectedStructureVersion: record.structureVersion,
      }),
    onSuccess: (res) => {
      upsertBlock(res.block)
      setRecordStructureVersion(res.structureVersion)
    },
    onError: (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        void queryClient.invalidateQueries({ queryKey: blocksKey })
        void queryClient.invalidateQueries({ queryKey: recordKey })
      }
    },
  })

  // --- Delete ------------------------------------------------------------
  const deleteMutation = useMutation({
    mutationFn: async (block: NotebookBlockDomain) =>
      deleteBlock(client, {
        blockId: block.id,
        expectedStructureVersion: record.structureVersion,
      }),
    onSuccess: (res, vars) => {
      removeBlock(vars.id)
      setRecordStructureVersion(res.structureVersion)
    },
    onError: (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        void queryClient.invalidateQueries({ queryKey: blocksKey })
        void queryClient.invalidateQueries({ queryKey: recordKey })
      }
    },
  })

  // Undo delete = re-insert the same payload at the end (safe default; the
  // original position is preserved only loosely). Uses the current
  // structure_version from the record cache.
  const undoDeleteMutation = useMutation({
    mutationFn: async ({
      type,
      payload,
    }: {
      type: string
      payload: Record<string, unknown>
    }) => {
      const current = queryClient.getQueryData<NotebookRecord | null>(recordKey)
      return insertBlock(client, {
        recordId: record.id,
        type,
        payload,
        expectedStructureVersion:
          current?.structureVersion ?? record.structureVersion,
      })
    },
    onSuccess: (res) => {
      upsertBlock(res.block)
      setRecordStructureVersion(res.structureVersion)
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
    onError: (error) => {
      if (error instanceof DataClientError && error.code === 'stale_version') {
        void queryClient.invalidateQueries({ queryKey: blocksKey })
        void queryClient.invalidateQueries({ queryKey: recordKey })
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

  async function handleInsert(
    type: string,
    afterBlockId?: string,
    options?: { datasetSchemaId?: string },
  ) {
    await insertMutation.mutateAsync({ type, afterBlockId, options })
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

  async function handleDuplicate(block: NotebookBlockDomain) {
    await duplicateMutation.mutateAsync(block)
  }

  async function handleDelete(block: NotebookBlockDomain) {
    await deleteMutation.mutateAsync(block)
  }

  async function handleUndoDelete(
    type: string,
    payload: Record<string, unknown>,
  ) {
    await undoDeleteMutation.mutateAsync({ type, payload })
  }

  async function handleMove(
    block: NotebookBlockDomain,
    destination: { afterBlockId: string | null; beforeBlockId: string | null },
  ) {
    await moveMutation.mutateAsync({ block, destination })
  }

  return (
    <NotebookDocument
      record={record}
      blocks={blocks}
      onSaveBlock={handleSave}
      offline={offline}
      onUnsavedWorkChange={setHasUnsavedWork}
      onInsertBlock={handleInsert}
      onPinProtocol={handlePinProtocol}
      onAttachFile={handleAttachFile}
      onFreezeChart={handleFreezeChart}
      onUnfreezeChart={handleUnfreezeChart}
      onDuplicateBlock={handleDuplicate}
      onDeleteBlock={handleDelete}
      onUndoDelete={handleUndoDelete}
      onMoveBlock={handleMove}
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
      <p className="mt-3 text-xs text-muted-foreground">
        Block insertion arrives in the next ticket (ELN-005). The notebook is
        deep-linkable and shareable today.
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

export function NotebookUnavailableState({ projectId }: { projectId: string }) {
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
          to="/projects/$projectId"
          params={{ projectId }}
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium no-underline"
        >
          Back to project
        </Link>
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
// Inspector. Route-owned so it composes against the live record/links data.
// The mockup's right sidebar has three tabs: Properties, Activity, Comments.
// Properties gathers metadata, tags, attached files, linked records and QC
// checks into one dense column; Activity reads the durable change_events
// feed; Comments is a placeholder until collaborative annotation ships.
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

/**
 * Static QC check indicators. The mockup shows data-integrity and
 * instrument-calibration checks as "Passed"; these are placeholder concepts
 * until a real QC workflow lands, so they always report a pass state.
 */
const QC_CHECKS = [
  {
    id: 'data-integrity',
    label: 'Data integrity',
    state: 'pass' as const,
    detail: 'Passed',
  },
  {
    id: 'instrument-cal',
    label: 'Instrument calibration',
    state: 'pass' as const,
    detail: 'Passed',
  },
]

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
function fileItemsFromBlocks(blocks: NotebookBlockDomain[]): {
  id: string
  name: string
  meta: string
  href?: string
}[] {
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
      meta: `${mediaType || 'unknown'} · ${formatBytes(byteSize)}`,
      href: fileRecordId ? `/api/files/${fileRecordId}/download` : undefined,
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

export function NotebookInspector({
  record,
  projectName,
  ownerName,
  currentUserId,
  links,
  linksLoading,
  blocks,
  activity,
  activityLoading,
  defaultTab,
}: {
  record: NotebookRecord
  projectName?: string | null
  ownerName?: string | null
  currentUserId?: string | null
  links: NotebookLink[]
  linksLoading: boolean
  blocks?: NotebookBlockDomain[]
  activity?: RecordActivityItem[]
  activityLoading?: boolean
  /** Initial active tab id. Defaults to the first tab (Properties). */
  defaultTab?: string
}) {
  const fileBlocks = blocks?.filter((b) => b.type === 'file') ?? []
  const fileItems = fileItemsFromBlocks(fileBlocks)
  const activityItems = activityItemsFromEvents(activity ?? [], currentUserId)

  return (
    <Inspector
      recordType={recordKindLabel(record.kind)}
      title={record.title}
      defaultTab={defaultTab}
      tabs={[
        {
          id: 'properties',
          label: 'Properties',
          content: (
            <div className="space-y-0">
              <PropertyList>
                <Property label="Identifier" mono>
                  {record.identifier}
                </Property>
                <Property label="Kind">{recordKindLabel(record.kind)}</Property>
                <Property label="Status">
                  <StatusBadge domain="experiment" status={record.status} />
                </Property>
                {projectName ? (
                  <Property label="Project">{projectName}</Property>
                ) : null}
                {ownerName ? (
                  <Property label="Author">{ownerName}</Property>
                ) : null}
                <Property label="Created">
                  {new Date(record.createdAt).toLocaleDateString()}
                </Property>
                <Property label="Updated">
                  {new Date(record.updatedAt).toLocaleDateString()}
                </Property>
                {record.archivedAt ? (
                  <Property label="Archived">
                    {new Date(record.archivedAt).toLocaleString()}
                  </Property>
                ) : null}
              </PropertyList>

              {record.tags.length > 0 ? (
                <InspectorSection title="Tags">
                  <div className="flex flex-wrap gap-1">
                    {record.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </InspectorSection>
              ) : null}

              <InspectorSection title="Files">
                <FileList items={fileItems} />
              </InspectorSection>

              <InspectorSection title="Linked records">
                {linksLoading ? (
                  <EmptyHint>Loading links…</EmptyHint>
                ) : (
                  <>
                    <LinkedRecordList
                      items={links.map((link) => ({
                        id: link.id,
                        type: recordKindLabel(link.targetKind),
                        title: link.targetIdentifier,
                        meta: link.linkType,
                      }))}
                    />
                    <ScientificRecordLinker
                      sourceRecordId={record.id}
                      links={links}
                    />
                  </>
                )}
              </InspectorSection>

              <InspectorSection title="QC checks">
                <CheckList items={QC_CHECKS} />
              </InspectorSection>
            </div>
          ),
        },
        {
          id: 'activity',
          label: 'Activity',
          content: activityLoading ? (
            <EmptyHint>Loading activity…</EmptyHint>
          ) : (
            <ActivityFeed items={activityItems} />
          ),
        },
        {
          id: 'comments',
          label: 'Comments',
          content: (
            <InspectorSection title="Comments">
              <EmptyHint>
                Comments coming soon. Collaborative annotation will appear here.
              </EmptyHint>
            </InspectorSection>
          ),
        },
      ]}
    />
  )
}
