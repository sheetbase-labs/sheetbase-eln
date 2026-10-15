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
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  SearchTabs,
  stickyCell,
  stickyHead,
} from '#/components/v3/inventory/list'
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
import { notebookDataClient } from '#/lib/notebook-data'

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
  } => ({
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
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
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
  if (tab === 'published') return model.lifecycle === 'active'
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
  return version.lifecycle === 'published'
    ? `v${version.version}`
    : `v${version.version} ${version.lifecycle}`
}

function ModelsList() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const query = useModels()
  const rows = query.data ?? []
  const members = useWorkspaceMemberNames()
  const ownerName = (id: string | null) =>
    id ? (members.data?.get(id) ?? '—') : '—'
  const tab: ModelTab = search.tab ?? 'all'
  const [selected, setSelected] = useState<string | null>(null)
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? null
  // `api.create_dataset_schema_definition` requires schema.edit
  // (`api.require_capability`): the board offers the control only to a role
  // that holds it, and states why when it does not.
  const canCreate = hasCapability(context.workspace?.role, 'schema.edit')
  const [createOpen, setCreateOpen] = useState(false)
  const create = useMutation({
    mutationFn: (input: ModelCreateInput) => {
      if (!workspaceId) throw new Error('No active workspace.')
      return createDatasetSchemaDefinition(notebookDataClient, {
        workspaceId,
        key: input.key,
        name: input.name,
        description: input.description,
      })
    },
    onSuccess: (created, input) => {
      setCreateOpen(false)
      void queryClient.invalidateQueries({ queryKey: modelsQueryKeys.list })
      toast(`Model “${input.name}” created`, {
        description: 'v1 is a draft. Add its fields, then publish it.',
      })
      // A new definition is a draft, so it belongs to the All tab whatever tab
      // the board is on: show it there and select its row.
      void navigate({
        to: '/models',
        search: (s) => ({
          ...s,
          tab: undefined,
          selected: created.schema_definition_id,
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
  const visible = rows
    .filter((m) => inTab(m, tab))
    .filter((m) => !q || `${m.key} ${m.name}`.toLowerCase().includes(q))
  const sel =
    visible.find((m) => m.id === (selected ?? search.selected)) ?? visible.at(0)

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Models"
          total={rows.length}
          actions={
            canCreate ? (
              <Button
                variant="primary"
                onClick={() => {
                  create.reset()
                  setCreateOpen(true)
                }}
              >
                New model
              </Button>
            ) : (
              <p className="m-0 max-w-[320px] text-label text-fg-muted">
                {CREATE_DENIED_REASON}
              </p>
            )
          }
          tabs={
            <SearchTabs
              label="Model lists"
              current={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: counts[t],
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
          onSearch={(next) =>
            void navigate({
              to: '/models',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <Table aria-label="Models" className="max-lg:hidden">
            <TableHeader>
              <TableRow>
                <TableHead className={stickyHead}>ID</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Name</TableHead>
                <TableHead align="right">Version</TableHead>
                <TableHead align="right">Fields</TableHead>
                <TableHead align="right">Datasets</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead align="right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((m) => {
                const status = modelStatus(m.lifecycle)
                return (
                  <TableRow
                    key={m.id}
                    selected={m.id === sel?.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(m.id)}
                  >
                    <TableCell className={stickyCell}>
                      <span className="mono">{m.display_id ?? '—'}</span>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      <span className="mono">{m.key}</span>
                    </TableCell>
                    <TableCell
                      className={m.id === sel?.id ? 'font-medium' : undefined}
                    >
                      <Link
                        to="/models/$modelId"
                        params={{ modelId: m.id }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {m.name}
                      </Link>
                    </TableCell>
                    <TableCell align="right">{modelVersionLabel(m)}</TableCell>
                    <TableCell align="right">{m.fieldCount}</TableCell>
                    <TableCell
                      align="right"
                      className={
                        m.datasetCount === 0 ? 'text-fg-muted' : undefined
                      }
                    >
                      {m.datasetCount}
                    </TableCell>
                    <TableCell>
                      <Status tone={status.tone}>{status.label}</Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {ownerName(m.created_by_user_id)}
                    </TableCell>
                    <TableCell align="right" className="text-fg-muted">
                      {m.updated_at.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <MobileList
            label="Models"
            items={visible.map((m) => {
              const status = modelStatus(m.lifecycle)
              return {
                key: m.id,
                id: `${m.display_id ?? m.key} · ${modelVersionLabel(m)}`,
                title: m.name,
                sub: `${m.fieldCount} fields · ${m.datasetCount} datasets · ${ownerName(m.created_by_user_id)}`,
                status: <Status tone={status.tone}>{status.label}</Status>,
                link: { to: '/models/$modelId', params: { modelId: m.id } },
              }
            })}
          />
          {!query.isLoading && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                icon={q ? 'search' : 'table'}
                className="items-center py-14 text-center"
                title={
                  q
                    ? `No models match “${search.q}”`
                    : `No models in ${tabLabel[tab].toLowerCase()}`
                }
                body="Search looks at model keys and names."
              />
            </div>
          ) : null}
        </div>
        <ListFooter right={sel ? '1 selected' : undefined}>
          {q
            ? `${visible.length} matching “${search.q}” of ${counts[tab]} ${tabLabel[tab].toLowerCase()}`
            : `${visible.length} of ${counts[tab]} ${tabLabel[tab].toLowerCase()}`}
        </ListFooter>
      </div>

      {sel ? (
        <Inspector aria-label="Model details" className="w-[320px] gap-0 p-0">
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">{sel.key}</span>
            <div className="font-heading text-doc font-semibold">
              {sel.name}
            </div>
            <div className="text-label">
              <Status tone={modelStatus(sel.lifecycle).tone}>
                {modelStatus(sel.lifecycle).label}
              </Status>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                nativeButton={false}
                render={
                  <Link to="/models/$modelId" params={{ modelId: sel.id }} />
                }
              >
                Open
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            <InspectorSection title="Details">
              <DescriptionList
                labelWidth={80}
                items={[
                  ['Key', sel.key],
                  ['Version', modelVersionLabel(sel)],
                  ['Fields', String(sel.fieldCount)],
                  ['Datasets', String(sel.datasetCount)],
                  ['Updated', sel.updated_at.slice(0, 10)],
                ]}
              />
            </InspectorSection>
            <InspectorSection title="Versions">
              <div className="flex flex-col text-label">
                {sel.versions.length ? (
                  sel.versions.map((v, i) => (
                    <div
                      key={v.id}
                      className={`grid grid-cols-[40px_1fr_auto] gap-2 py-1.5 ${
                        i < sel.versions.length - 1
                          ? 'border-b border-border-subtle'
                          : ''
                      }`}
                    >
                      <b className="font-medium">v{v.version}</b>
                      <span>{modelStatus(v.lifecycle).label}</span>
                      <span className="text-fg-muted">
                        {v.published_at ? v.published_at.slice(0, 10) : '—'}
                      </span>
                    </div>
                  ))
                ) : (
                  <Muted>No version yet.</Muted>
                )}
              </div>
            </InspectorSection>
            <InspectorSection title="Publishing">
              <Muted>
                Publishing needs approval from a model owner and QA. Existing
                datasets keep the version they were created on.
              </Muted>
            </InspectorSection>
          </div>
        </Inspector>
      ) : null}

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
