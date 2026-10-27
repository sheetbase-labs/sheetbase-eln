import { useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
} from '#/components/v3/inventory/list'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { ProjectListFailure } from '#/components/v3/projects/project-list'
import { Tabs } from '#/components/v3/ui/tabs'
import { toast } from '#/components/v3/ui/sonner'
import { createPipelineDefinition } from '#/lib/pipelines/data'
import { suggestPipelineKey } from '#/lib/pipelines/authoring'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import {
  pipelineDataQueryKeys,
  definitionStatus,
  runStatus,
  usePipelineRows,
  versionStatus,
} from '#/components/v3/pipelines/pipelines-data'
import type { PipelineListRow } from '#/components/v3/pipelines/pipelines-data'
import { useRunLauncher } from '#/components/v3/pipelines/use-run-launcher'
import { signInRedirect } from '#/lib/sign-in-redirect'

const tabs = ['all', 'mine', 'needsattention', 'scheduled', 'drafts'] as const
type PipelineTab = (typeof tabs)[number]
const tabLabel: Record<PipelineTab, string> = {
  all: 'All',
  mine: 'Mine',
  needsattention: 'Needs attention',
  scheduled: 'Scheduled',
  drafts: 'Drafts',
}

/** UI port (roadmap-4/ui-app3): the Pipelines board on the AUTO-01/02/03
 * registry. Runs start through api.start_pipeline_run. */
export const Route = createFileRoute('/pipelines')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; tab?: PipelineTab; selected?: string } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    tab: (tabs as readonly string[]).includes(search.tab as string)
      ? (search.tab as PipelineTab)
      : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: PipelinesRoute,
})

function PipelinesRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/pipelines',
  })
  return isIndex ? <PipelinesList /> : <Outlet />
}

function inTab(
  p: PipelineListRow,
  tab: PipelineTab,
  scheduledIds: Set<string>,
  currentUserId: string,
): boolean {
  if (tab === 'all') return true
  if (tab === 'mine') return p.created_by_user_id === currentUserId
  if (tab === 'needsattention')
    return p.lastRun?.status === 'failed' || p.lastRun?.status === 'waiting'
  if (tab === 'scheduled') return scheduledIds.has(p.id)
  return Boolean(p.draft)
}

