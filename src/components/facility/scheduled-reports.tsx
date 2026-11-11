/**
 * Scheduled reports: the list under Settings, and the form that sets one up.
 * The form is also opened from a report's own page ("Email this report") with
 * the report already chosen.
 */
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'

import { SettingsBody } from '#/components/settings/settings-page'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { fetchWorkspaceMemberIdentities } from '#/components/projects/project-data'
import type { WorkspaceMemberIdentity } from '#/components/projects/project-data'
import { t } from '#/copy'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { SCHEDULED_PERIODS } from '#/lib/report-period'
import type { ScheduledPeriod } from '#/lib/report-period'
import {
  FREQUENCIES,
  REPORT_KINDS,
  deleteScheduledReport,
  describeSchedule,
  fetchScheduledReports,
  hourOptions,
  saveScheduledReport,
  scheduledReportKeys,
  sendScheduledReportNow,
  setScheduledReportActive,
} from '#/lib/scheduled-reports'
import type {
  Frequency,
  ReportKind,
  ScheduledReport,
} from '#/lib/scheduled-reports'
import { canScheduleKind } from './scheduled-report-access'

const client = notebookDataClient

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A caught transport failure is untyped by definition; an Error supplies its message and anything else falls back.
function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const MEMBERS_KEY = ['scheduled-reports', 'members'] as const
const PROJECTS_KEY = ['scheduled-reports', 'projects'] as const

const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '0'] as const
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1)

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export interface ScheduleReportInitial {
  kind: ReportKind
  projectId?: string | null
}

/** Everything the form can change, seeded from the report it edits (if any). */
interface ScheduleDraft {
  name: string
  kind: ReportKind
  projectId: string
  period: ScheduledPeriod
  openHours: string
  frequency: Frequency
  weekday: number
  monthDay: number
  sendHour: number
  recipients: string[]
  timeZone: string
  active: boolean
}

/** The form's opening values: the existing schedule, else the caller's choice. */
function draftFrom({
  report,
  initial,
  kinds,
  zone,
  userId,
}: {
  report?: ScheduledReport
  initial?: ScheduleReportInitial
  kinds: readonly ReportKind[]
  zone: string
  userId: string | undefined
}): ScheduleDraft {
  return {
    name: report?.name ?? '',
    kind: report?.kind ?? initial?.kind ?? kinds.at(0) ?? 'spend',
    projectId: report?.projectId ?? initial?.projectId ?? '',
    period: report?.period ?? 'previous_week',
    openHours: String(report?.openHours ?? 10),
    frequency: report?.frequency ?? 'weekly',
    weekday: report?.weekday ?? 1,
    monthDay: report?.monthDay ?? 1,
    sendHour: report?.sendHour ?? 8,
    recipients: report?.recipientUserIds ?? (userId ? [userId] : []),
    timeZone: report?.timeZone ?? zone,
    active: report?.active ?? true,
  }
}

