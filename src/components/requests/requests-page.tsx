/**
 * The Requests page: ask the lab for work through a form made from a model, and
 * follow what happens to it. People who handle a model's requests also see the
 * ones waiting for them here.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  ListHeader,
  ListToolbar,
  ReadOnlyNote,
} from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useWorkspaceMemberNames } from '#/components/projects/project-data'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  STARTER_REQUESTS,
  createStarterRequest,
  fetchHandledForms,
  fetchRequests,
  isOpenRequest,
  messageOf,
  requestKeys,
} from '#/lib/requests'
import { ObjectLink } from '#/components/ui/object-link'
import type { RequestRow } from '#/lib/requests'

import { DecideRequestDialog } from './decide-request-dialog'
import { RequestFormDialog, useRequestForms } from './request-form-dialog'
import { requestSummary, requestText, statusTone } from './requests-shared'

const REQUEST_TABS = ['mine', 'triage', 'all'] as const

/** The starter requests by the key a set-up button names. */
const STARTER_REQUESTS_BY_KEY = new Map(
  STARTER_REQUESTS.map((starter) => [starter.key, starter]),
)

type RequestTab = (typeof REQUEST_TABS)[number]

/** The grid columns the requests list shows; a handled form can be decided here. */
function requestColumns({
  formByKey,
  names,
  handled,
  onDecide,
}: {
  formByKey: ReadonlyMap<string, { name: string }>
  names: ReadonlyMap<string, string> | undefined
  handled: ReadonlySet<string>
  onDecide: (request: RequestRow) => void
}): RegistryColumn<RequestRow>[] {
  return [
    {
      id: 'number',
      header: t('requests.columns.number'),
      size: 110,
      cell: ({ row }) => (
        <ObjectLink
          kind="record"
          id={row.original.id}
          identifier={row.original.identifier}
          className="text-fg-muted"
        />
      ),
    },
    {
      id: 'title',
      header: t('requests.columns.title'),
      size: 280,
      cell: ({ row }) => (
        <span className="truncate font-medium text-fg">
          {row.original.title}
        </span>
      ),
    },
    {
      id: 'form',
      header: t('requests.columns.form'),
      size: 150,
      cell: ({ row }) => (
        <span className="truncate">
          {formByKey.get(row.original.kind)?.name ?? row.original.kind}
        </span>
      ),
    },
    {
      id: 'summary',
      header: t('requests.columns.summary'),
      cell: ({ row }) => (
        <span className="truncate text-fg-muted">
          {requestSummary(row.original)}
        </span>
      ),
    },
    {
      id: 'asker',
      header: t('requests.columns.asker'),
      size: 150,
      cell: ({ row }) => (
        <span className="truncate">
          {names?.get(row.original.created_by_user_id) ?? ''}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('requests.columns.status'),
      size: 120,
      cell: ({ row }) => (
        <Status tone={statusTone(row.original.status)}>
          {t(`requests.statuses.${row.original.status}`)}
        </Status>
      ),
    },
    {
      id: 'asked',
      header: t('requests.columns.asked'),
      size: 120,
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
    {
      id: 'handle',
      header: '',
      size: 90,
      cell: ({ row }) =>
        handled.has(row.original.kind) && isOpenRequest(row.original.status) ? (
          <Button
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              onDecide(row.original)
            }}
          >
            {t('requests.decide.handle')}
          </Button>
        ) : null,
    },
  ]
}

/** What the empty list says for the tab it is on. */
function emptyCopyFor(tab: RequestTab) {
  if (tab === 'mine') {
    return {
      title: t('requests.empty.mine'),
      body: t('requests.empty.mineBody'),
    }
  }

  if (tab === 'triage') {
    return {
      title: t('requests.empty.triage'),
      body: t('requests.empty.triageBody'),
    }
  }

  return { title: t('requests.empty.all'), body: undefined }
}

/** The tab strip; triage appears only when this person handles a form. */
function RequestsTabs({
  tab,
  onTabChange,
  mine,
  waiting,
  all,
  pending,
  showTriage,
}: {
  tab: RequestTab
  onTabChange: (tab: RequestTab) => void
  mine: number
  waiting: number
  all: number
  pending: boolean
  showTriage: boolean
}) {
  const count = (value: number) => (pending ? undefined : value)

  const items = [
    {
      key: 'mine',
      label: t('requests.tabs.mine'),
      count: count(mine),
    },
    ...(showTriage
      ? [
          {
            key: 'triage',
            label: t('requests.tabs.triage'),
            count: count(waiting),
          },
        ]
      : []),
    {
      key: 'all',
      label: t('requests.tabs.all'),
      count: count(all),
    },
  ]

  return (
    <Tabs
      mode="state"
      variant="strip"
      label={t('requests.title')}
      value={tab}
      onValueChange={(value) => {
        const next = REQUEST_TABS.find((item) => item === value)

        if (next) onTabChange(next)
      }}
      items={items}
    />
  )
}

