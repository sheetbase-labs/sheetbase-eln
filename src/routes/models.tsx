import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Button } from '#/components/v3/ui/button'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  footerCount,
  nameSorts,
  sortByName,
} from '#/components/v3/inventory/list'
import type { NameSort } from '#/components/v3/inventory/list'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  modelStatus,
  modelsQueryKeys,
  useModels,
} from '#/components/v3/models/models-data'
import type { ModelRow } from '#/components/v3/models/models-data'
import {
  ModelCreateDialog,
  describeModelCreateError,
} from '#/components/v3/models/model-create-dialog'
import type { ModelCreateInput } from '#/components/v3/models/model-create-dialog'
import { useWorkspaceMemberNames } from '#/components/v3/projects/project-data'
import { toast } from '#/components/v3/ui/sonner'
import { hasCapability } from '#/lib/capability'
import { createDatasetSchemaDefinition } from '#/lib/dataset-schema-definition-rpc'
import { returnWithContext, safeReturnTo } from '#/lib/create-context-search'
import { notebookDataClient } from '#/lib/notebook-data'
import { returnLabel } from '#/lib/return-to'
import { countOf } from '#/lib/plural'
import { signInRedirect } from '#/lib/sign-in-redirect'

const tabs = ['all', 'published', 'drafts', 'retired'] as const
type ModelTab = (typeof tabs)[number]
const tabLabel: Record<ModelTab, string> = {
  all: 'All',
  published: 'Published',
  drafts: 'Drafts',
  retired: 'Retired',
}

/**
 * Why a role that cannot create is told so rather than shown the control:
 * `api.create_dataset_schema_definition` requires `schema.edit`, which
 * `api.has_capability` grants to owner/admin/steward only.
 */
const CREATE_DENIED_REASON =
  'Your workspace role cannot create models. Ask a workspace owner, admin or steward, or ask them to make you one.'

/** UI port (roadmap-4/ui-app3): the Models board on the canonical dataset
 * schema registry. A model is a schema definition; its fields and versions are
 * its own child routes. */
export const Route = createFileRoute('/models')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    q?: string
    tab?: ModelTab
    selected?: string
    create?: true
    returnTo?: string
  } => ({
    // A page that needs a model sends the person here to make one (`create`)
    // and says where to come back to (`returnTo`).
    create:
      search.create === true || search.create === 'true' ? true : undefined,
    returnTo: safeReturnTo(search.returnTo),
    q: typeof search.q === 'string' ? search.q : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    tab:
      search.tab === 'published' ||
      search.tab === 'drafts' ||
      search.tab === 'retired' ||
      search.tab === 'all'
        ? search.tab
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: ModelsRoute,
})

function ModelsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/models',
  })
  return isIndex ? <ModelsList /> : <Outlet />
}

function inTab(model: ModelRow, tab: ModelTab): boolean {
  if (tab === 'all') return true
  if (tab === 'published')
    return model.lifecycle === 'active' || model.lifecycle === 'published'
  if (tab === 'drafts') return model.lifecycle === 'draft'
  return model.lifecycle === 'retired'
}

/**
 * The version whose fields/datasets the board reports: the published version
 * when one exists, else the newest (marked as the draft it is), so the label
 * and the counts cannot describe different versions.
 */
function modelVersionLabel(model: ModelRow): string {
  const version = model.publishedVersion ?? model.latestVersion
  if (!version) return '—'
  return version.lifecycle === 'published' || version.lifecycle === 'active'
    ? `v${version.version}`
    : `v${version.version} ${version.lifecycle}`
}

