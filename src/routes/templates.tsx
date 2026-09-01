import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useMemo, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import {
  TemplateFilters,
  TemplateInspector,
  TemplateList,
} from '#/components/templates/template-library'
import { VersionedNotebookTemplatePanel } from '#/components/templates/versioned-notebook-templates'
import type {
  TemplateLinkedRecord,
  TemplateOwnershipFilter,
  TemplateProject,
  TemplateView,
} from '#/components/templates/template-library'
import { createDataClient, DataClientError } from '#/lib/data-client'
import {
  fetchBlocksForRecord,
  fetchRecord,
  notebookDataClient,
  notebookQueryKeys,
  toBlock,
} from '#/lib/notebook-data'
import type { BlockWire, NotebookBlock, RecordWire } from '#/lib/notebook-data'
import {
  archiveTemplate,
  buildTemplateExport,
  createTemplateFavouritesStore,
  duplicateTemplate,
  fetchTemplates,
  fetchTemplateUsage,
  instantiateTemplate,
  templateQueryKeys,
} from '#/lib/templates'
import type { TargetKind } from '#/lib/templates'
import { useRecentViewTracking } from '#/lib/recents'

/**
 * Template Library. Versioned notebook templates are the notebook catalogue.
 * Protocol templates remain a separate pin-into-Notebook catalogue (TPL-001).
 */

const getTemplateContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    return getCurrentContext(getRequestHeaders())
  },
)

