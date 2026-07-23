import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { FileWarning } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { OverviewView } from '#/components/overview'
import {
  Inspector,
  InspectorSection,
  PropertyList,
  Property,
  LinkedRecordList,
  FileList,
  CheckList,
  CommentList,
  EmptyHint,
} from '#/components/record'
import { StatusBadge } from '#/components/scientific'
import { DataClientError } from '#/lib/data-client'
import {
  fetchBlocksForRecord,
  fetchFileObjectByRecordId,
  fetchLinksForRecord,
  fetchProject,
  fetchRecord,
  fetchRevision,
  notebookDataClient,
  notebookQueryKeys,
  recordKindLabel,
  updateRecordProperties,
} from '#/lib/notebook-data'
import type {
  NotebookBlock,
  NotebookLink,
  NotebookRecord,
} from '#/lib/notebook-data'
import {
  composeSections,
  detectOverviewMode,
  getOverviewConfig,
  mergeOverviewConfig,
  normaliseOverviewConfig,
  toggleBlockExclusion,
  toOverviewRevision,
} from '#/lib/overview'
import type { OverviewMode } from '#/lib/overview'
import { StickyRecordHeader } from '../$recordId'

/**
 * SCI-007: the experiment overview route. A deep-linkable, read-oriented
 * view that composes the notebook's blocks and linked records into the
 * approved overview layout. Reads from the same blocks and linked records
 * as the notebook editor — no duplicated content. Users can exclude
 * individual blocks from the overview; locked, archived and historical
 * (revision) states render without any edit affordances.
 */

export const Route = createFileRoute(
  '/projects/$projectId/experiments/$recordId/overview',
)({
  component: ExperimentOverviewRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    revision: typeof search.revision === 'string' ? search.revision : undefined,
  }),
})

