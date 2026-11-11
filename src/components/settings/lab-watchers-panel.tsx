/**
 * Lab watchers: a review for each of the five things the lab can keep an eye
 * on, how often it looks, and the findings it has left. A person turns on
 * their own; the findings go to their Inbox.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { SettingsBody } from '#/components/settings/settings-page'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { ObjectLink } from '#/components/ui/object-link'
import { Select } from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { requestShellRefresh } from '#/lib/shell-refresh'
import {
  SNOOZE_CHOICES,
  WATCHERS,
  WATCHER_SCHEDULES,
  WATCHER_SCHEDULE_LABEL,
  fetchLabWatchers,
  fetchWatcherFindings,
  runLabWatcherNow,
  runSuggestedAction,
  setFindingStatus,
  setLabWatcher,
  snoozeUntil,
  watcherKeys,
} from '#/lib/lab-watchers'
import type {
  FindingStatus,
  LabWatcherFindingRow,
  LabWatcherRow,
  WatcherMeta,
  WatcherSchedule,
} from '#/lib/lab-watchers'
import { notebookDataClient } from '#/lib/notebook-data'

const client = notebookDataClient

const STATUS_TONE: Record<FindingStatus, Tone> = {
  open: 'warn',
  snoozed: 'draft',
  dismissed: 'draft',
  resolved: 'ok',
}

const STATUS_LABEL: Record<FindingStatus, string> = {
  open: t('agents.watchers.statusOpen'),
  snoozed: t('agents.watchers.statusSnoozed'),
  dismissed: t('agents.watchers.statusDismissed'),
  resolved: t('agents.watchers.statusResolved'),
}

function messageOf(error: Error, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function LabWatchersPanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()

  const watchers = useQuery({
    queryKey: watcherKeys.watchers,
    queryFn: () => fetchLabWatchers(client),
    enabled: Boolean(workspaceId),
  })

  const findings = useQuery({
    queryKey: watcherKeys.findings,
    queryFn: () => fetchWatcherFindings(client),
    enabled: Boolean(workspaceId),
  })

  const [showSetAside, setShowSetAside] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['lab-watchers'] })
    void queryClient.invalidateQueries({ queryKey: ['work-items'] })
    requestShellRefresh()
  }

  const save = useMutation({
    mutationFn: (input: {
      meta: WatcherMeta
      enabled: boolean
      schedule: WatcherSchedule
      param: number | null
    }) =>
      setLabWatcher(client, {
        workspaceId,
        kind: input.meta.kind,
        enabled: input.enabled,
        schedule: input.schedule,
        params:
          input.meta.param && input.param !== null
            ? { [input.meta.param.key]: input.param }
            : {},
      }),
    onSuccess: () => {
      refresh()
      toast(t('agents.watchers.saved'))
    },
    onError: (error) =>
      toast.error(messageOf(error, t('agents.watchers.couldNotSave'))),
  })

  const look = useMutation({
    mutationFn: (id: string) => runLabWatcherNow(client, id),
    onSuccess: (count) => {
      refresh()
      toast(t('agents.watchers.lookedToast', { count }))
    },
    onError: (error) =>
      toast.error(messageOf(error, t('agents.watchers.couldNotLook'))),
  })

  const change = useMutation({
    mutationFn: (input: {
      finding: LabWatcherFindingRow
      action: 'dismiss' | 'snooze' | 'reopen' | 'act'
      days?: number
    }) =>
      input.action === 'act'
        ? runSuggestedAction(client, input.finding).then(() =>
            setFindingStatus(client, {
              findingId: input.finding.id,
              action: 'dismiss',
            }),
          )
        : setFindingStatus(client, {
            findingId: input.finding.id,
            action: input.action,
            until:
              input.action === 'snooze'
                ? snoozeUntil(input.days ?? 7)
                : undefined,
          }),
    onSuccess: () => refresh(),
    onError: (error) =>
      toast.error(messageOf(error, t('agents.watchers.actionFailed'))),
  })

  const byKind = new Map(
    (watchers.data ?? [])
      .filter((row) => row.project_id === null)
      .map((row) => [row.kind, row] as const),
  )

  const shown = (findings.data ?? []).filter(
    (row) => showSetAside || row.status === 'open',
  )

  const watcherColumns = watcherColumnsFor({
    busy: save.isPending,
    looking: look.isPending,
    onSave: (meta, next) => save.mutate({ meta, ...next }),
    onLook: (id) => look.mutate(id),
  })

  const findingColumns = findingColumnsFor({
    busy: change.isPending,
    onChange: (finding, action, days) =>
      change.mutate({ finding, action, days }),
  })

  return (
    <SettingsBody>
      <Section title={t('agents.watchers.reviews')}>
        {watchers.error ? (
          <Notice tone="bad">{t('agents.watchers.loadError')}</Notice>
        ) : watchers.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <TableBox>
            <RegistryGrid
              label={t('agents.watchers.tableLabel')}
              rows={WATCHERS.map((meta) => ({
                id: meta.kind,
                meta,
                row: byKind.get(meta.kind) ?? null,
              }))}
              columns={watcherColumns}
              getRowId={(line) => line.id}
              selectable={false}
              sortable={false}
            />
          </TableBox>
        )}
      </Section>

      <Section
        title={t('agents.watchers.findingsTitle')}
        action={
          <label className="flex items-center gap-2 text-label">
            <Checkbox
              checked={showSetAside}
              onCheckedChange={(value) => setShowSetAside(Boolean(value))}
            />
            {t('agents.watchers.showSetAside')}
          </label>
        }
      >
        {findings.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : shown.length === 0 ? (
          <Muted>{t('agents.watchers.noFindings')}</Muted>
        ) : (
          <TableBox>
            <RegistryGrid
              label={t('agents.watchers.findingsLabel')}
              rows={shown}
              columns={findingColumns}
              getRowId={(finding) => finding.id}
              selectable={false}
            />
          </TableBox>
        )}
      </Section>
    </SettingsBody>
  )
}

interface WatcherLine {
  id: string
  meta: WatcherMeta
  row: LabWatcherRow | null
}

type WatcherNext = {
  enabled: boolean
  schedule: WatcherSchedule
  param: number | null
}

function watcherState(line: WatcherLine) {
  const { meta, row } = line
  const paramKey = meta.param?.key
  const stored = paramKey ? row?.params[paramKey] : undefined

  return {
    enabled: row?.enabled ?? false,
    schedule: row?.schedule ?? 'daily',
    param:
      z.number().safeParse(stored).data ?? meta.param?.defaultValue ?? null,
  }
}

/** The watchers table's columns: on/off, what it looks for, how often, and its last look. */
function watcherColumnsFor({
  busy,
  looking,
  onSave,
  onLook,
}: {
  busy: boolean
  looking: boolean
  onSave: (meta: WatcherMeta, next: WatcherNext) => void
  onLook: (id: string) => void
}): RegistryColumn<WatcherLine>[] {
  return [
    {
      id: 'on',
      header: t('agents.watchers.on'),
      size: 64,
      cell: ({ row }) => {
        const { meta } = row.original
        const { enabled, schedule, param } = watcherState(row.original)

        return (
          <Checkbox
            aria-label={meta.label}
            checked={enabled}
            disabled={busy}
            onCheckedChange={(value) =>
              onSave(meta, { enabled: Boolean(value), schedule, param })
            }
          />
        )
      },
    },
    {
      id: 'watcher',
      header: t('agents.watchers.watcher'),
      cell: ({ row }) => {
        const { meta } = row.original

        return (
          <Tooltip content={meta.description}>
            <span className="block max-w-[34rem] truncate font-medium text-fg">
              {meta.label}
            </span>
          </Tooltip>
        )
      },
    },
    {
      id: 'setting',
      header: t('agents.watchers.setting'),
      cell: ({ row }) => {
        const { meta } = row.original
        const { enabled, schedule, param } = watcherState(row.original)

        if (!meta.param || !enabled) return null

        return (
          <label className="flex items-center gap-2 text-label text-fg-muted">
            {meta.param.label}
            <Input
              type="number"
              className="h-6 w-20"
              min={meta.param.min}
              max={meta.param.max}
              defaultValue={param ?? undefined}
              onBlur={(event) => {
                const next = Number(event.target.value)

                if (
                  Number.isFinite(next) &&
                  next >= (meta.param?.min ?? 1) &&
                  next <= (meta.param?.max ?? 365) &&
                  next !== param
                ) {
                  onSave(meta, { enabled, schedule, param: next })
                }
              }}
            />
            {meta.param.unit}
          </label>
        )
      },
    },
    {
      id: 'schedule',
      header: t('agents.watchers.schedule'),
      size: 160,
      cell: ({ row }) => {
        const { meta } = row.original
        const { enabled, schedule, param } = watcherState(row.original)

        return (
          <Select
            size="sm"
            aria-label={`${meta.label}: ${t('agents.watchers.schedule')}`}
            value={schedule}
            disabled={busy}
            onChange={(event) => {
              const selectedSchedule = WATCHER_SCHEDULES.find(
                (option) => option === event.target.value,
              )

              if (!selectedSchedule) return
              onSave(meta, { enabled, schedule: selectedSchedule, param })
            }}
          >
            {WATCHER_SCHEDULES.map((value) => (
              <option key={value} value={value}>
                {WATCHER_SCHEDULE_LABEL[value]}
              </option>
            ))}
          </Select>
        )
      },
    },
    {
      id: 'lastRun',
      header: t('agents.watchers.lastRun'),
      size: 180,
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.row?.last_run_at
            ? formatDate(row.original.row.last_run_at, { time: true })
            : t('agents.watchers.never')}
        </span>
      ),
    },
    {
      id: 'found',
      header: t('agents.watchers.found'),
      size: 96,
      cell: ({ row }) => row.original.row?.last_found ?? '',
    },
    {
      id: 'runNow',
      header: '',
      enableHiding: false,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => {
        const watcher = row.original.row

        return watcher && watcher.enabled ? (
          <Button
            size="sm"
            disabled={looking}
            onClick={() => onLook(watcher.id)}
          >
            {looking
              ? t('agents.watchers.looking')
              : t('agents.watchers.runNow')}
          </Button>
        ) : null
      },
    },
  ]
}