export const Route = createFileRoute('/templates')({
  validateSearch: (search: Record<string, unknown>) => ({
    template: typeof search.template === 'string' ? search.template : undefined,
    protocol: typeof search.protocol === 'string' ? search.protocol : undefined,
  }),
  beforeLoad: async () => {
    const context = await getTemplateContext()
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: TemplateLibraryRoute,
})

const dataClient = createDataClient()

function TemplateLibraryRoute() {
  const { context } = Route.useRouteContext()
  const routeSearch = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // FIND-01: an opened template counts as a "view" for the Recent surface;
  // browsing the library without a selection does not.
  useRecentViewTracking('notebook_template', routeSearch.template ?? null)

  const currentUserId = context.user.id
  const role = context.workspace?.role ?? null
  const workspaceId = context.workspace?.id ?? 'no-workspace'

  // Filters
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [ownership, setOwnership] = useState<TemplateOwnershipFilter>('all')
  const [favouritesOnly, setFavouritesOnly] = useState(false)
  const [view, setView] = useState<TemplateView>('list')
  const selectedId = routeSearch.protocol ?? null
  const [instantiationError, setInstantiationError] = useState<string | null>(
    null,
  )
  const [instantiationSuccess, setInstantiationSuccess] = useState<{
    recordId: string
    projectId: string
  } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  function setSelectedId(id: string | null) {
    void navigate({
      to: '/templates',
      search: { template: undefined, protocol: id ?? undefined },
      replace: false,
    })
  }

  function setSelectedNotebookTemplateId(id: string | null) {
    void navigate({
      to: '/templates',
      search: { template: id ?? undefined, protocol: undefined },
      replace: false,
    })
  }

  // Favourites store (per-user, per-workspace localStorage).
  const favouritesStore = useMemo(
    () => createTemplateFavouritesStore({ workspaceId, userId: currentUserId }),
    [workspaceId, currentUserId],
  )
  const [favourites, setFavourites] = useState<Set<string>>(
    () => new Set(favouritesStore.list()),
  )

  function toggleFavourite(id: string) {
    favouritesStore.toggle(id)
    setFavourites(new Set(favouritesStore.list()))
  }

  // Template list query
  const templatesQuery = useQuery({
    queryKey: templateQueryKeys.list({
      kind: 'protocol_template',
      status: statusFilter !== 'all' ? statusFilter : undefined,
      search,
      includeArchived: true,
    }),
    queryFn: async () => {
      return fetchTemplates(notebookDataClient, {
        kind: 'protocol_template',
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search,
        includeArchived: true,
      })
    },
  })

  // Block counts for every listed template, fetched in a single query so
  // the list can show a "blocks" column without N+1 requests. Selects only
  // record_id to keep the payload small.
  const templateIds = (templatesQuery.data ?? []).map((t) => t.id)
  const blockCountsQuery = useQuery({
    queryKey: ['sci-006', 'template-block-counts', templateIds],
    queryFn: async () => {
      const idFilter = templateIds.join(',')
      const rows = await notebookDataClient.list<{ record_id: string }>(
        'blocks',
        `?record_id=in.(${idFilter})&select=record_id`,
      )
      const counts: Record<string, number> = {}
      for (const row of rows) {
        counts[row.record_id] = (counts[row.record_id] ?? 0) + 1
      }
      return counts
    },
    enabled: templateIds.length > 0,
  })

  // Usage counts: how many records were instantiated from each template.
  // Each instantiation creates a `record_links` row with link_type='template'
  // whose target_record_id is the template, so grouping by target gives the
  // per-template usage count in one request.
  const usageCountsQuery = useQuery({
    queryKey: ['sci-006', 'template-usage-counts', templateIds],
    queryFn: async () => {
      const idFilter = templateIds.join(',')
      const rows = await notebookDataClient.list<{ target_record_id: string }>(
        'record_links',
        `?link_type=eq.template&target_record_id=in.(${idFilter})&select=target_record_id`,
      )
      const counts: Record<string, number> = {}
      for (const row of rows) {
        counts[row.target_record_id] = (counts[row.target_record_id] ?? 0) + 1
      }
      return counts
    },
    enabled: templateIds.length > 0,
  })

  // TPL-001: grid view renders thumbnails from actual block content. Fetch
  // the blocks for every listed template (bounded by the workspace template
  // count) only when the grid view is active, then group by record id.
  const blockPreviewsQuery = useQuery({
    queryKey: ['tpl-001', 'template-block-previews', templateIds],
    queryFn: async () => {
      const idFilter = templateIds.join(',')
      const rows = await notebookDataClient.list<BlockWire>(
        'blocks',
        `?record_id=in.(${idFilter})&order=record_id.asc,order.asc`,
      )
      const grouped: Record<string, BlockWire[]> = {}
      for (const row of rows) {
        ;(grouped[row.record_id] ??= []).push(row)
      }
      const mapped: Record<string, NotebookBlock[]> = {}
      for (const [recordId, blocks] of Object.entries(grouped)) {
        mapped[recordId] = blocks.map(toBlock)
      }
      return mapped
    },
    enabled: view === 'grid' && templateIds.length > 0,
  })

  // Selected template detail queries
  const selectedQuery = useQuery({
    queryKey: notebookQueryKeys.record(selectedId ?? 'none'),
    queryFn: () => fetchRecord(notebookDataClient, selectedId!),
    enabled: Boolean(selectedId),
  })

  const blocksQuery = useQuery({
    queryKey: notebookQueryKeys.blocks(selectedId ?? 'none'),
    queryFn: () => fetchBlocksForRecord(notebookDataClient, selectedId!),
    enabled: Boolean(selectedId),
  })

  // TPL-001: usage links (incoming) + their source records for the inspector.
  const usageLinksQuery = useQuery({
    queryKey: templateQueryKeys.usage(selectedId ?? 'none'),
    queryFn: () => fetchTemplateUsage(notebookDataClient, selectedId!),
    enabled: Boolean(selectedId),
  })

  const linkedRecordsQuery = useQuery({
    queryKey: ['tpl-001', 'linked-records', usageLinksQuery.data ?? []],
    queryFn: async () => {
      const ids = (usageLinksQuery.data ?? []).map((item) => item.recordId)
      if (ids.length === 0) return [] as TemplateLinkedRecord[]
      const rows = await notebookDataClient.list<RecordWire>(
        'records',
        `?id=in.(${ids.join(',')})&select=id,identifier,title,kind,status,project_id`,
      )
      const linked: TemplateLinkedRecord[] = rows.map((row) => ({
        id: row.id,
        identifier: row.identifier,
        title: row.title,
        kind: row.kind,
        status: row.status,
        projectId: row.project_id,
      }))
      return linked
    },
    enabled: Boolean(selectedId) && (usageLinksQuery.data ?? []).length > 0,
  })

  // Project list for the instantiation form
  const projectsQuery = useQuery({
    queryKey: notebookQueryKeys.projectsList(),
    queryFn: async () => {
      return notebookDataClient.list<TemplateProject>(
        'projects',
        '?order=created_at.desc',
      )
    },
  })

  // Apply client-side filters: ownership + favourites (server filters handle
  // kind/status/search). Ownership uses the current user id; the records
  // endpoint does not expose a created_by_user_id filter via the proxy list
  // helper without a join, so filter in the browser — the template count is
  // bounded by workspace size.
  const allTemplates = templatesQuery.data ?? []
  const templates = useMemo(() => {
    let rows = allTemplates
    if (ownership === 'mine') {
      rows = rows.filter((t) => t.createdByUserId === currentUserId)
    }
    if (favouritesOnly) {
      rows = rows.filter((t) => favourites.has(t.id))
    }
    return rows
  }, [allTemplates, ownership, favouritesOnly, favourites, currentUserId])

  const selected = selectedQuery.data ?? null
  const selectedBlocks = blocksQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const blockCounts = blockCountsQuery.data ?? {}
  const usageCounts = usageCountsQuery.data ?? {}
  const blockPreviews = blockPreviewsQuery.data ?? {}
  const linkedRecords = linkedRecordsQuery.data ?? []
  const selectedUsageCount = selected ? (usageCounts[selected.id] ?? 0) : 0

  // Instantiation mutation
  const instantiateMutation = useMutation({
    mutationFn: async (params: {
      templateRecordId: string
      targetProjectId: string
      targetKind: TargetKind
      title: string
    }) => {
      return instantiateTemplate(dataClient, params)
    },
    onSuccess: (result) => {
      setInstantiationError(null)
      setInstantiationSuccess({
        recordId: result.record.id,
        projectId: result.record.projectId ?? '',
      })
      void queryClient.invalidateQueries({
        queryKey: ['sci-006', 'templates'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['tpl-001', 'template-usage'],
      })
    },
    onError: (error) => {
      if (error instanceof DataClientError) {
        if (error.code === 'template_not_instantiable') {
          setInstantiationError(
            'This template cannot be instantiated. It must be validated and not archived.',
          )
        } else if (error.code === 'permission_denied') {
          setInstantiationError(
            'You do not have permission to instantiate this template.',
          )
        } else {
          setInstantiationError(error.message)
        }
      } else {
        setInstantiationError('Could not instantiate the template. Try again.')
      }
    },
  })

  // TPL-001: archive mutation
  const archiveMutation = useMutation({
    mutationFn: async (params: {
      recordId: string
      expectedMetadataVersion: number
    }) => {
      return archiveTemplate(
        dataClient,
        params.recordId,
        params.expectedMetadataVersion,
      )
    },
    onSuccess: () => {
      setActionError(null)
      void queryClient.invalidateQueries({
        queryKey: ['sci-006', 'templates'],
      })
      void queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.record(selectedId ?? 'none'),
      })
    },
    onError: (error) => {
      if (error instanceof DataClientError) {
        if (error.code === 'SB001') {
          setActionError(
            'This template changed before the action ran. Refresh and try again.',
          )
        } else if (error.code === 'permission_denied' || error.status === 403) {
          setActionError('You do not have permission to archive this template.')
        } else {
          setActionError(error.message)
        }
      } else {
        setActionError('Could not archive the template. Try again.')
      }
    },
  })

  // TPL-001: duplicate mutation
  const duplicateMutation = useMutation({
    mutationFn: async (params: {
      template: NonNullable<typeof selected>
      blocks: typeof selectedBlocks
      targetProjectId: string
      title: string
    }) => {
      return duplicateTemplate(dataClient, params)
    },
    onSuccess: (result) => {
      setActionError(null)
      void queryClient.invalidateQueries({
        queryKey: ['sci-006', 'templates'],
      })
      // Select the newly created draft so the author can review it.
      setSelectedId(result.record.id)
    },
    onError: (error) => {
      if (error instanceof DataClientError) {
        if (error.status === 403 || error.code === 'permission_denied') {
          setActionError(
            'You do not have permission to duplicate this template.',
          )
        } else {
          setActionError(error.message)
        }
      } else {
        setActionError('Could not duplicate the template. Try again.')
      }
    },
  })

  // TPL-001: export — build a JSON blob from the live template + blocks and
  // trigger a browser download. No server round-trip beyond the block fetch
  // the inspector already performs.
  function handleExport() {
    if (!selected) return
    const exported = buildTemplateExport(selected, selectedBlocks)
    const blob = new Blob([JSON.stringify(exported, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${selected.identifier}-template.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  function handleArchive() {
    if (!selected) return
    if (selected.archivedAt) return
    const warning =
      selectedUsageCount > 0
        ? `${selectedUsageCount} ${selectedUsageCount === 1 ? 'record has' : 'records have'} been instantiated from this template. They keep their own copy. Archive anyway?`
        : 'Archive this template? It will no longer be available for new instantiations.'
    if (!window.confirm(warning)) return
    archiveMutation.mutate({
      recordId: selected.id,
      expectedMetadataVersion: selected.metadataVersion,
    })
  }

  function handleDuplicate() {
    if (!selected) return
    if (!selected.projectId) {
      setActionError(
        'This template is not in a project and cannot be duplicated here.',
      )
      return
    }
    duplicateMutation.mutate({
      template: selected,
      blocks: selectedBlocks,
      targetProjectId: selected.projectId,
      title: `${selected.title} (copy)`,
    })
  }

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  const inspector = selected ? (
    <TemplateInspector
      template={selected}
      blocks={selectedBlocks}
      blocksLoading={blocksQuery.isLoading}
      projects={projects}
      onInstantiate={(title, projectId) => {
        setInstantiationSuccess(null)
        instantiateMutation.mutate({
          templateRecordId: selected.id,
          targetProjectId: projectId,
          targetKind: 'experiment',
          title,
        })
      }}
      isInstantiating={instantiateMutation.isPending}
      instantiationError={instantiationError}
      instantiationSuccess={instantiationSuccess}
      usageCount={selectedUsageCount}
      linkedRecords={linkedRecords}
      currentUserId={currentUserId}
      role={role}
      onArchive={handleArchive}
      onDuplicate={handleDuplicate}
      onExport={handleExport}
      isArchiving={archiveMutation.isPending}
      isDuplicating={duplicateMutation.isPending}
      actionError={actionError}
    />
  ) : null

  useShell({
    fullBleed: true,
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Templates' }],
    inspector: inspector,
  })

  return (
    <>
      <div className="space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="size-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Template Library
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Create Notebooks from published CORE-06 templates. Protocol
            templates remain a separate pin-into-Notebook catalogue. Historical
            notebook template records stay readable but are not used for new
            work.
          </p>
        </header>

        <VersionedNotebookTemplatePanel
          workspaceId={workspaceId}
          canEdit={role === 'owner' || role === 'admin' || role === 'steward'}
          projects={projects}
          selectedTemplateId={routeSearch.template ?? null}
          onSelectedTemplateIdChange={setSelectedNotebookTemplateId}
        />

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Protocol templates</h2>
            <p className="text-xs text-muted-foreground">
              Pin a protocol version into a Notebook from this catalogue.
            </p>
          </div>
          <TemplateFilters
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            search={search}
            onSearchChange={setSearch}
            count={templates.length}
            favouritesOnly={favouritesOnly}
            onFavouritesOnlyChange={setFavouritesOnly}
            ownership={ownership}
            onOwnershipChange={setOwnership}
            view={view}
            onViewChange={setView}
          />

          <TemplateList
            templates={templates}
            isLoading={templatesQuery.isLoading}
            error={templatesQuery.error}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRetry={() => templatesQuery.refetch()}
            blockCounts={blockCounts}
            usageCounts={usageCounts}
            view={view}
            favourites={favourites}
            onToggleFavourite={toggleFavourite}
            currentUserId={currentUserId}
            blockPreviews={blockPreviews}
          />
        </section>
      </div>
    </>
  )
}