function ExperimentOverviewRoute() {
  const { context } = Route.useRouteContext()
  const { projectId, recordId } = Route.useParams()
  const { revision: revisionId } = useSearch({ from: Route.fullPath })

  const queryClient = useQueryClient()

  const projectQuery = useQuery({
    queryKey: notebookQueryKeys.project(projectId),
    queryFn: () => fetchProject(notebookDataClient, projectId),
  })
  const recordQuery = useQuery({
    queryKey: notebookQueryKeys.record(recordId),
    queryFn: () => fetchRecord(notebookDataClient, recordId),
  })
  const blocksQuery = useQuery({
    queryKey: notebookQueryKeys.blocks(recordId),
    queryFn: () => fetchBlocksForRecord(notebookDataClient, recordId),
    // When viewing a revision, live blocks are not needed — the snapshot
    // provides the blocks. Keep enabled so the live data stays fresh for
    // when the user navigates back to the live overview.
    enabled: !revisionId,
  })
  const linksQuery = useQuery({
    queryKey: notebookQueryKeys.links(recordId),
    queryFn: () => fetchLinksForRecord(notebookDataClient, recordId),
  })
  const revisionQuery = useQuery({
    queryKey: notebookQueryKeys.revision(revisionId ?? 'none'),
    queryFn: () => fetchRevision(notebookDataClient, revisionId ?? ''),
    enabled: Boolean(revisionId),
  })

  // Block visibility toggle mutation (active mode only).  Declared
  // unconditionally alongside the other hooks so the Rules of Hooks are
  // satisfied even when early returns short-circuit the render.
  const toggleMutation = useMutation({
    mutationFn: async ({
      blockId,
      exclude,
    }: {
      blockId: string
      exclude: boolean
    }) => {
      const currentRecord = queryClient.getQueryData<NotebookRecord>(
        notebookQueryKeys.record(recordId),
      )
      const currentBlocks =
        queryClient.getQueryData<NotebookBlock[]>(
          notebookQueryKeys.blocks(recordId),
        ) ?? []
      if (!currentRecord) return
      const currentConfig = getOverviewConfig(currentRecord.properties)
      const nextConfig = toggleBlockExclusion(currentConfig, blockId, exclude)
      const knownBlockIds = currentBlocks.map((b) => b.id)
      const normalised = normaliseOverviewConfig(
        nextConfig.excludedBlockIds,
        knownBlockIds,
      )
      const merged = mergeOverviewConfig(currentRecord.properties, normalised)
      return updateRecordProperties(
        notebookDataClient,
        currentRecord.id,
        merged,
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.record(recordId),
      })
    },
  })

  const project = projectQuery.data ?? null
  const record = recordQuery.data ?? null
  const liveBlocks = blocksQuery.data ?? []
  const links = linksQuery.data ?? []

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: { name: context.user.name, email: context.user.email },
  }

  // Loading — record is the authoritative gate.
  if (recordQuery.isLoading) {
    return (
      <AppShell
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
        <OverviewSkeleton />
      </AppShell>
    )
  }

  // Error from the proxy (e.g. permission_denied).
  if (recordQuery.error) {
    return (
      <AppShell
        context={shellContext}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Projects', to: '/projects' },
          { label: 'Error' },
        ]}
      >
        <OverviewErrorState
          error={recordQuery.error}
          onRetry={() => recordQuery.refetch()}
        />
      </AppShell>
    )
  }

  // RLS hid the row (missing or permission-restricted).
  if (!record) {
    return (
      <AppShell
        context={shellContext}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Projects', to: '/projects' },
          { label: 'Notebook unavailable' },
        ]}
      >
        <OverviewUnavailableState projectId={projectId} />
      </AppShell>
    )
  }

  // Historical revision viewing.
  if (revisionId) {
    if (revisionQuery.isLoading) {
      return (
        <AppShell
          context={shellContext}
          breadcrumbs={overviewBreadcrumbs(project, projectId, record)}
          inspector={
            <OverviewInspector
              record={record}
              projectName={project?.title ?? null}
              ownerName={context.user.name}
              links={links}
              linksLoading={linksQuery.isLoading}
            />
          }
        >
          <StickyRecordHeader
            record={record}
            projectName={project?.title ?? null}
            projectId={projectId}
          />
          <OverviewSkeleton />
        </AppShell>
      )
    }
    if (revisionQuery.error || !revisionQuery.data) {
      return (
        <AppShell
          context={shellContext}
          breadcrumbs={overviewBreadcrumbs(project, projectId, record)}
          inspector={
            <OverviewInspector
              record={record}
              projectName={project?.title ?? null}
              ownerName={context.user.name}
              links={links}
              linksLoading={linksQuery.isLoading}
            />
          }
        >
          <StickyRecordHeader
            record={record}
            projectName={project?.title ?? null}
            projectId={projectId}
          />
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p role="alert" className="text-sm text-destructive">
              Could not load the historical revision. It may have been deleted
              or you may not have access to it.
            </p>
          </div>
        </AppShell>
      )
    }
  }

  const revision = revisionQuery.data
    ? toOverviewRevision(revisionQuery.data)
    : null
  const viewingRevision = Boolean(revisionId && revision)
  const mode: OverviewMode = detectOverviewMode(record, viewingRevision)

  // Blocks: use the revision snapshot for historical, live blocks otherwise.
  const blocks: NotebookBlock[] =
    viewingRevision && revision ? revision.blocks : liveBlocks

  // Overview configuration (excluded block ids).
  const config = getOverviewConfig(record.properties)
  const sections = composeSections(blocks, config.excludedBlockIds)

  return (
    <AppShell
      context={shellContext}
      breadcrumbs={overviewBreadcrumbs(project, projectId, record)}
      inspector={
        <OverviewInspector
          record={record}
          projectName={project?.title ?? null}
          ownerName={context.user.name}
          links={links}
          linksLoading={linksQuery.isLoading}
          blocks={blocks}
        />
      }
    >
      <div className="-mx-4 -my-6 min-h-[calc(100svh-3.5rem)] bg-background md:-mx-8">
        <div className="mx-auto w-full max-w-[1180px] space-y-2 px-8 pb-16">
          <StickyRecordHeader
            record={record}
            projectName={project?.title ?? null}
            projectId={projectId}
          />
          {blocksQuery.error && !viewingRevision ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p role="alert" className="text-sm text-destructive">
                Could not load the notebook blocks.
              </p>
              <button
                type="button"
                onClick={() => blocksQuery.refetch()}
                className="mt-2 inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-sm font-medium"
              >
                Try again
              </button>
            </div>
          ) : (
            <OverviewView
              sections={sections}
              mode={mode}
              revision={revision}
              excludedBlockIds={config.excludedBlockIds}
              onToggleBlock={
                mode === 'active'
                  ? (blockId, exclude) =>
                      toggleMutation.mutate({ blockId, exclude })
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// Inspector — reuses the shared Inspector component with overview-oriented
// tabs: Properties, Links, Files.
// ---------------------------------------------------------------------------

function OverviewInspector({
  record,
  projectName,
  ownerName,
  links,
  linksLoading,
  blocks,
}: {
  record: NotebookRecord
  projectName?: string | null
  ownerName?: string | null
  links: NotebookLink[]
  linksLoading: boolean
  blocks?: NotebookBlock[]
}) {
  // Collect file blocks for the Files tab.
  const fileBlocks = blocks?.filter((b) => b.type === 'file') ?? []
  return (
    <Inspector
      recordType={recordKindLabel(record.kind)}
      title={record.title}
      tabs={[
        {
          id: 'properties',
          label: 'Properties',
          content: (
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
                <Property label="Created by">{ownerName}</Property>
              ) : null}
              <Property label="Created">
                {new Date(record.createdAt).toLocaleString()}
              </Property>
              <Property label="Updated">
                {new Date(record.updatedAt).toLocaleString()}
              </Property>
              {record.archivedAt ? (
                <Property label="Archived">
                  {new Date(record.archivedAt).toLocaleString()}
                </Property>
              ) : null}
              {record.tags.length > 0 ? (
                <Property label="Tags">
                  <span className="flex flex-wrap gap-1">
                    {record.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-muted px-2 py-0.5 text-[10px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </Property>
              ) : null}
            </PropertyList>
          ),
        },
        {
          id: 'links',
          label: 'Links',
          badge: links.length,
          content: linksLoading ? (
            <EmptyHint>Loading links…</EmptyHint>
          ) : (
            <InspectorSection title="Outgoing links">
              <LinkedRecordList
                items={links.map((link) => ({
                  id: link.id,
                  type: recordKindLabel(link.targetKind),
                  title: link.targetIdentifier,
                  meta: link.linkType,
                }))}
              />
            </InspectorSection>
          ),
        },
        ...(fileBlocks.length > 0
          ? [
              {
                id: 'files',
                label: 'Files',
                badge: fileBlocks.length,
                content: <InspectorFileList blocks={fileBlocks} />,
              },
            ]
          : []),
        {
          id: 'checks',
          label: 'Checks',
          content: (
            <InspectorSection title="Quality checks">
              <CheckList items={[]} />
            </InspectorSection>
          ),
        },
        {
          id: 'comments',
          label: 'Comments',
          content: (
            <InspectorSection title="Comments">
              <CommentList items={[]} />
            </InspectorSection>
          ),
        },
      ]}
    />
  )
}

function InspectorFileList({ blocks }: { blocks: NotebookBlock[] }) {
  const fileQueries = useQueriesFileObjects(blocks)
  if (fileQueries.some((q) => q.isLoading)) {
    return <EmptyHint>Loading files…</EmptyHint>
  }
  const items = fileQueries.map((q, i) => {
    const block = blocks[i]
    const payload = block.payload
    const displayName =
      q.data?.displayName ??
      (typeof payload.displayName === 'string' ? payload.displayName : 'File')
    const mediaType =
      q.data?.mediaType ??
      (typeof payload.mediaType === 'string' ? payload.mediaType : '')
    const byteSize =
      q.data?.byteSize ??
      (typeof payload.byteSize === 'number' ? payload.byteSize : 0)
    const fileRecordId =
      typeof payload.fileRecordId === 'string' ? payload.fileRecordId : ''
    return {
      id: block.id,
      name: displayName,
      meta: `${mediaType || 'unknown'} · ${formatBytes(byteSize)}`,
      href: fileRecordId ? `/api/files/${fileRecordId}/download` : undefined,
    }
  })
  return <FileList items={items} />
}

function useQueriesFileObjects(blocks: NotebookBlock[]) {
  return useQueries({
    queries: blocks.map((block) => {
      const payload = block.payload
      const fileRecordId =
        typeof payload.fileRecordId === 'string' ? payload.fileRecordId : ''
      return {
        queryKey: notebookQueryKeys.fileObject(fileRecordId || 'unresolved'),
        queryFn: () =>
          fetchFileObjectByRecordId(notebookDataClient, fileRecordId),
        enabled: Boolean(fileRecordId),
        staleTime: 0,
      }
    }),
  })
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// ---------------------------------------------------------------------------
// Breadcrumbs, loading, error and unavailable states.
// ---------------------------------------------------------------------------

function overviewBreadcrumbs(
  project: { title: string } | null,
  projectId: string,
  record: NotebookRecord,
) {
  return [
    { label: 'Home', to: '/' },
    { label: 'Projects', to: '/projects' },
    ...(project
      ? [{ label: project.title, to: `/projects/${projectId}` }]
      : []),
    {
      label: record.title,
      to: `/projects/${projectId}/experiments/${record.id}`,
    },
    { label: 'Overview' },
  ]
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

function OverviewSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-16 animate-pulse rounded-lg border bg-card" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
      ))}
    </div>
  )
}

function OverviewErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const message =
    error instanceof DataClientError && error.code === 'permission_denied'
      ? 'You do not have access to this notebook.'
      : 'Could not load the overview.'
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

function OverviewUnavailableState({ projectId }: { projectId: string }) {
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