type FindingAction = 'dismiss' | 'snooze' | 'reopen' | 'act'

function findingColumnsFor({
  busy,
  onChange,
}: {
  busy: boolean
  onChange: (
    finding: LabWatcherFindingRow,
    action: FindingAction,
    days?: number,
  ) => void
}): RegistryColumn<LabWatcherFindingRow>[] {
  return [
    {
      id: 'finding',
      header: t('agents.watchers.finding'),
      accessorFn: (finding) => finding.title,
      cell: ({ row }) => {
        const finding = row.original

        return finding.object_id ? (
          <ObjectLink
            kind={finding.object_kind}
            id={finding.object_id}
            mono={false}
          >
            {finding.title}
          </ObjectLink>
        ) : (
          <span className="font-medium text-fg">{finding.title}</span>
        )
      },
    },
    {
      id: 'what',
      header: t('agents.watchers.what'),
      accessorFn: (finding) => finding.summary,
      cell: ({ row }) => (
        <Tooltip content={row.original.summary}>
          <span className="block max-w-[30rem] truncate text-fg-muted">
            {row.original.summary}
          </span>
        </Tooltip>
      ),
    },
    {
      id: 'status',
      header: t('agents.checks.result'),
      size: 190,
      accessorFn: (finding) => finding.status,
      cell: ({ row }) => {
        const finding = row.original

        return (
          <Status tone={STATUS_TONE[finding.status]}>
            {finding.status === 'snoozed' && finding.snoozed_until
              ? t('agents.watchers.snoozedUntil', {
                  date: formatDate(finding.snoozed_until),
                })
              : STATUS_LABEL[finding.status]}
          </Status>
        )
      },
    },
    {
      id: 'suggestion',
      header: '',
      enableHiding: false,
      size: 360,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => {
        const finding = row.original

        const setAside =
          finding.status === 'snoozed' || finding.status === 'dismissed'

        return (
          <div className="flex justify-end gap-1.5">
            {finding.status === 'open' && finding.suggested_action ? (
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => onChange(finding, 'act')}
              >
                {finding.suggested_action.label}
              </Button>
            ) : null}
            {finding.status === 'open' ? (
              <>
                <Select
                  size="sm"
                  className="w-28"
                  aria-label={`${t('agents.watchers.snooze')}: ${finding.title}`}
                  value=""
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.value)
                      onChange(finding, 'snooze', Number(event.target.value))
                  }}
                >
                  <option value="">{t('agents.watchers.snooze')}</option>
                  {SNOOZE_CHOICES.map((choice) => (
                    <option key={choice.days} value={choice.days}>
                      {choice.label}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => onChange(finding, 'dismiss')}
                >
                  {t('agents.watchers.dismiss')}
                </Button>
              </>
            ) : null}
            {setAside ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onChange(finding, 'reopen')}
              >
                {t('agents.watchers.reopen')}
              </Button>
            ) : null}
          </div>
        )
      },
    },
  ]
}
