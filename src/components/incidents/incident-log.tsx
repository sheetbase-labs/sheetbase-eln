/**
 * The Incidents page: every record of every model ticked as an incident log.
 * There is no fixed incident type. A tab appears for each ticked model, and a
 * lab with none yet can start from the ready-made Incident model.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  ListHeader,
  ListToolbar,
  ReadOnlyNote,
} from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Tabs } from '#/components/ui/tabs'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  STARTER_INCIDENT_MODEL,
  createStarterModel,
  fetchIncidentModels,
  fetchIncidents,
  incidentSummary,
  messageOf,
  qualityKeys,
} from '#/lib/result-quality'
import { ObjectLink } from '#/components/ui/object-link'
import type { IncidentEntry, IncidentModel } from '#/lib/result-quality'

const client = notebookDataClient

type StatusFilter = 'active' | 'archived' | 'all'

function entryText(entry: IncidentEntry): string {
  return [entry.identifier, entry.title, incidentSummary(entry)]
    .join(' ')
    .toLowerCase()
}

export function IncidentLog({
  canWrite,
  canEditModels,
}: {
  canWrite: boolean
  canEditModels: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [q, setQ] = useState('')
  const [choosing, setChoosing] = useState(false)

  const models = useQuery({
    queryKey: qualityKeys.incidentModels,
    queryFn: () => fetchIncidentModels(client),
    staleTime: 10_000,
  })

  const logs = useMemo(() => models.data ?? [], [models.data])
  const keys = useMemo(() => logs.map((m) => m.key), [logs])

  const modelByKey = useMemo(
    () => new Map(logs.map((m) => [m.key, m] as const)),
    [logs],
  )

  const entries = useQuery({
    queryKey: qualityKeys.incidents(keys),
    queryFn: () => fetchIncidents(client, keys),
    enabled: models.isSuccess && keys.length > 0,
    staleTime: 10_000,
  })

  const all = useMemo(() => entries.data ?? [], [entries.data])

  const inStatus = all.filter(
    (e) =>
      status === 'all' ||
      (status === 'archived' ? e.archived_at : !e.archived_at),
  )

  const needle = q.trim().toLowerCase()

  const visible = inStatus.filter(
    (e) =>
      (kind === 'all' || e.kind === kind) &&
      (needle === '' || entryText(e).includes(needle)),
  )

  const setUp = useMutation({
    mutationFn: () =>
      createStarterModel(client, STARTER_INCIDENT_MODEL, { incidentLog: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qualityKeys.all })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'record-models'],
      })
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('quality.incidents.empty.couldNotSetUp'))),
  })

  const columns = useMemo<RegistryColumn<IncidentEntry>[]>(
    () => [
      {
        id: 'number',
        header: t('quality.incidents.columns.number'),
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
        header: t('quality.incidents.columns.title'),
        size: 280,
        cell: ({ row }) => (
          <Link
            to="/models/$modelId/records/$recordId"
            params={{ modelId: row.original.kind, recordId: row.original.id }}
            className="truncate font-medium text-fg hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        id: 'kind',
        header: t('quality.incidents.columns.kind'),
        size: 130,
        cell: ({ row }) => (
          <span className="truncate">
            {modelByKey.get(row.original.kind)?.name ?? row.original.kind}
          </span>
        ),
      },
      {
        id: 'details',
        header: t('quality.incidents.columns.details'),
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {incidentSummary(row.original)}
          </span>
        ),
      },
      {
        id: 'reported',
        header: t('quality.incidents.columns.reported'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
    ],
    [modelByKey],
  )

  const open = (entry: IncidentEntry) =>
    void navigate({
      to: '/models/$modelId/records/$recordId',
      params: { modelId: entry.kind, recordId: entry.id },
    })

  function report() {
    const only = kind !== 'all' ? kind : logs.length === 1 ? logs[0].key : null

    if (only) {
      void navigate({
        to: '/models/$modelId/records/new',
        params: { modelId: only },
      })
    } else {
      setChoosing(true)
    }
  }

  const reportButton =
    canWrite && logs.length > 0 ? (
      <Button variant="primary" onClick={report}>
        {t('quality.incidents.report')}
      </Button>
    ) : null

  const noLogs = models.isSuccess && logs.length === 0

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('quality.incidents.title')}
        subtitle={t('quality.incidents.subtitle')}
        total={entries.data ? inStatus.length : undefined}
        actions={reportButton}
        tabs={
          logs.length > 1 ? (
            <Tabs
              mode="state"
              variant="strip"
              label={t('quality.incidents.filterLabel')}
              value={kind}
              onValueChange={setKind}
              items={[
                {
                  key: 'all',
                  label: t('quality.incidents.all'),
                  count: entries.isPending ? undefined : inStatus.length,
                },
                ...logs.map((m) => ({
                  key: m.key,
                  label: m.name,
                  count: entries.isPending
                    ? undefined
                    : inStatus.filter((e) => e.kind === m.key).length,
                })),
              ]}
            />
          ) : undefined
        }
      />
      {noLogs ? null : (
        <ListToolbar
          q={q}
          onSearch={setQ}
          placeholder={t('quality.incidents.searchPlaceholder')}
          label={t('quality.incidents.searchPlaceholder')}
          right={
            <Select
              size="sm"
              aria-label={t('quality.incidents.statusLabel')}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              {(['active', 'archived', 'all'] as const).map((key) => (
                <option key={key} value={key}>
                  {t(`quality.incidents.statusFilters.${key}`)}
                </option>
              ))}
            </Select>
          }
        />
      )}
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {models.isError || entries.isError ? (
          <div className="p-6">
            <Notice tone="bad" title={t('quality.incidents.loadError')}>
              {messageOf(models.error ?? entries.error, '')}
            </Notice>
          </div>
        ) : noLogs ? (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="warn"
              title={t('quality.incidents.empty.title')}
              description={
                canEditModels
                  ? t('quality.incidents.empty.body')
                  : t('quality.incidents.empty.notAllowed')
              }
              action={
                canEditModels ? (
                  <Button
                    variant="primary"
                    disabled={setUp.isPending}
                    onClick={() => setUp.mutate()}
                  >
                    {setUp.isPending
                      ? t('quality.incidents.empty.settingUp')
                      : t('quality.incidents.empty.setUp')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : models.isPending || entries.isPending || visible.length > 0 ? (
          <RegistryGrid
            label={t('quality.incidents.tableLabel')}
            rows={visible}
            columns={columns}
            getRowId={(entry) => entry.id}
            onRowClick={open}
            isLoading={models.isPending || entries.isPending}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="warn"
              title={
                all.length === 0
                  ? t('quality.incidents.empty.none')
                  : t('quality.incidents.empty.filtered')
              }
              description={
                all.length === 0
                  ? t('quality.incidents.empty.noneBody')
                  : undefined
              }
              action={
                all.length === 0 ? (reportButton ?? undefined) : undefined
              }
            />
          </div>
        )}
        {!canWrite && !models.isPending ? (
          <div className="px-6 pb-4">
            <ReadOnlyNote>{t('quality.incidents.readOnly')}</ReadOnlyNote>
          </div>
        ) : null}
      </div>
      <ChooseLog open={choosing} onOpenChange={setChoosing} logs={logs} />
    </div>
  )
}

function ChooseLog({
  open,
  onOpenChange,
  logs,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  logs: IncidentModel[]
}) {
  const navigate = useNavigate()
  const [choice, setChoice] = useState('')
  const selected = choice || logs[0]?.key || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={t('quality.incidents.reportChoose')} />
        <DialogBody>
          <Field label={t('quality.incidents.reportChooseLabel')}>
            <Select
              value={selected}
              onChange={(e) => setChoice(e.target.value)}
            >
              {logs.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('quality.limits.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!selected}
            onClick={() => {
              onOpenChange(false)
              void navigate({
                to: '/models/$modelId/records/new',
                params: { modelId: selected },
              })
            }}
          >
            {t('quality.incidents.report')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