/** When the report goes: its cadence and the time of day. */
function ScheduleCadenceFields({
  frequency,
  weekday,
  monthDay,
  sendHour,
  hours,
  pending,
  onFrequency,
  onWeekday,
  onMonthDay,
  onSendHour,
}: {
  frequency: Frequency
  weekday: number
  monthDay: number
  sendHour: number
  hours: ReturnType<typeof hourOptions>
  pending: boolean
  onFrequency: (frequency: Frequency) => void
  onWeekday: (weekday: number) => void
  onMonthDay: (monthDay: number) => void
  onSendHour: (sendHour: number) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
      <Field label={t('spend.schedule.form.frequency')}>
        <Select
          value={frequency}
          onChange={(e) =>
            onFrequency(
              FREQUENCIES.find((key) => key === e.target.value) ?? frequency,
            )
          }
          disabled={pending}
        >
          {FREQUENCIES.map((key) => (
            <option key={key} value={key}>
              {t(`spend.schedule.frequencies.${key}`)}
            </option>
          ))}
        </Select>
      </Field>
      {frequency === 'weekly' ? (
        <Field label={t('spend.schedule.form.weekday')}>
          <Select
            value={String(weekday)}
            onChange={(e) => onWeekday(Number(e.target.value))}
            disabled={pending}
          >
            {WEEKDAYS.map((day) => (
              <option key={day} value={day}>
                {t(`spend.schedule.weekdays.${day}`)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {frequency === 'monthly' ? (
        <Field label={t('spend.schedule.form.monthDay')}>
          <Select
            value={String(monthDay)}
            onChange={(e) => onMonthDay(Number(e.target.value))}
            disabled={pending}
          >
            {MONTH_DAYS.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t('spend.schedule.form.time')}>
        <Select
          value={String(sendHour)}
          onChange={(e) => onSendHour(Number(e.target.value))}
          disabled={pending}
        >
          {hours.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}

/** Who receives the report, one checkbox per member. */
function RecipientPicker({
  members,
  recipients,
  error,
  onToggle,
}: {
  members: readonly WorkspaceMemberIdentity[]
  recipients: string[]
  error: string | null
  onToggle: (userId: string, checked: boolean) => void
}) {
  const chosen = new Set(recipients)

  return (
    <Field
      label={t('spend.schedule.form.recipients')}
      hint={t('spend.schedule.form.recipientsHint')}
      error={error}
    >
      <span className="flex max-h-44 flex-col gap-1.5 overflow-auto rounded-md border border-border px-2.5 py-2">
        {members.map((m) => (
          <label key={m.user_id} className="flex items-center gap-2 text-body">
            <Checkbox
              checked={chosen.has(m.user_id)}
              onCheckedChange={(checked) =>
                onToggle(m.user_id, checked === true)
              }
            />
            {m.name}
          </label>
        ))}
      </span>
    </Field>
  )
}

/** The form's fields: what to send, when, to whom. */
function ScheduleReportFields({
  draft,
  patch,
  kinds,
  kindLocked,
  hours,
  projects,
  members,
  error,
  pending,
  onToggleRecipient,
  onSubmit,
}: {
  draft: ScheduleDraft
  patch: (next: Partial<ScheduleDraft>) => void
  kinds: readonly ReportKind[]
  /** An existing schedule keeps its kind; only a new one chooses it. */
  kindLocked: boolean
  hours: ReturnType<typeof hourOptions>
  projects: ReadonlyArray<{ id: string; title: string }>
  members: readonly WorkspaceMemberIdentity[]
  error: string | null
  pending: boolean
  onToggleRecipient: (userId: string, checked: boolean) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const hasProject = draft.kind !== 'instrument_usage'

  return (
    <form
      id="schedule-report-form"
      className="flex flex-col gap-4"
      onSubmit={onSubmit}
    >
      <Field label={t('spend.schedule.form.kind')}>
        <Select
          value={draft.kind}
          onChange={(e) =>
            patch({
              kind: kinds.find((key) => key === e.target.value) ?? draft.kind,
            })
          }
          disabled={pending || kindLocked}
        >
          {kinds.map((key) => (
            <option key={key} value={key}>
              {t(`spend.schedule.kinds.${key}`)}
            </option>
          ))}
        </Select>
        <span className="text-fg-muted">
          {t(`spend.schedule.kindHints.${draft.kind}`)}
        </span>
      </Field>
      <Field label={t('spend.schedule.form.name')}>
        <Input
          value={draft.name}
          placeholder={t('spend.schedule.form.namePlaceholder')}
          onChange={(e) => patch({ name: e.target.value })}
          disabled={pending}
        />
      </Field>
      {hasProject ? (
        <Field label={t('spend.schedule.form.project')}>
          <Select
            value={draft.projectId}
            onChange={(e) => patch({ projectId: e.target.value })}
            disabled={pending}
          >
            <option value="">{t('spend.schedule.form.allProjects')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label={t('spend.schedule.form.period')}>
          <Select
            value={draft.period}
            onChange={(e) =>
              patch({
                period:
                  SCHEDULED_PERIODS.find((key) => key === e.target.value) ??
                  draft.period,
              })
            }
            disabled={pending}
          >
            {SCHEDULED_PERIODS.map((key) => (
              <option key={key} value={key}>
                {t(`spend.periods.${key}`)}
              </option>
            ))}
          </Select>
        </Field>
        {hasProject ? null : (
          <Field label={t('spend.schedule.form.openHours')}>
            <Input
              type="number"
              inputMode="decimal"
              min="1"
              max="24"
              step="0.5"
              value={draft.openHours}
              onChange={(e) => patch({ openHours: e.target.value })}
              disabled={pending}
            />
          </Field>
        )}
      </div>
      <ScheduleCadenceFields
        frequency={draft.frequency}
        weekday={draft.weekday}
        monthDay={draft.monthDay}
        sendHour={draft.sendHour}
        hours={hours}
        pending={pending}
        onFrequency={(frequency) => patch({ frequency })}
        onWeekday={(weekday) => patch({ weekday })}
        onMonthDay={(monthDay) => patch({ monthDay })}
        onSendHour={(sendHour) => patch({ sendHour })}
      />
      <p className="m-0 text-label text-fg-muted">
        {t('spend.schedule.form.timeZone', { zone: draft.timeZone })}
      </p>
      <RecipientPicker
        members={members}
        recipients={draft.recipients}
        error={error}
        onToggle={onToggleRecipient}
      />
    </form>
  )
}

export function ScheduleReportDialog({
  open,
  onOpenChange,
  report,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** An existing schedule to change; omit to set up a new one. */
  report?: ScheduledReport
  /** The report to start from when setting up a new one. */
  initial?: ScheduleReportInitial
}) {
  const { auth } = useRouteContext({ from: '__root__' })
  const role = auth?.workspace?.role
  const queryClient = useQueryClient()
  const zone = useDisplayTimeZone()
  const hours = useMemo(hourOptions, [])

  const kinds = useMemo(
    () => REPORT_KINDS.filter((kind) => canScheduleKind(role, kind)),
    [role],
  )

  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    draftFrom({ report, initial, kinds, zone, userId: auth?.user.id }),
  )

  const [error, setError] = useState<string | null>(null)

  const patch = (next: Partial<ScheduleDraft>) =>
    setDraft((current) => ({ ...current, ...next }))

  const toggleRecipient = (userId: string, checked: boolean) => {
    setError(null)
    patch({
      recipients: checked
        ? [...draft.recipients, userId]
        : draft.recipients.filter((id) => id !== userId),
    })
  }

  const members = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: fetchWorkspaceMemberIdentities,
    staleTime: 60_000,
  })

  const projects = useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: () =>
      client.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&archived_at=is.null&order=title.asc&limit=500',
      ),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: () =>
      saveScheduledReport(client, {
        id: report?.id ?? null,
        name: draft.name.trim() || t(`spend.schedule.kinds.${draft.kind}`),
        kind: draft.kind,
        projectId:
          draft.kind === 'instrument_usage' || !draft.projectId
            ? null
            : draft.projectId,
        period: draft.period,
        openHours: Number(draft.openHours) || 10,
        frequency: draft.frequency,
        weekday: draft.weekday,
        monthDay: draft.monthDay,
        sendHour: draft.sendHour,
        timeZone: draft.timeZone,
        recipientUserIds: draft.recipients,
        active: draft.active,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduledReportKeys.all })
      toast.success(
        report
          ? t('spend.schedule.toasts.updated')
          : t('spend.schedule.toasts.saved'),
      )
      onOpenChange(false)
    },
    onError: (e) =>
      toast.error(messageOf(e, t('spend.schedule.toasts.couldNotSave'))),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={
            report
              ? t('spend.schedule.form.editTitle')
              : t('spend.schedule.form.newTitle')
          }
        />
        <DialogBody>
          <ScheduleReportFields
            draft={draft}
            patch={patch}
            kinds={kinds}
            kindLocked={report !== undefined}
            hours={hours}
            projects={projects.data ?? []}
            members={members.data ?? []}
            error={error}
            pending={save.isPending}
            onToggleRecipient={toggleRecipient}
            onSubmit={(event) => {
              event.preventDefault()

              if (draft.recipients.length === 0) {
                setError(t('spend.schedule.form.noRecipients'))

                return
              }

              setError(null)
              save.mutate()
            }}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="schedule-report-form"
            disabled={save.isPending}
          >
            {report
              ? t('spend.schedule.form.saveChanges')
              : t('spend.schedule.form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** How the last send went, in a few words. */
function resultLabel(report: ScheduledReport): string {
  if (!report.lastRunAt) return t('spend.schedule.neverSent')
  const when = formatDate(report.lastRunAt, { time: true })
  const result = report.lastResult ?? ''

  if (result.startsWith('failed:')) {
    return `${when} · ${t('spend.schedule.lastResult.failed', { reason: result.slice(7).trim() })}`
  }

  if ((report.lastRecipientCount ?? 0) === 0) {
    return `${when} · ${t('spend.schedule.lastResult.nobody')}`
  }

  return `${when} · ${t('spend.schedule.lastResult.sent', { count: report.lastRecipientCount ?? 0 })}`
}

export function ScheduledReportsPanel({
  emailConfigured,
}: {
  emailConfigured: boolean
}) {
  const { auth } = useRouteContext({ from: '__root__' })
  const role = auth?.workspace?.role
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ScheduledReport | null>(null)
  const [deleting, setDeleting] = useState<ScheduledReport | null>(null)

  const reports = useQuery({
    queryKey: scheduledReportKeys.all,
    queryFn: () => fetchScheduledReports(client),
    staleTime: 10_000,
  })

  // Which kinds this person may manage is decided once, not per row.
  const manageableKinds = new Set(
    REPORT_KINDS.filter((kind) => canScheduleKind(role, kind)),
  )

  const canSchedule = manageableKinds.size > 0

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: scheduledReportKeys.all })

  const act = useMutation({
    mutationFn: async (action: {
      report: ScheduledReport
      what: 'now' | 'pause' | 'resume' | 'delete'
    }) => {
      const { report, what } = action

      if (what === 'now') return sendScheduledReportNow(client, report.id)

      if (what === 'delete') return deleteScheduledReport(client, report.id)

      return setScheduledReportActive(client, report.id, what === 'resume')
    },
    onSuccess: (_result, action) => {
      refresh()
      toast(
        {
          now: t('spend.schedule.toasts.sendQueued'),
          pause: t('spend.schedule.toasts.paused'),
          resume: t('spend.schedule.toasts.resumed'),
          delete: t('spend.schedule.toasts.deleted'),
        }[action.what],
      )
    },
    onError: (e) =>
      toast.error(messageOf(e, t('spend.schedule.toasts.couldNotChange'))),
  })

  const rows = reports.data ?? []

  const columns: RegistryColumn<ScheduledReport>[] = [
    {
      id: 'name',
      header: t('spend.schedule.columns.name'),
      accessorFn: (report) => report.name,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.original.name}</span>
          <span className="text-label text-fg-muted">
            {t(`spend.schedule.kinds.${row.original.kind}`)}
          </span>
        </span>
      ),
    },
    {
      id: 'sends',
      header: t('spend.schedule.columns.sends'),
      enableSorting: false,
      cell: ({ row }) => describeSchedule(row.original),
    },
    {
      id: 'recipients',
      header: t('spend.schedule.columns.recipients'),
      accessorFn: (report) => report.recipientUserIds.length,
      cell: ({ row }) =>
        t('spend.schedule.recipientCount', {
          count: row.original.recipientUserIds.length,
        }),
    },
    {
      id: 'nextSend',
      header: t('spend.schedule.columns.nextSend'),
      accessorFn: (report) => (report.active ? report.nextRunAt : ''),
      cell: ({ row }) => (
        <span className="flex flex-col">
          {row.original.active ? (
            formatDate(row.original.nextRunAt, { time: true })
          ) : (
            <Status tone="none">{t('spend.schedule.paused')}</Status>
          )}
          <span className="text-label text-fg-muted">
            {resultLabel(row.original)}
          </span>
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('spend.schedule.columns.actions'),
      enableHiding: false,
      cell: ({ row }) => {
        const report = row.original

        return manageableKinds.has(report.kind) ? (
          <span className="flex justify-end gap-1.5 whitespace-nowrap">
            <Button
              size="sm"
              disabled={act.isPending}
              onClick={() => act.mutate({ report, what: 'now' })}
            >
              {t('spend.schedule.actions.sendNow')}
            </Button>
            <Button size="sm" onClick={() => setEditing(report)}>
              {t('spend.schedule.actions.edit')}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={act.isPending}
              onClick={() =>
                act.mutate({
                  report,
                  what: report.active ? 'pause' : 'resume',
                })
              }
            >
              {report.active
                ? t('spend.schedule.actions.pause')
                : t('spend.schedule.actions.resume')}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setDeleting(report)}
            >
              {t('spend.schedule.actions.delete')}
            </Button>
          </span>
        ) : null
      },
    },
  ]

  return (
    <SettingsBody>
      {!emailConfigured ? (
        <Notice tone="warn">{t('spend.schedule.emailOff')}</Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1" />
        {canSchedule ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('spend.schedule.new')}
          </Button>
        ) : (
          <p className="m-0 text-label text-fg-muted">
            {t('spend.schedule.readOnly')}
          </p>
        )}
      </div>
      {reports.isError ? (
        <p role="alert" className="m-0 text-body text-danger-text">
          {t('spend.schedule.loadError')}
        </p>
      ) : !reports.isPending && rows.length === 0 ? (
        <EmptyState
          className="items-center py-10 text-center"
          icon="calendar"
          title={t('spend.schedule.empty.title')}
          description={t('spend.schedule.empty.body')}
        />
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('spend.schedule.tableLabel')}
            rows={rows}
            columns={columns}
            getRowId={(report) => report.id}
            selectable={false}
            rowHeight={48}
            isLoading={reports.isPending}
          />
        </TableBox>
      )}
      {creating || editing ? (
        <ScheduleReportDialog
          key={editing?.id ?? 'new'}
          open
          report={editing ?? undefined}
          onOpenChange={(open) => {
            if (open) return

            setCreating(false)
            setEditing(null)
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('spend.schedule.confirmDelete.title')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('spend.schedule.confirmDelete.body', {
                name: deleting?.name ?? '',
              })}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                if (deleting) act.mutate({ report: deleting, what: 'delete' })
                setDeleting(null)
              }}
            >
              {t('spend.schedule.confirmDelete.confirm')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </SettingsBody>
  )
}
