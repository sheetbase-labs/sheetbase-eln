/**
 * The Requests page: ask the lab for work through a form made from a model, and
 * follow what happens to it. People who handle a model's requests also see the
 * ones waiting for them here.
 */
import { useMemo, useState } from 'react'
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

type RequestTab = 'mine' | 'triage' | 'all'

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

  const mine = all.filter((r) => r.created_by_user_id === userId)

  // What is waiting for this person: requests of the forms they handle.
  const waiting = all.filter(
    (r) => r.status === 'requested' && handled.has(r.kind),
  )

  const showTriage = handled.size > 0

  const inTab = tab === 'mine' ? mine : tab === 'triage' ? waiting : all
  const needle = q.trim().toLowerCase()

  const visible = inTab.filter(
    (r) =>
      needle === '' ||
      requestText(r, names?.get(r.created_by_user_id) ?? '').includes(needle),
  )

  const setUp = useMutation({
    mutationFn: async (key: string) => {
      const starter = STARTER_REQUESTS.find((s) => s.key === key)

      if (starter) await createStarterRequest(notebookDataClient, starter)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestKeys.all })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'record-models'],
      })
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('requests.empty.couldNotSetUp'))),
  })

  const columns = useMemo<RegistryColumn<RequestRow>[]>(
    () => [
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
          handled.has(row.original.kind) &&
          isOpenRequest(row.original.status) ? (
            <Button
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                setDeciding(row.original)
              }}
            >
              {t('requests.decide.handle')}
            </Button>
          ) : null,
      },
    ],
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

  const emptyTitle =
    tab === 'mine'
      ? t('requests.empty.mine')
      : tab === 'triage'
        ? t('requests.empty.triage')
        : t('requests.empty.all')

  const emptyBody =
    tab === 'mine'
      ? t('requests.empty.mineBody')
      : tab === 'triage'
        ? t('requests.empty.triageBody')
        : undefined

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('requests.title')}
        subtitle={t('requests.subtitle')}
        actions={newButton}
        tabs={
          forms.length > 0 ? (
            <Tabs
              mode="state"
              variant="strip"
              label={t('requests.title')}
              value={tab}
              onValueChange={(value) => onTabChange(value as RequestTab)}
              items={[
                {
                  key: 'mine',
                  label: t('requests.tabs.mine'),
                  count: requests.isPending ? undefined : mine.length,
                },
                ...(showTriage
                  ? [
                      {
                        key: 'triage',
                        label: t('requests.tabs.triage'),
                        count: requests.isPending ? undefined : waiting.length,
                      },
                    ]
                  : []),
                {
                  key: 'all',
                  label: t('requests.tabs.all'),
                  count: requests.isPending ? undefined : all.length,
                },
              ]}
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
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {formsQuery.isError || requests.isError ? (
          <div className="p-6">
            <Notice tone="bad" title={t('requests.loadError')}>
              {messageOf(formsQuery.error ?? requests.error, '')}
            </Notice>
          </div>
        ) : noForms ? (
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
                        disabled={setUp.isPending}
                        onClick={() => setUp.mutate(starter.key)}
                      >
                        {setUp.isPending
                          ? t('requests.empty.settingUp')
                          : t('requests.empty.setUp', { name: starter.name })}
                      </Button>
                    ))}
                  </div>
                ) : undefined
              }
            />
          </div>
        ) : formsQuery.isPending || requests.isPending || visible.length > 0 ? (
          <RegistryGrid
            label={t('requests.tableLabel')}
            rows={visible}
            columns={columns}
            getRowId={(request) => request.id}
            selectable
            onRowClick={open}
            isLoading={formsQuery.isPending || requests.isPending}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="inbox"
              title={needle ? t('requests.empty.filtered') : emptyTitle}
              description={needle ? undefined : emptyBody}
              action={tab === 'mine' ? (newButton ?? undefined) : undefined}
            />
          </div>
        )}
        {!canWrite && !formsQuery.isPending ? (
          <div className="px-6 pb-4">
            <ReadOnlyNote>{t('requests.readOnly')}</ReadOnlyNote>
          </div>
        ) : null}
      </div>
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
