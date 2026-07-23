import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { LayoutTemplate } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import {
  TemplateFilters,
  TemplateInspector,
  TemplateList,
} from '#/components/templates/template-library'
import type { TemplateProject } from '#/components/templates/template-library'
import { createDataClient, DataClientError } from '#/lib/data-client'
import {
  fetchBlocksForRecord,
  fetchRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import {
  fetchTemplates,
  instantiateTemplate,
  templateQueryKeys,
} from '#/lib/templates'
import type { TemplateKind, TargetKind } from '#/lib/templates'

/**
 * SCI-006: Template Library. Lists notebook and protocol templates with
 * type/status/search filters, a read-only preview inspector, and a
 * use-template action that instantiates a new record from the selected
 * template version.
 *
 * Templates are ordinary records (kind `protocol_template` or
 * `notebook_template`). The list, filters, preview and instantiation all go
 * through the same `/api/db` boundary and RLS as every other record.
 */

const getTemplateContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    return getCurrentContext(getRequestHeaders())
  },
)

export const Route = createFileRoute('/templates')({
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
  const queryClient = useQueryClient()

  // Filters
  const [kindFilter, setKindFilter] = useState<'all' | TemplateKind>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [instantiationError, setInstantiationError] = useState<string | null>(
    null,
  )
  const [instantiationSuccess, setInstantiationSuccess] = useState<{
    recordId: string
    projectId: string
  } | null>(null)

  // Template list query
  const templatesQuery = useQuery({
    queryKey: templateQueryKeys.list({
      kind: kindFilter !== 'all' ? kindFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      search,
      includeArchived: true,
    }),
    queryFn: async () => {
      return fetchTemplates(notebookDataClient, {
        kind: kindFilter !== 'all' ? kindFilter : undefined,
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

  const templates = templatesQuery.data ?? []
  const selected = selectedQuery.data ?? null
  const selectedBlocks = blocksQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const blockCounts = blockCountsQuery.data ?? {}

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
    />
  ) : null

  return (
    <AppShell
      context={shellContext}
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Templates' }]}
      inspector={inspector}
    >
      <div className="space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="size-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Template Library
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Browse validated notebook and protocol templates. Use a template to
            create a new record with pre-filled content.
          </p>
        </header>

        <TemplateFilters
          kindFilter={kindFilter}
          onKindChange={setKindFilter}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          search={search}
          onSearchChange={setSearch}
          count={templates.length}
        />

        <TemplateList
          templates={templates}
          isLoading={templatesQuery.isLoading}
          error={templatesQuery.error}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRetry={() => templatesQuery.refetch()}
          blockCounts={blockCounts}
        />
      </div>
    </AppShell>
  )
}
