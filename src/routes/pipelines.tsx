import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { hasCapability } from '#/lib/capability'
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
  ReadOnlyNote,
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
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { useRunLauncher } from '#/components/v3/pipelines/use-run-launcher'
import { signInRedirect } from '#/lib/sign-in-redirect'

const tabs = ['all', 'mine', 'needsattention', 'scheduled', 'drafts'] as const
type PipelineTab = (typeof tabs)[number]
const tabLabel: Record<PipelineTab, string> = {
  all: t('data.pipelinesList.all'),
  mine: t('data.pipelinesList.mine'),
  needsattention: t('data.pipelinesList.needsAttention'),
  scheduled: t('data.pipelinesList.scheduled'),
  drafts: t('data.pipelinesList.drafts'),
}

/** UI port (roadmap-4/ui-app3): the Pipelines board on the AUTO-01/02/03
 * registry. Runs start through api.start_pipeline_run. */
export const Route = createFileRoute('/pipelines')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; tab?: PipelineTab; selected?: string; new?: true } => ({
    new: search.new === true || search.new === 'true' ? true : undefined,
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
  const canManage = hasCapability(context.workspace?.role, 'pipelines.manage')
  const workspaceId = context.workspace?.id ?? ''
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const dropNewFlag = useCallback(() => {
    void navigate({
      search: (current) => ({ ...current, new: undefined }),
      replace: true,
    })
  }, [navigate])
  const query = usePipelineRows()
  const rows = query.data ?? []
  const tab: PipelineTab = search.tab ?? 'all'
  const [sort, setSort] = useState<NameSort>('Name')
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
        tabs.map((tabId) => [
          tabId,
          rows.filter((p) => inTab(p, tabId, scheduledIds, currentUserId))
            .length,
        ]),
      ) as Record<PipelineTab, number>,
    [rows, scheduledIds, currentUserId],
  )
  const q = (search.q ?? '').trim().toLowerCase()
  const visible = sortByName(
    rows
      .filter((p) => inTab(p, tab, scheduledIds, currentUserId))
      .filter(
        (p) =>
          !q ||
          `${p.display_id ?? ''} ${p.key} ${p.name}`.toLowerCase().includes(q),
      ),
    sort,
    (p) => p.name,
    (p) => p.display_id ?? p.key,
  )
  const sel = visible.find((p) => p.id === selectedId) ?? visible.at(0)
  // The footer claims a selection only when the URL names one that is on screen.
  const selectedRow = visible.find((p) => p.id === selectedId)

  const openPipeline = useOpenRow<PipelineListRow>(
    navigate,
    (row) => `/pipelines/${encodeURIComponent(row.id)}`,
    (row) => row.name,
  )

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
        header: t('data.pipelinesList.pipeline'),
        cell: ({ row }) => (
          <Link
            to="/pipelines/$pipelineId"
            params={{ pipelineId: row.original.id }}
            onClick={(event) => openPipeline(row.original, event)}
            className={row.getIsSelected() ? 'font-medium' : undefined}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'version',
        header: t('data.pipelinesList.version'),
        cell: ({ row }) => (
          <>
            {row.original.current ? `v${row.original.current.version}` : '—'}
            {row.original.draft &&
            row.original.current?.lifecycle === 'published' ? (
              <span className="text-fg-muted">
                {' · '}
                {t('data.pipelinesList.draftVersion', {
                  version: row.original.draft.version,
                })}
              </span>
            ) : null}
          </>
        ),
      },
      {
        id: 'runs',
        header: t('data.pipelinesList.runs'),
        accessorFn: (p) => p.runCount,
        meta: rightAligned<PipelineListRow>().meta,
      },
      {
        id: 'lastRun',
        header: t('data.pipelinesList.lastRun'),
        cell: ({ row }) => {
          const last = row.original.lastRun
          const lastStatus = last ? runStatus(last.status) : null
          return lastStatus ? (
            <Status tone={lastStatus.tone}>{lastStatus.label}</Status>
          ) : (
            <Status tone="draft">{t('data.pipelinesList.neverRun')}</Status>
          )
        },
      },
      {
        id: 'status',
        header: t('data.pipelinesList.status'),
        cell: ({ row }) => {
          const status = definitionStatus(
            row.original.lifecycle,
            row.original.versions,
          )
          return <Status tone={status.tone}>{status.label}</Status>
        },
      },
    ],
    [openPipeline],
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
          title={t('data.pipelinesList.pipelines')}
          total={query.isError || query.isPending ? undefined : rows.length}
          actions={
            <>
              {canManage ? (
                <NewPipeline
                  workspaceId={workspaceId}
                  autoOpen={search.new === true}
                  onAutoOpened={dropNewFlag}
                />
              ) : (
                <ReadOnlyNote>
                  {t('common.readOnly.cannotAddSteward', {
                    things: t('common.readOnly.things.pipelines'),
                  })}
                </ReadOnlyNote>
              )}
              <Button
                variant="quiet"
                size="sm"
                nativeButton={false}
                icon="pipeline"
                render={<Link to="/pipelines/agents" />}
              >
                {t('data.pipelinesList.agentOperationsExperimental')}
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label={t('data.pipelinesList.pipelineLists')}
              value={tab}
              items={tabs.map((tabId) => ({
                key: tabId,
                label: tabLabel[tabId],
                count: query.isPending ? undefined : counts[tabId],
                link: {
                  to: '/pipelines',
                  search: {
                    tab: tabId === 'all' ? undefined : tabId,
                    q: search.q,
                  },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label={t('data.pipelinesList.searchPipelines')}
          placeholder={t('data.pipelinesList.searchPipelines')}
          views={{
            sorts: [...nameSorts],
            sort,
            onSort: (s) => setSort(s as NameSort),
          }}
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
          {!query.isError && (query.isPending || visible.length > 0) ? (
            <RegistryGrid
              className="max-md:hidden"
              label={t('data.pipelinesList.pipelines')}
              rows={visible}
              columns={columns}
              getRowId={(p) => p.id}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onRowClick={openPipeline}
              isLoading={query.isPending}
            />
          ) : null}
          <MobileList
            label={t('data.pipelinesList.pipelines')}
            items={visible.map((p) => {
              const lastStatus = p.lastRun ? runStatus(p.lastRun.status) : null
              return {
                key: p.id,
                id: p.display_id ?? p.key,
                title: p.name,
                sub: `${p.current ? `v${p.current.version}` : t('data.pipelinesList.noVersion')} · ${p.runCount} runs`,
                status: lastStatus ? (
                  <Status tone={lastStatus.tone}>{lastStatus.label}</Status>
                ) : (
                  <Status tone="draft">
                    {t('data.pipelinesList.neverRun')}
                  </Status>
                ),
                link: {
                  to: '/pipelines/$pipelineId',
                  params: { pipelineId: p.id },
                },
              }
            })}
          />
          {!query.isPending && !query.isError && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                className="w-full py-8"
                title={
                  q
                    ? t('data.pipelinesList.pipelinesMatch', { q })
                    : t('data.pipelinesList.noPipelinesIn', {
                        tab: tabLabel[tab],
                      })
                }
                description={
                  rows.length === 0
                    ? t('data.pipelinesList.createPipelineAuthorSql')
                    : t('data.pipelinesList.searchLooksPipelineKeys')
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
                      {t('data.pipelinesList.clearSearch')}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : null}
        </div>
        <ListFooter
          loading={query.isPending}
          right={selectedRow ? '1 selected' : undefined}
        >
          {footerCount({
            shown: visible.length,
            total: counts[tab],
            one: 'pipeline',
            tab: tabLabel[tab],
          })}
        </ListFooter>
      </div>

      {sel ? (
        <Inspector
          aria-label={t('data.pipelinesList.ariaPipelineDetails')}
          className="w-[320px] gap-0 p-0"
        >
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">
              {sel.display_id ?? sel.key} ·{' '}
              {sel.current
                ? `v${sel.current.version}`
                : t('data.pipelinesList.noVersion')}
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
                {t('data.pipelinesList.runNow')}
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
                {t('common.actions.open')}
              </Button>
            </div>
            {sel.current?.lifecycle !== 'published' ? (
              <Muted className="mt-1">
                {t('data.pipelinesList.publishVersionStepsEnable')}
              </Muted>
            ) : null}
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            <InspectorSection title={t('data.pipelinesList.details')}>
              <DescriptionList
                labelWidth={80}
                items={[
                  [t('data.pipelinesList.key'), sel.key],
                  [
                    t('data.pipelinesList.current'),
                    sel.current
                      ? `v${sel.current.version} · ${versionStatus(sel.current.lifecycle).label}`
                      : '—',
                  ],
                  [
                    t('data.pipelinesList.versions'),
                    String(sel.versions.length),
                  ],
                  [t('data.pipelinesList.runs'), String(sel.runCount)],
                ]}
              />
            </InspectorSection>
            <InspectorSection title={t('data.pipelinesList.recentRuns')}>
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
                <Muted>{t('data.pipelinesList.neverRun2')}</Muted>
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
function NewPipeline({
  workspaceId,
  autoOpen = false,
  onAutoOpened,
}: {
  workspaceId: string
  autoOpen?: boolean
  onAutoOpened?: () => void
}) {
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // The shell's New menu arrives with `?new=true`: open once, then drop the flag.
  useEffect(() => {
    if (!autoOpen) return
    setOpen(true)
    onAutoOpened?.()
  }, [autoOpen, onAutoOpened])
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
      : t('data.pipelinesList.startLowercaseLetterThen'),
    name: f.name.trim() ? null : t('data.pipelinesList.enterNamePeopleSee'),
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
        description: t('data.pipelinesList.configureFirstDraftSteps'),
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
          ? t('data.pipelinesList.anotherPipelineAlreadyUses')
          : message || t('data.pipelinesList.databaseRefused'),
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
        {t('data.pipelinesList.newPipeline')}
      </DialogTrigger>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('data.pipelinesList.newPipeline')}
          description={t('data.pipelinesList.namePipelineFirstNext')}
        />
        <DialogBody>
          <Field
            label={t('data.pipelinesList.name')}
            required
            error={nameError}
          >
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
              placeholder={t('data.pipelinesList.placeholderEGPlateReader')}
            />
          </Field>
          <Field
            label={t('data.pipelinesList.key')}
            required
            error={keyError}
            hint={t('data.pipelinesList.suggestedFromNameCannot')}
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
          <Field
            label={t('data.pipelinesList.description')}
            hint={t('common.states.optional')}
          >
            <Input
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
          {serverError ? <Notice tone="bad">{serverError}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => {
              setTried(true)
              if (Object.values(errors).some(Boolean)) return
              create.mutate()
            }}
          >
            {create.isPending
              ? t('data.pipelinesList.creating')
              : t('data.pipelinesList.createPipeline')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