function PipelinesList() {
  // Re-render when the person's time zone is applied or changed.
  useDisplayTimeZone()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const query = usePipelineRows()
  const rows = query.data ?? []
  const tab: PipelineTab = search.tab ?? 'all'
  const currentUserId = context.user.id
  // The selected pipeline lives in the URL (`?selected=`) like the rest of the
  // page's state, so a selection is shareable and survives a refresh. With no
  // selection the inspector falls back to the first visible pipeline.
  const selectedId = search.selected

  const schedules = useQuery({
    queryKey: ['ui-port', 'pipelines', 'scheduled-list'],
    queryFn: () =>
      notebookDataClient.list<{ definition_id: string; enabled: boolean }>(
        'pipeline_schedules',
        '?enabled=eq.true&select=definition_id,enabled',
      ),
  })
  const scheduledIds = useMemo<Set<string>>(
    () =>
      new Set(
        (schedules.data ?? []).map(
          (s: { definition_id: string }) => s.definition_id,
        ),
      ),
    [schedules.data],
  )

  const counts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((t) => [
          t,
          rows.filter((p) => inTab(p, t, scheduledIds, currentUserId)).length,
        ]),
      ) as Record<PipelineTab, number>,
    [rows, scheduledIds, currentUserId],
  )
  const q = (search.q ?? '').trim().toLowerCase()
  const visible = rows
    .filter((p) => inTab(p, tab, scheduledIds, currentUserId))
    .filter(
      (p) =>
        !q ||
        `${p.display_id ?? ''} ${p.key} ${p.name}`.toLowerCase().includes(q),
    )
  const sel = visible.find((p) => p.id === selectedId) ?? visible.at(0)
  // The footer claims a selection only when the URL names one that is on screen.
  const selectedRow = visible.find((p) => p.id === selectedId)

  const columns = useMemo<RegistryColumn<PipelineListRow>[]>(
    () => [
      {
        id: 'key',
        header: 'ID',
        cell: ({ row }) => (
          <span className="mono">
            {row.original.display_id ?? row.original.key}
          </span>
        ),
      },
      {
        id: 'name',
        header: 'Pipeline',
        cell: ({ row }) => (
          <Link
            to="/pipelines/$pipelineId"
            params={{ pipelineId: row.original.id }}
            onClick={(event) => event.stopPropagation()}
            className={row.getIsSelected() ? 'font-medium' : undefined}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'version',
        header: 'Version',
        cell: ({ row }) => (
          <>
            {row.original.current ? `v${row.original.current.version}` : '—'}
            {row.original.draft &&
            row.original.current?.lifecycle === 'published' ? (
              <span className="text-fg-muted">
                {' '}
                · v{row.original.draft.version} draft
              </span>
            ) : null}
          </>
        ),
      },
      {
        id: 'runs',
        header: 'Runs',
        accessorFn: (p) => p.runCount,
        meta: rightAligned<PipelineListRow>().meta,
      },
      {
        id: 'lastRun',
        header: 'Last run',
        cell: ({ row }) => {
          const last = row.original.lastRun
          const lastStatus = last ? runStatus(last.status) : null
          return lastStatus ? (
            <Status tone={lastStatus.tone}>{lastStatus.label}</Status>
          ) : (
            <Status tone="draft">Never run</Status>
          )
        },
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = definitionStatus(
            row.original.lifecycle,
            row.original.versions,
          )
          return <Status tone={status.tone}>{status.label}</Status>
        },
      },
    ],
    [],
  )

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.id ?? null,
    (id) =>
      void navigate({
        to: '/pipelines',
        search: (s) => ({ ...s, selected: id ?? undefined }),
        replace: true,
      }),
  )

  const run = useRunLauncher(
    workspaceId,
    (started) =>
      void navigate({
        to: '/pipelines/runs/$runId',
        params: { runId: started.id },
      }),
  )

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Pipelines"
          total={query.isError ? undefined : rows.length}
          actions={
            <>
              <NewPipeline workspaceId={workspaceId} />
              <Button
                variant="quiet"
                size="sm"
                nativeButton={false}
                icon="pipeline"
                render={<Link to="/pipelines/agents" />}
              >
                Agent operations (experimental)
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label="Pipeline lists"
              value={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: query.isLoading ? undefined : counts[t],
                link: {
                  to: '/pipelines',
                  search: { tab: t === 'all' ? undefined : t, q: search.q },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label="Search pipelines"
          placeholder="Search pipelines"
          onSearch={(next) =>
            void navigate({
              to: '/pipelines',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isError ? (
            <div className="px-4 py-4">
              <ProjectListFailure
                error={query.error}
                what="pipelines"
                onRetry={() => void query.refetch()}
              />
            </div>
          ) : null}
          {!query.isError && (query.isLoading || visible.length > 0) ? (
            <RegistryGrid
              className="max-md:hidden"
              label="Pipelines"
              rows={visible}
              columns={columns}
              getRowId={(p) => p.id}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              isLoading={query.isLoading}
            />
          ) : null}
          <MobileList
            label="Pipelines"
            items={visible.map((p) => {
              const lastStatus = p.lastRun ? runStatus(p.lastRun.status) : null
              return {
                key: p.id,
                id: p.display_id ?? p.key,
                title: p.name,
                sub: `${p.current ? `v${p.current.version}` : 'no version'} · ${p.runCount} runs`,
                status: lastStatus ? (
                  <Status tone={lastStatus.tone}>{lastStatus.label}</Status>
                ) : (
                  <Status tone="draft">Never run</Status>
                ),
                link: {
                  to: '/pipelines/$pipelineId',
                  params: { pipelineId: p.id },
                },
              }
            })}
          />
          {!query.isLoading && !query.isError && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                className="w-full py-8"
                title={
                  q
                    ? `No pipelines match “${search.q}”`
                    : `No pipelines in ${tabLabel[tab].toLowerCase()}`
                }
                description={
                  rows.length === 0
                    ? 'Create a pipeline, author SQL or Python steps, then publish a version to run manually or automatically. Dataset inputs and output are optional.'
                    : 'Search looks at pipeline keys and names.'
                }
                action={
                  rows.length === 0 && !q ? (
                    <NewPipeline workspaceId={workspaceId} />
                  ) : q ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link to="/pipelines" search={{ tab: search.tab }} />
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
        <ListFooter right={selectedRow ? '1 selected' : undefined}>
          {visible.length} of {counts[tab]} {tabLabel[tab].toLowerCase()} · a
          pipeline keeps nothing unless its outputs say so
        </ListFooter>
      </div>

      {sel ? (
        <Inspector
          aria-label="Pipeline details"
          className="w-[320px] gap-0 p-0"
        >
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">
              {sel.display_id ?? sel.key} ·{' '}
              {sel.current ? `v${sel.current.version}` : 'no version'}
            </span>
            <div className="font-heading text-doc font-semibold">
              {sel.name}
            </div>
            {sel.description ? (
              <p className="m-0 text-label leading-[18px]">{sel.description}</p>
            ) : null}
            <div className="mt-1.5 flex gap-1.5">
              <Button
                variant="primary"
                size="sm"
                icon="play"
                disabled={
                  !sel.current ||
                  sel.current.lifecycle !== 'published' ||
                  run.pending
                }
                onClick={() =>
                  sel.current &&
                  run.launch({ pipelineName: sel.name, version: sel.current })
                }
              >
                Run now
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to="/pipelines/$pipelineId"
                    params={{ pipelineId: sel.id }}
                  />
                }
              >
                Open
              </Button>
            </div>
            {sel.current?.lifecycle !== 'published' ? (
              <Muted className="mt-1">
                Publish a version in Steps to enable runs.
              </Muted>
            ) : null}
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            <InspectorSection title="Details">
              <DescriptionList
                labelWidth={80}
                items={[
                  ['Key', sel.key],
                  [
                    'Current',
                    sel.current
                      ? `v${sel.current.version} · ${versionStatus(sel.current.lifecycle).label}`
                      : '—',
                  ],
                  ['Versions', String(sel.versions.length)],
                  ['Runs', String(sel.runCount)],
                ]}
              />
            </InspectorSection>
            <InspectorSection title="Recent runs">
              {sel.lastRun ? (
                <Link
                  to="/pipelines/$pipelineId/runs/$runId"
                  params={{ pipelineId: sel.id, runId: sel.lastRun.id }}
                  className="text-label"
                >
                  <Status tone={runStatus(sel.lastRun.status).tone}>
                    {runStatus(sel.lastRun.status).label}
                  </Status>{' '}
                  <span className="num text-fg-muted">
                    {formatNotebookDateTime(sel.lastRun.started_at, {
                      zone: true,
                    })}
                  </span>
                </Link>
              ) : (
                <Muted>Never run.</Muted>
              )}
            </InspectorSection>
          </div>
        </Inspector>
      ) : null}
      {run.dialog}
    </div>
  )
}

/** AUTO-01: register a Pipeline Definition. The new definition has no version
 * yet — its steps editor authors the first one — so creating it lands on the
 * pipeline's own page rather than pretending there is something to run. */
function NewPipeline({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const empty = { key: '', name: '', description: '' }
  const [f, setF] = useState(empty)
  // The key follows the name until someone types their own.
  const [keyTouched, setKeyTouched] = useState(false)

  // The database's own rule for `pipeline_definitions.key`.
  const errors = {
    key: /^[a-z][a-z0-9_]{0,59}$/.test(f.key.trim())
      ? null
      : 'Start with a lowercase letter; then lowercase letters, digits and underscores only.',
    name: f.name.trim() ? null : 'Enter the name people will see.',
  }
  const keyError = tried ? errors.key : null
  const nameError = tried ? errors.name : null
  const create = useMutation({
    mutationFn: () =>
      createPipelineDefinition(notebookDataClient, {
        workspaceId,
        key: f.key.trim(),
        name: f.name.trim(),
        description: f.description.trim() || null,
      }),
    onSuccess: (definition) => {
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.list,
      })
      setOpen(false)
      setF(empty)
      setKeyTouched(false)
      setTried(false)
      toast(`${definition.name} created`, {
        description:
          'Configure the first draft in Steps, try it, then publish it to enable runs.',
      })
      void navigate({
        to: '/pipelines/$pipelineId',
        params: { pipelineId: definition.id },
      })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      setServerError(
        /duplicate key/i.test(message)
          ? 'Another pipeline already uses this key.'
          : message || 'The database refused it.',
      )
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setF(empty)
          setKeyTouched(false)
          setTried(false)
          setServerError(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="primary" icon="plus" />}>
        New pipeline
      </DialogTrigger>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="New pipeline"
          description="Name the pipeline first. Next, configure SQL or Python steps here or through the SDK. Inputs and dataset output are optional."
        />
        <DialogBody>
          <Field label="Name" required error={nameError}>
            <Input
              autoFocus
              value={f.name}
              aria-invalid={nameError ? true : undefined}
              onChange={(e) =>
                setF({
                  ...f,
                  name: e.target.value,
                  key: keyTouched ? f.key : suggestPipelineKey(e.target.value),
                })
              }
              placeholder="e.g. Plate reader PR-01 export"
            />
          </Field>
          <Field
            label="Key"
            required
            error={keyError}
            hint="Suggested from the name. Used in run logs and the API; it cannot change later."
          >
            <Input
              className="mono"
              value={f.key}
              aria-invalid={keyError ? true : undefined}
              onChange={(e) => {
                setF({ ...f, key: e.target.value })
                setKeyTouched(true)
                setServerError(null)
              }}
            />
          </Field>
          <Field label="Description" hint="Optional">
            <Input
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
          {serverError ? <Notice tone="bad">{serverError}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => {
              setTried(true)
              if (Object.values(errors).some(Boolean)) return
              create.mutate()
            }}
          >
            {create.isPending ? 'Creating…' : 'Create pipeline'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
