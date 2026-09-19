import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useMemo, useState } from 'react'

import { useShell } from '#/components/app-shell'
import { PageHeader } from '#/components/ui'
import { TemplateInspector } from '#/components/templates/template-library'
import {
  NotebookTemplateInspector,
  UnifiedTemplateFilters,
  UnifiedTemplateTable,
} from '#/components/templates/unified-template-list'
import type {
  UnifiedTemplateRow,
  UnifiedTemplateStatusFilter,
  UnifiedTemplateStatusKey,
  UnifiedTemplateTypeFilter,
} from '#/components/templates/unified-template-list'
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
import {
  derivePurposeFacets,
  matchesNotebookTemplateNeeds,
  matchesPurposeFacet,
  protocolLifecycleState,
  summarizeNotebookTemplateRequirements,
} from '#/lib/reuse-discovery'
import type { NotebookTemplateNeedsFilter } from '#/lib/reuse-discovery'
import {
  fetchAllNotebookTemplateVersions,
  fetchNotebookTemplates,
  notebookTemplateDataClient,
} from '#/lib/notebook-template-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { listInIdChunks } from '#/lib/postgrest-in-list'
import { useFavouritesList, useSetFavourite } from '#/lib/favourites'
import { useRecentViewTracking } from '#/lib/recents'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'

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
  staticData: { shellFullBleed: true },
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
  const [statusFilter, setStatusFilter] =
    useState<UnifiedTemplateStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<UnifiedTemplateTypeFilter>('all')
  const [ownership, setOwnership] = useState<TemplateOwnershipFilter>('all')
  const [favouritesOnly, setFavouritesOnly] = useState(false)
  const [purposeFilter, setPurposeFilter] = useState('all')
  const [needsFilter, setNeedsFilter] =
    useState<NotebookTemplateNeedsFilter>('all')
  const [view, setView] = useState<TemplateView>('list')
  const selectedId = routeSearch.protocol ?? null
  const selectedNotebookId = routeSearch.template ?? null
  const [instantiationError, setInstantiationError] = useState<string | null>(
    null,
  )
  const [instantiationSuccess, setInstantiationSuccess] = useState<{
    recordId: string
    projectId: string
  } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notebookInstantiateRequest, setNotebookInstantiateRequest] = useState<{
    versionId: string
    nonce: number
  } | null>(null)

  // Selecting a unified row navigates to the catalogue-specific deep link so
  // ?template= and ?protocol= URLs keep working for both types.
  function selectRow(row: UnifiedTemplateRow) {
    void navigate({
      to: '/templates',
      search:
        row.type === 'protocol'
          ? { template: undefined, protocol: row.id }
          : { template: row.id, protocol: undefined },
      replace: false,
    })
  }

  function setSelectedId(id: string | null) {
    void navigate({
      to: '/templates',
      search: { template: undefined, protocol: id ?? undefined },
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

  // Template list query. "archived" is an effective lifecycle state, not a
  // record status, so it filters client-side below (includeArchived fetches
  // everything); other statuses filter server-side as before.
  const serverStatus =
    statusFilter !== 'all' && statusFilter !== 'archived'
      ? statusFilter
      : undefined
  const templatesQuery = useQuery({
    queryKey: templateQueryKeys.list({
      kind: 'protocol_template',
      status: serverStatus,
      search,
      includeArchived: true,
    }),
    queryFn: async () => {
      return fetchTemplates(notebookDataClient, {
        kind: 'protocol_template',
        status: serverStatus,
        search,
        includeArchived: true,
      })
    },
  })

  // Canonical notebook template catalogue (TPL-001): the second data source
  // for the unified table. `search` is shared with the protocol catalogue so
  // the single filter box queries both.
  const notebookTemplatesQuery = useQuery({
    queryKey: ['notebook-templates', workspaceId, search],
    queryFn: () =>
      fetchNotebookTemplates(notebookTemplateDataClient, {
        search,
        limit: 100,
      }),
  })
  const notebookVersionsQuery = useQuery({
    queryKey: ['notebook-template-versions'],
    queryFn: () => fetchAllNotebookTemplateVersions(notebookTemplateDataClient),
  })

  const notebookVersions = notebookVersionsQuery.data ?? []
  const versionsByTemplate = useMemo(() => {
    const map = new Map<string, NotebookTemplateVersion[]>()
    for (const version of notebookVersions) {
      const list = map.get(version.templateId) ?? []
      list.push(version)
      map.set(version.templateId, list)
    }
    return map
  }, [notebookVersions])

  // Notebook-template usage: instantiated notebooks pin
  // source_notebook_template_version_id, so counting records per version id
  // and mapping back through the template's versions gives the Used column.
  const notebookUsageQuery = useQuery({
    queryKey: ['tpl-001', 'notebook-template-usage', notebookVersions.length],
    queryFn: async () => {
      const versionIds = notebookVersions.map((version) => version.id)
      if (versionIds.length === 0) return {}
      const rows = await listInIdChunks<{
        source_notebook_template_version_id: string
      }>(
        notebookDataClient,
        'records',
        versionIds,
        (idFilter) =>
          `?source_notebook_template_version_id=in.(${idFilter})&select=source_notebook_template_version_id`,
      )
      const templateByVersion = new Map<string, string>()
      for (const version of notebookVersions) {
        templateByVersion.set(version.id, version.templateId)
      }
      const counts: Record<string, number> = {}
      for (const row of rows) {
        const templateId = templateByVersion.get(
          row.source_notebook_template_version_id,
        )
        if (templateId) counts[templateId] = (counts[templateId] ?? 0) + 1
      }
      return counts
    },
    enabled: notebookVersions.length > 0,
  })

  // Server-side favourites (FIND-02) cover the notebook catalogue; protocol
  // templates keep their per-user localStorage favourites list.
  const serverFavouritesQuery = useFavouritesList()
  const setFavouriteMutation = useSetFavourite()

  // Block counts for every listed template, fetched in a single query so
  // the list can show a "blocks" column without N+1 requests. Selects only
  // record_id to keep the payload small.
  const templateIds = (templatesQuery.data ?? []).map((t) => t.id)
  const blockCountsQuery = useQuery({
    queryKey: ['sci-006', 'template-block-counts', templateIds],
    queryFn: async () => {
      const rows = await listInIdChunks<{ record_id: string }>(
        notebookDataClient,
        'blocks',
        templateIds,
        (idFilter) => `?record_id=in.(${idFilter})&select=record_id`,
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
      const rows = await listInIdChunks<{ target_record_id: string }>(
        notebookDataClient,
        'record_links',
        templateIds,
        (idFilter) =>
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
      const rows = await listInIdChunks<BlockWire>(
        notebookDataClient,
        'blocks',
        templateIds,
        (idFilter) =>
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
      const rows = await listInIdChunks<RecordWire>(
        notebookDataClient,
        'records',
        ids,
        (idFilter) =>
          `?id=in.(${idFilter})&select=id,identifier,title,kind,status,project_id`,
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

  // Apply client-side filters: ownership + favourites + purpose + archived
  // lifecycle (server filters handle kind/status/search). Ownership uses the
  // current user id; the records endpoint does not expose a
  // created_by_user_id filter via the proxy list helper without a join, so
  // filter in the browser — the template count is bounded by workspace size.
  // Purpose options come from the tag vocabulary in use across the fetched
  // templates, so the facet updates with the result set.
  const allTemplates = templatesQuery.data ?? []
  const purposeOptions = useMemo(
    () => derivePurposeFacets(allTemplates),
    [allTemplates],
  )
  const notebookTemplates = notebookTemplatesQuery.data ?? []
  const notebookUsage = notebookUsageQuery.data ?? {}
  const serverFavourites = serverFavouritesQuery.data ?? []

  // REUSE-01: latest-version requirement summaries back the unified Needs
  // facet and the Blocks column, mirroring the notebook catalogue panel.
  const summariesByTemplate = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof summarizeNotebookTemplateRequirements> | null
    >()
    for (const template of notebookTemplates) {
      const latest = versionsByTemplate.get(template.id)?.[0] ?? null
      map.set(
        template.id,
        latest
          ? summarizeNotebookTemplateRequirements(latest.configuration)
          : null,
      )
    }
    return map
  }, [notebookTemplates, versionsByTemplate])

  const notebookFavouriteIds = useMemo(
    () =>
      new Set(
        serverFavourites
          .filter((f) => f.kind === 'notebook_template')
          .map((f) => f.id),
      ),
    [serverFavourites],
  )

  function isRowFavourite(row: UnifiedTemplateRow): boolean {
    return row.type === 'protocol'
      ? favourites.has(row.id)
      : notebookFavouriteIds.has(row.id)
  }

  function toggleRowFavourite(row: UnifiedTemplateRow) {
    if (row.type === 'protocol') {
      toggleFavourite(row.id)
      return
    }
    setFavouriteMutation.mutate({
      kind: 'notebook_template',
      objectId: row.id,
      favourite: !isRowFavourite(row),
    })
  }

  const selected = selectedQuery.data ?? null
  const selectedBlocks = blocksQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const blockCounts = blockCountsQuery.data ?? {}
  const usageCounts = usageCountsQuery.data ?? {}
  const blockPreviews = blockPreviewsQuery.data ?? {}
  const linkedRecords = linkedRecordsQuery.data ?? []
  const selectedUsageCount = selected ? (usageCounts[selected.id] ?? 0) : 0

  // Unified rows: both catalogues normalised onto the shared column model.
  // Purpose facets only exist on protocol rows and needs facets only on
  // notebook rows, so setting one scopes the table to the catalogue that
  // can answer it.
  const unifiedRows = useMemo<UnifiedTemplateRow[]>(() => {
    const rows: UnifiedTemplateRow[] = []
    for (const record of allTemplates) {
      rows.push({
        type: 'protocol',
        record,
        id: record.id,
        identifier: record.identifier,
        title: record.title,
        subline:
          record.tags.length > 0 ? record.tags.slice(0, 3).join(' · ') : null,
        versionLabel: `v${record.metadataVersion}`,
        statusKey: protocolLifecycleState(record) as UnifiedTemplateStatusKey,
        blocks: blockCounts[record.id] ?? null,
        used: usageCounts[record.id] ?? 0,
        updatedAt: record.updatedAt,
        ownerId: record.createdByUserId,
      })
    }
    for (const template of notebookTemplates) {
      const versions = versionsByTemplate.get(template.id) ?? []
      const latest = versions.at(0) ?? null
      const summary = summariesByTemplate.get(template.id) ?? null
      rows.push({
        type: 'notebook',
        template,
        latest,
        id: template.id,
        identifier: template.key,
        title: template.name,
        subline: template.description,
        versionLabel: latest ? `v${latest.version}` : '—',
        statusKey: (latest?.lifecycle ??
          (template.lifecycle === 'retired'
            ? 'retired'
            : 'draft')) as UnifiedTemplateStatusKey,
        blocks: summary ? summary.placements.total : null,
        used: notebookUsage[template.id] ?? 0,
        updatedAt: template.updatedAt,
        ownerId: latest?.createdByUserId ?? null,
      })
    }
    return rows
      .filter((row) => {
        if (typeFilter !== 'all' && row.type !== typeFilter) return false
        if (statusFilter !== 'all' && row.statusKey !== statusFilter)
          return false
        if (
          purposeFilter !== 'all' &&
          (row.type !== 'protocol' ||
            !matchesPurposeFacet(row.record.tags, purposeFilter))
        )
          return false
        if (needsFilter !== 'all') {
          if (row.type !== 'notebook') return false
          const summary = summariesByTemplate.get(row.id)
          if (!summary || !matchesNotebookTemplateNeeds(summary, needsFilter))
            return false
        }
        if (ownership === 'mine' && row.ownerId !== currentUserId) return false
        if (favouritesOnly && !isRowFavourite(row)) return false
        return true
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [
    allTemplates,
    notebookTemplates,
    versionsByTemplate,
    summariesByTemplate,
    notebookUsage,
    blockCounts,
    usageCounts,
    typeFilter,
    statusFilter,
    purposeFilter,
    needsFilter,
    ownership,
    favouritesOnly,
    favourites,
    notebookFavouriteIds,
    currentUserId,
  ])

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

  const selectedNotebookTemplate = selectedNotebookId
    ? (notebookTemplates.find((t) => t.id === selectedNotebookId) ?? null)
    : null

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
      blockCount={blockCounts[selected.id]}
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
  ) : selectedNotebookTemplate ? (
    <NotebookTemplateInspector
      template={selectedNotebookTemplate}
      versions={versionsByTemplate.get(selectedNotebookTemplate.id) ?? []}
      usedCount={notebookUsage[selectedNotebookTemplate.id] ?? 0}
      currentUserId={currentUserId}
      canEdit={role === 'owner' || role === 'admin' || role === 'steward'}
      onInstantiate={(versionId) =>
        setNotebookInstantiateRequest({
          versionId,
          nonce: Date.now(),
        })
      }
      // FIND-02: star the selected canonical notebook template.
      headerActions={
        <FavouriteToggle
          kind="notebook_template"
          objectId={selectedNotebookId}
        />
      }
    />
  ) : null

  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Templates' }],
    inspector: inspector,
  })

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
        <PageHeader
          title="Template Library"
          description="Start a notebook from a published template, or add a reusable protocol."
        />

        <UnifiedTemplateFilters
          search={search}
          onSearchChange={setSearch}
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          ownership={ownership}
          onOwnershipChange={setOwnership}
          favouritesOnly={favouritesOnly}
          onFavouritesOnlyChange={setFavouritesOnly}
          view={view}
          onViewChange={setView}
          purposeFilter={purposeFilter}
          onPurposeChange={setPurposeFilter}
          purposeOptions={purposeOptions}
          needsFilter={needsFilter}
          onNeedsChange={setNeedsFilter}
          count={unifiedRows.length}
        />

        <UnifiedTemplateTable
          rows={unifiedRows}
          isLoading={
            templatesQuery.isLoading ||
            notebookTemplatesQuery.isLoading ||
            notebookVersionsQuery.isLoading
          }
          error={templatesQuery.error ?? notebookTemplatesQuery.error}
          onRetry={() => {
            void templatesQuery.refetch()
            void notebookTemplatesQuery.refetch()
            void notebookVersionsQuery.refetch()
          }}
          selectedId={selectedId ?? selectedNotebookId}
          onSelect={selectRow}
          isFavourite={isRowFavourite}
          onToggleFavourite={toggleRowFavourite}
          view={view}
          blockPreviews={blockPreviews}
        />

        {/*
          TPL-001: the unified table replaces the two catalogue lists, but the
          notebook template workspace (version history, builder, upgrade and
          the instantiate dialog) stays inline below it for the selected
          notebook template. Protocol detail lives in the inspector.
        */}
        <VersionedNotebookTemplatePanel
          mode="detail"
          workspaceId={workspaceId}
          canEdit={role === 'owner' || role === 'admin' || role === 'steward'}
          projects={projects}
          selectedTemplateId={selectedNotebookId}
          onSelectedTemplateIdChange={(id) =>
            void navigate({
              to: '/templates',
              search: { template: id ?? undefined, protocol: undefined },
              replace: false,
            })
          }
          instantiateRequest={notebookInstantiateRequest}
        />
      </div>
    </>
  )
}