function ModelsList() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const openModel = useOpenRow<ModelRow>(
    navigate,
    (row) => `/models/${encodeURIComponent(row.id)}`,
    (row) => row.name,
  )
  const query = useModels()
  const rows = query.data ?? []
  const members = useWorkspaceMemberNames()
  const ownerName = (id: string | null) =>
    id ? (members.data?.get(id) ?? '—') : '—'
  const tab: ModelTab = search.tab ?? 'all'
  const [selected, setSelected] = useState<string | null>(null)
  const [sort, setSort] = useState<NameSort>('Name')
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? null
  // `api.create_dataset_schema_definition` requires schema.edit
  // (`api.require_capability`): the board offers the control only to a role
  // that holds it, and states why when it does not.
  const canCreate = hasCapability(context.workspace?.role, 'schema.edit')
  const [createOpen, setCreateOpen] = useState(
    () => search.create === true && canCreate,
  )
  const create = useMutation({
    mutationFn: async (input: ModelCreateInput) => {
      if (!workspaceId) throw new Error('No active workspace.')
      if (input.kind === 'record') {
        const created = await notebookDataClient.rpc<{ key: string }>(
          'create_workspace_model',
          {
            p_workspace_id: workspaceId,
            p_key: input.key,
            p_name: input.name,
            p_identifier_prefix: input.identifierPrefix,
            p_description: input.description,
          },
        )
        return { routeId: created.key }
      }
      const created = await createDatasetSchemaDefinition(notebookDataClient, {
        workspaceId,
        key: input.key,
        name: input.name,
        description: input.description,
      })
      return { routeId: created.schema_definition_id }
    },
    onSuccess: (created, input) => {
      setCreateOpen(false)
      const back = search.returnTo
      void queryClient.invalidateQueries({ queryKey: modelsQueryKeys.list })
      toast(`Model “${input.name}” created`, {
        description:
          input.kind === 'record'
            ? 'Record type created. Open Versions to define v1, request approval and publish it.'
            : 'v1 is a draft. Add its fields, then publish it.',
        ...(back
          ? {
              action: {
                label: returnLabel(back),
                onClick: () =>
                  void navigate({
                    to: returnWithContext(back, {
                      model: created.routeId,
                    }),
                  } as never),
              },
            }
          : {}),
      })
      // A new definition is a draft, so it belongs to the All tab whatever tab
      // the board is on: show it there and select its row.
      void navigate({
        to: '/models',
        search: (s) => ({
          ...s,
          tab: undefined,
          create: undefined,
          selected: created.routeId,
        }),
        replace: true,
      })
    },
  })

  const counts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((t) => [t, rows.filter((m) => inTab(m, t)).length]),
      ) as Record<ModelTab, number>,
    [rows],
  )
  const q = (search.q ?? '').trim().toLowerCase()
  const visible = sortByName(
    rows
      .filter((m) => inTab(m, tab))
      .filter((m) => !q || `${m.key} ${m.name}`.toLowerCase().includes(q)),
    sort,
    (m) => m.name,
    (m) => m.display_id ?? m.key,
  )
  const sel = visible.find((m) => m.id === (selected ?? search.selected))

  const columns = useMemo<RegistryColumn<ModelRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        cell: ({ row }) => (
          <span className="mono">{row.original.display_id ?? '—'}</span>
        ),
      },
      {
        id: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <Link
            to="/models/$modelId"
            params={{ modelId: row.original.id }}
            onClick={(event) => openModel(row.original, event)}
            className={row.getIsSelected() ? 'font-medium' : undefined}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'kind',
        header: 'Capture structure',
        cell: ({ row }) =>
          row.original.kind === 'record' ? 'Record type' : 'Measurement table',
      },
      {
        id: 'version',
        header: 'Version',
        meta: rightAligned<ModelRow>().meta,
        cell: ({ row }) => modelVersionLabel(row.original),
      },
      {
        id: 'fields',
        header: 'Fields',
        accessorFn: (m) => m.fieldCount,
        meta: rightAligned<ModelRow>().meta,
      },
      {
        id: 'datasets',
        header: 'Used by',
        meta: rightAligned<ModelRow>().meta,
        cell: ({ row }) => (
          <span
            className={
              row.original.datasetCount === 0 ? 'text-fg-muted' : undefined
            }
          >
            {row.original.kind === 'record'
              ? countOf(row.original.recordCount ?? 0, 'record')
              : countOf(row.original.datasetCount, 'dataset')}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = modelStatus(row.original.lifecycle)
          return <Status tone={status.tone}>{status.label}</Status>
        },
      },
      {
        id: 'owner',
        header: 'Owner',
        meta: { cellClassName: 'text-fg-muted' },
        cell: ({ row }) => ownerName(row.original.created_by_user_id),
      },
      {
        id: 'updated',
        header: 'Updated',
        meta: {
          ...rightAligned<ModelRow>().meta,
          cellClassName: 'text-right text-fg-muted',
        },
        cell: ({ row }) => row.original.updated_at.slice(0, 10),
      },
    ],
    [members.data, openModel],
  )

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.id ?? null,
    setSelected,
  )

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Models"
          total={query.isPending ? undefined : rows.length}
          actions={
            canCreate ? (
              <>
                {search.returnTo ? (
                  <Button
                    nativeButton={false}
                    render={<Link to={search.returnTo} />}
                  >
                    {returnLabel(search.returnTo)}
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  onClick={() => {
                    create.reset()
                    setCreateOpen(true)
                  }}
                >
                  New model
                </Button>
              </>
            ) : (
              <p className="m-0 max-w-[320px] text-label text-fg-muted">
                {CREATE_DENIED_REASON}
              </p>
            )
          }
          tabs={
            <Tabs
              mode="url"
              label="Model lists"
              value={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: query.isPending ? undefined : counts[t],
                link: {
                  to: '/models',
                  search: { tab: t === 'all' ? undefined : t, q: search.q },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label="Search models"
          placeholder="Search models by key or name"
          views={{
            sorts: [...nameSorts],
            sort,
            onSort: (s) => setSort(s as NameSort),
          }}
          onSearch={(next) =>
            void navigate({
              to: '/models',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isPending || visible.length > 0 ? (
            <RegistryGrid
              className="max-md:hidden"
              label="Models"
              rows={visible}
              columns={columns}
              getRowId={(m) => m.id}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onRowClick={openModel}
              isLoading={query.isPending}
            />
          ) : null}
          <MobileList
            label="Models"
            items={visible.map((m) => {
              const status = modelStatus(m.lifecycle)
              return {
                key: m.id,
                id: `${m.display_id ?? m.key} · ${modelVersionLabel(m)}`,
                title: m.name,
                sub: `${m.kind === 'record' ? 'Record type' : 'Measurement table'} · ${countOf(m.fieldCount, 'field')} · ${m.kind === 'record' ? countOf(m.recordCount ?? 0, 'record') : countOf(m.datasetCount, 'dataset')} · ${ownerName(m.created_by_user_id)}`,
                status: <Status tone={status.tone}>{status.label}</Status>,
                link: {
                  to: '/models/$modelId',
                  params: { modelId: m.id },
                  onClick: (event: React.MouseEvent) => openModel(m, event),
                },
              }
            })}
          />
          {!query.isPending && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                icon={q ? 'search' : 'table'}
                className="items-center py-14 text-center"
                title={
                  q
                    ? `No models match “${search.q}”`
                    : `No models in ${tabLabel[tab].toLowerCase()}`
                }
                description="Search looks at model keys and names."
                action={
                  q ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link to="/models" search={{ tab: search.tab }} />
                      }
                    >
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : null}
        </div>
        <ListFooter
          loading={query.isPending}
          right={sel ? '1 selected' : undefined}
        >
          {footerCount({
            shown: visible.length,
            total: counts[tab],
            one: 'model',
            tab: tabLabel[tab],
            query: q ? search.q : undefined,
          })}
        </ListFooter>
      </div>

      <ModelCreateDialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next)
          // A refusal belongs to the attempt that earned it; reopening starts
          // from a clean slate rather than showing the last refusal forever.
          if (next) create.reset()
        }}
        onCreate={(input) => create.mutate(input)}
        creating={create.isPending}
        error={describeModelCreateError(create.error)}
      />
    </div>
  )
}
