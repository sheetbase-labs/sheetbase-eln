/**
 * Lab watchers: a review for each of the five things the lab can keep an eye
 * on, how often it looks, and the findings it has left. A person turns on
 * their own; the findings go to their Inbox.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
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

function messageOf(error: unknown, fallback: string): string {
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

  return (
    <div className="flex flex-col gap-6">
      <Section title={t('agents.watchers.reviews')}>
        {watchers.error ? (
          <Notice tone="bad">{t('agents.watchers.loadError')}</Notice>
        ) : watchers.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <TableBox>
            <Table caption={t('agents.watchers.tableLabel')}>
              <TableHeader>
                <tr>
                  <TableHead className="w-12">
                    {t('agents.watchers.on')}
                  </TableHead>
                  <TableHead>{t('agents.watchers.watcher')}</TableHead>
                  <TableHead className="w-40">
                    {t('agents.watchers.schedule')}
                  </TableHead>
                  <TableHead className="w-44">
                    {t('agents.watchers.lastRun')}
                  </TableHead>
                  <TableHead className="w-24">
                    {t('agents.watchers.found')}
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">
                      {t('agents.watchers.runNow')}
                    </span>
                  </TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {WATCHERS.map((meta) => (
                  <WatcherRow
                    key={meta.kind}
                    meta={meta}
                    row={byKind.get(meta.kind) ?? null}
                    busy={save.isPending}
                    looking={look.isPending}
                    onSave={(next) => save.mutate({ meta, ...next })}
                    onLook={(id) => look.mutate(id)}
                  />
                ))}
              </TableBody>
            </Table>
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
            <Table caption={t('agents.watchers.findingsLabel')}>
              <TableHeader>
                <tr>
                  <TableHead>{t('agents.watchers.finding')}</TableHead>
                  <TableHead>{t('agents.watchers.what')}</TableHead>
                  <TableHead className="w-36">
                    {t('agents.checks.result')}
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">
                      {t('agents.watchers.suggestion')}
                    </span>
                  </TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {shown.map((finding) => (
                  <FindingRow
                    key={finding.id}
                    finding={finding}
                    busy={change.isPending}
                    onChange={(action, days) =>
                      change.mutate({ finding, action, days })
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </TableBox>
        )}
      </Section>
    </div>
  )
}

function WatcherRow({
  meta,
  row,
  busy,
  looking,
  onSave,
  onLook,
}: {
  meta: WatcherMeta
  row: LabWatcherRow | null
  busy: boolean
  looking: boolean
  onSave: (next: {
    enabled: boolean
    schedule: WatcherSchedule
    param: number | null
  }) => void
  onLook: (id: string) => void
}) {
  const enabled = row?.enabled ?? false
  const schedule = row?.schedule ?? 'daily'
  const paramKey = meta.param?.key
  const stored = paramKey ? row?.params[paramKey] : undefined
  const param =
    typeof stored === 'number' ? stored : (meta.param?.defaultValue ?? null)
  return (
    <TableRow>
      <TableCell>
        <Checkbox
          aria-label={meta.label}
          checked={enabled}
          disabled={busy}
          onCheckedChange={(value) =>
            onSave({ enabled: Boolean(value), schedule, param })
          }
        />
      </TableCell>
      <TableCell>
        <Tooltip content={meta.description}>
          <span className="block max-w-[34rem]">
            <span className="block font-medium text-fg">{meta.label}</span>
            <span className="block truncate text-label text-fg-muted">
              {meta.description}
            </span>
          </span>
        </Tooltip>
        {meta.param && enabled ? (
          <label className="mt-1 flex items-center gap-2 text-label text-fg-muted">
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
                  onSave({ enabled, schedule, param: next })
                }
              }}
            />
            {meta.param.unit}
          </label>
        ) : null}
      </TableCell>
      <TableCell>
        <Select
          size="sm"
          aria-label={`${meta.label}: ${t('agents.watchers.schedule')}`}
          value={schedule}
          disabled={busy}
          onChange={(event) =>
            onSave({
              enabled,
              schedule: event.target.value as WatcherSchedule,
              param,
            })
          }
        >
          {WATCHER_SCHEDULES.map((value) => (
            <option key={value} value={value}>
              {WATCHER_SCHEDULE_LABEL[value]}
            </option>
          ))}
        </Select>
      </TableCell>
      <TableCell className="text-fg-muted">
        {row?.last_run_at
          ? formatDate(row.last_run_at, { time: true })
          : t('agents.watchers.never')}
      </TableCell>
      <TableCell>{row?.last_found ?? ''}</TableCell>
      <TableCell className="text-right">
        {row && enabled ? (
          <Button size="sm" disabled={looking} onClick={() => onLook(row.id)}>
            {looking
              ? t('agents.watchers.looking')
              : t('agents.watchers.runNow')}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function FindingRow({
  finding,
  busy,
  onChange,
}: {
  finding: LabWatcherFindingRow
  busy: boolean
  onChange: (
    action: 'dismiss' | 'snooze' | 'reopen' | 'act',
    days?: number,
  ) => void
}) {
  const setAside =
    finding.status === 'snoozed' || finding.status === 'dismissed'
  return (
    <TableRow>
      <TableCell>
        {finding.object_id ? (
          <ObjectLink
            kind={finding.object_kind}
            id={finding.object_id}
            mono={false}
          >
            {finding.title}
          </ObjectLink>
        ) : (
          <span className="font-medium text-fg">{finding.title}</span>
        )}
      </TableCell>
      <TableCell className="text-fg-muted">
        <Tooltip content={finding.summary}>
          <span className="block max-w-[30rem] truncate">
            {finding.summary}
          </span>
        </Tooltip>
      </TableCell>
      <TableCell>
        <Status tone={STATUS_TONE[finding.status]}>
          {finding.status === 'snoozed' && finding.snoozed_until
            ? t('agents.watchers.snoozedUntil', {
                date: formatDate(finding.snoozed_until),
              })
            : STATUS_LABEL[finding.status]}
        </Status>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap justify-end gap-1.5">
          {finding.status === 'open' && finding.suggested_action ? (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => onChange('act')}
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
                    onChange('snooze', Number(event.target.value))
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
                onClick={() => onChange('dismiss')}
              >
                {t('agents.watchers.dismiss')}
              </Button>
            </>
          ) : null}
          {setAside ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onChange('reopen')}
            >
              {t('agents.watchers.reopen')}
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}