/** No form exists yet: the starters set one up. */
function NoFormsYet({
  canEditModels,
  pending,
  onSetUp,
}: {
  canEditModels: boolean
  pending: boolean
  onSetUp: (key: string) => void
}) {
  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        className="items-center py-14 text-center"
        icon="inbox"
        title={t('requests.empty.noForms')}
        description={
          canEditModels
            ? t('requests.empty.noFormsBody')
            : t('requests.empty.noFormsNotAllowed')
        }
        action={
          canEditModels ? (
            <div className="flex flex-wrap justify-center gap-2">
              {STARTER_REQUESTS.map((starter) => (
                <Button
                  key={starter.key}
                  variant="primary"
                  disabled={pending}
                  onClick={() => onSetUp(starter.key)}
                >
                  {pending
                    ? t('requests.empty.settingUp')
                    : t('requests.empty.setUp', { name: starter.name })}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />
    </div>
  )
}

/** Nothing in this tab matches the search, or there is nothing in it yet. */
function NothingToShow({
  searched,
  title,
  body,
  action,
}: {
  searched: boolean
  title: string
  body: string | undefined
  action: ReactNode
}) {
  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        className="items-center py-14 text-center"
        icon="inbox"
        title={searched ? t('requests.empty.filtered') : title}
        description={searched ? undefined : body}
        action={action}
      />
    </div>
  )
}

/** This person's own requests, and the ones waiting for a form they handle. */
function splitRequests(
  all: RequestRow[],
  userId: string,
  handled: ReadonlySet<string>,
) {
  const mine = all.filter((request) => request.created_by_user_id === userId)

  // What is waiting for this person: requests of the forms they handle.
  const waiting = all.filter(
    (request) => request.status === 'requested' && handled.has(request.kind),
  )

  return { mine, waiting }
}

/** The requests in the chosen tab whose text matches the search. */
function visibleRequests({
  tab,
  all,
  mine,
  waiting,
  needle,
  names,
}: {
  tab: RequestTab
  all: RequestRow[]
  mine: RequestRow[]
  waiting: RequestRow[]
  needle: string
  names: ReadonlyMap<string, string> | undefined
}): RequestRow[] {
  const inTab = tab === 'mine' ? mine : tab === 'triage' ? waiting : all

  if (needle === '') return inTab

  const matching: RequestRow[] = []

  for (const request of inTab) {
    const name = names?.get(request.created_by_user_id) ?? ''
    const text: string = requestText(request, name)

    if (text.includes(needle)) matching.push(request)
  }

  return matching
}

/** The list area: a load error, nothing set up, the grid, or nothing to show. */
function RequestsListArea({
  failing,
  loadError,
  noForms,
  canEditModels,
  setUpPending,
  onSetUp,
  loading,
  visible,
  columns,
  onOpen,
  searched,
  empty,
  newButton,
  tab,
  readOnly,
}: {
  failing: boolean
  loadError: string
  noForms: boolean
  canEditModels: boolean
  setUpPending: boolean
  onSetUp: (key: string) => void
  loading: boolean
  visible: RequestRow[]
  columns: RegistryColumn<RequestRow>[]
  onOpen: (request: RequestRow) => void
  searched: boolean
  empty: { title: string; body: string | undefined }
  newButton: ReactNode
  tab: RequestTab
  readOnly: boolean
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
      {failing ? (
        <div className="p-6">
          <Notice tone="bad" title={t('requests.loadError')}>
            {loadError}
          </Notice>
        </div>
      ) : noForms ? (
        <NoFormsYet
          canEditModels={canEditModels}
          pending={setUpPending}
          onSetUp={onSetUp}
        />
      ) : loading || visible.length > 0 ? (
        <RegistryGrid
          label={t('requests.tableLabel')}
          rows={visible}
          columns={columns}
          getRowId={(request) => request.id}
          selectable
          onRowClick={onOpen}
          isLoading={loading}
        />
      ) : (
        <NothingToShow
          searched={searched}
          title={empty.title}
          body={empty.body}
          action={tab === 'mine' ? newButton : undefined}
        />
      )}
      {readOnly ? (
        <div className="px-6 pb-4">
          <ReadOnlyNote>{t('requests.readOnly')}</ReadOnlyNote>
        </div>
      ) : null}
    </div>
  )
}

export function RequestsPage({
  userId,
  canWrite,
  canEditModels,
  tab,
  onTabChange,
}: {
  userId: string
  canWrite: boolean
  canEditModels: boolean
  tab: RequestTab
  onTabChange: (tab: RequestTab) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [composing, setComposing] = useState(false)
  const [deciding, setDeciding] = useState<RequestRow | null>(null)

  const formsQuery = useRequestForms()
  const forms = useMemo(() => formsQuery.data ?? [], [formsQuery.data])
  const kinds = useMemo(() => forms.map((f) => f.model_key), [forms])

  const formByKey = useMemo(
    () => new Map(forms.map((f) => [f.model_key, f] as const)),
    [forms],
  )

  const requests = useQuery({
    queryKey: requestKeys.list(kinds),
    queryFn: () => fetchRequests(notebookDataClient, kinds),
    enabled: formsQuery.isSuccess && kinds.length > 0,
    staleTime: 10_000,
  })

  const handledQuery = useQuery({
    queryKey: requestKeys.handled,
    queryFn: () => fetchHandledForms(notebookDataClient),
    enabled: formsQuery.isSuccess && kinds.length > 0,
    staleTime: 30_000,
  })

  const handled = useMemo(
    () => new Set(handledQuery.data ?? []),
    [handledQuery.data],
  )

  const names = useWorkspaceMemberNames().data
  const all = useMemo(() => requests.data ?? [], [requests.data])

  const { mine, waiting } = splitRequests(all, userId, handled)

  const showTriage = handled.size > 0

  const needle = q.trim().toLowerCase()

  const visible = visibleRequests({
    tab,
    all,
    mine,
    waiting,
    needle,
    names,
  })

  const setUp = useMutation({
    mutationFn: async (key: string) => {
      const starter = STARTER_REQUESTS_BY_KEY.get(key)

      if (starter) await createStarterRequest(notebookDataClient, starter)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestKeys.all })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'record-models'],
      })
    },
    onError: (e) =>
      toast.error(messageOf(e, t('requests.empty.couldNotSetUp'))),
  })

  const columns = useMemo(
    () => requestColumns({ formByKey, names, handled, onDecide: setDeciding }),
    [formByKey, names, handled],
  )

  const open = (request: RequestRow) =>
    void navigate({
      to: '/models/$modelId/records/$recordId',
      params: { modelId: request.kind, recordId: request.id },
    })

  const noForms = formsQuery.isSuccess && forms.length === 0

  const newButton =
    canWrite && forms.length > 0 ? (
      <Button variant="primary" onClick={() => setComposing(true)}>
        {t('requests.newRequest')}
      </Button>
    ) : null

  const empty = emptyCopyFor(tab)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('requests.title')}
        subtitle={t('requests.subtitle')}
        actions={newButton}
        tabs={
          forms.length > 0 ? (
            <RequestsTabs
              tab={tab}
              onTabChange={onTabChange}
              mine={mine.length}
              waiting={waiting.length}
              all={all.length}
              pending={requests.isPending}
              showTriage={showTriage}
            />
          ) : undefined
        }
      />
      {noForms ? null : (
        <ListToolbar
          q={q}
          onSearch={setQ}
          placeholder={t('requests.searchPlaceholder')}
          label={t('requests.searchPlaceholder')}
        />
      )}
      <RequestsListArea
        failing={formsQuery.isError || requests.isError}
        loadError={messageOf(formsQuery.error ?? requests.error, '')}
        noForms={noForms}
        canEditModels={canEditModels}
        setUpPending={setUp.isPending}
        onSetUp={(key) => setUp.mutate(key)}
        loading={formsQuery.isPending || requests.isPending}
        visible={visible}
        columns={columns}
        onOpen={open}
        searched={needle !== ''}
        empty={empty}
        newButton={newButton}
        tab={tab}
        readOnly={!canWrite && !formsQuery.isPending}
      />
      <RequestFormDialog
        open={composing}
        onOpenChange={setComposing}
        forms={forms}
      />
      <DecideRequestDialog
        request={deciding}
        askerName={
          deciding ? (names?.get(deciding.created_by_user_id) ?? '') : ''
        }
        onClose={() => setDeciding(null)}
      />
    </div>
  )
}
