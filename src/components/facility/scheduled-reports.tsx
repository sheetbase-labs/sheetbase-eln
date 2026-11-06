/**
 * Scheduled reports: the list under Settings, and the form that sets one up.
 * The form is also opened from a report's own page ("Email this report") with
 * the report already chosen.
 */
import { useMemo, useState } from 'react'
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
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { fetchWorkspaceMemberIdentities } from '#/components/projects/project-data'
import { t } from '#/copy'
import { hasCapability } from '#/lib/capability'
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

const client = notebookDataClient

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Who may schedule a kind of report: the same rule the database applies. */
export function canScheduleKind(
  role: string | null | undefined,
  kind: ReportKind,
): boolean {
  return (
    hasCapability(role, 'schema.edit') ||
    (kind === 'instrument_usage' && hasCapability(role, 'instrument.manage'))
  )
}

const MEMBERS_KEY = ['scheduled-reports', 'members'] as const
const PROJECTS_KEY = ['scheduled-reports', 'projects'] as const

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export interface ScheduleReportInitial {
  kind: ReportKind
  projectId?: string | null
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

  const kinds = REPORT_KINDS.filter((k) => canScheduleKind(role, k))
  const [name, setName] = useState(report?.name ?? '')
  const [kind, setKind] = useState<ReportKind>(
    report?.kind ?? initial?.kind ?? kinds.at(0) ?? 'spend',
  )
  const [projectId, setProjectId] = useState(
    report?.projectId ?? initial?.projectId ?? '',
  )
  const [period, setPeriod] = useState<ScheduledPeriod>(
    report?.period ?? 'previous_week',
  )
  const [openHours, setOpenHours] = useState(String(report?.openHours ?? 10))
  const [frequency, setFrequency] = useState<Frequency>(
    report?.frequency ?? 'weekly',
  )
  const [weekday, setWeekday] = useState(report?.weekday ?? 1)
  const [monthDay, setMonthDay] = useState(report?.monthDay ?? 1)
  const [sendHour, setSendHour] = useState(report?.sendHour ?? 8)
  const [recipients, setRecipients] = useState<string[]>(
    report?.recipientUserIds ?? (auth?.user.id ? [auth.user.id] : []),
  )
  const [error, setError] = useState<string | null>(null)

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

  const scheduleZone = report?.timeZone ?? zone
  const hasProject = kind !== 'instrument_usage'

  const save = useMutation({
    mutationFn: () =>
      saveScheduledReport(client, {
        id: report?.id ?? null,
        name: name.trim() || t(`spend.schedule.kinds.${kind}`),
        kind,
        projectId: hasProject && projectId ? projectId : null,
        period,
        openHours: Number(openHours) || 10,
        frequency,
        weekday,
        monthDay,
        sendHour,
        timeZone: scheduleZone,
        recipientUserIds: recipients,
        active: report?.active ?? true,
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
    onError: (e: unknown) =>
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
          <form
            id="schedule-report-form"
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (recipients.length === 0) {
                setError(t('spend.schedule.form.noRecipients'))
                return
              }
              setError(null)
              save.mutate()
            }}
          >
            <Field label={t('spend.schedule.form.kind')}>
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as ReportKind)}
                disabled={save.isPending || report !== undefined}
              >
                {kinds.map((key) => (
                  <option key={key} value={key}>
                    {t(`spend.schedule.kinds.${key}`)}
                  </option>
                ))}
              </Select>
              <span className="text-fg-muted">
                {t(`spend.schedule.kindHints.${kind}`)}
              </span>
            </Field>
            <Field label={t('spend.schedule.form.name')}>
              <Input
                value={name}
                placeholder={t('spend.schedule.form.namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
                disabled={save.isPending}
              />
            </Field>
            {hasProject ? (
              <Field label={t('spend.schedule.form.project')}>
                <Select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={save.isPending}
                >
                  <option value="">
                    {t('spend.schedule.form.allProjects')}
                  </option>
                  {(projects.data ?? []).map((p) => (
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
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as ScheduledPeriod)}
                  disabled={save.isPending}
                >
                  {SCHEDULED_PERIODS.map((key) => (
                    <option key={key} value={key}>
                      {t(`spend.periods.${key}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {kind === 'instrument_usage' ? (
                <Field label={t('spend.schedule.form.openHours')}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    max="24"
                    step="0.5"
                    value={openHours}
                    onChange={(e) => setOpenHours(e.target.value)}
                    disabled={save.isPending}
                  />
                </Field>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
              <Field label={t('spend.schedule.form.frequency')}>
                <Select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as Frequency)}
                  disabled={save.isPending}
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
                    onChange={(e) => setWeekday(Number(e.target.value))}
                    disabled={save.isPending}
                  >
                    {(['1', '2', '3', '4', '5', '6', '0'] as const).map(
                      (day) => (
                        <option key={day} value={day}>
                          {t(`spend.schedule.weekdays.${day}`)}
                        </option>
                      ),
                    )}
                  </Select>
                </Field>
              ) : null}
              {frequency === 'monthly' ? (
                <Field label={t('spend.schedule.form.monthDay')}>
                  <Select
                    value={String(monthDay)}
                    onChange={(e) => setMonthDay(Number(e.target.value))}
                    disabled={save.isPending}
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
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
                  onChange={(e) => setSendHour(Number(e.target.value))}
                  disabled={save.isPending}
                >
                  {hours.map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="m-0 text-label text-fg-muted">
              {t('spend.schedule.form.timeZone', { zone: scheduleZone })}
            </p>
            <Field
              label={t('spend.schedule.form.recipients')}
              hint={t('spend.schedule.form.recipientsHint')}
              error={error}
            >
              <span className="flex max-h-44 flex-col gap-1.5 overflow-auto rounded-md border border-border px-2.5 py-2">
                {(members.data ?? []).map((m) => (
                  <label
                    key={m.user_id}
                    className="flex items-center gap-2 text-body"
                  >
                    <Checkbox
                      checked={recipients.includes(m.user_id)}
                      onCheckedChange={(checked) => {
                        setError(null)
                        setRecipients((current) =>
                          checked === true
                            ? [...current, m.user_id]
                            : current.filter((id) => id !== m.user_id),
                        )
                      }}
                    />
                    {m.name}
                  </label>
                ))}
              </span>
            </Field>
          </form>
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
  const canSchedule = REPORT_KINDS.some((kind) => canScheduleKind(role, kind))
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
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('spend.schedule.toasts.couldNotChange'))),
  })

  const rows = reports.data ?? []

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
          <Table caption={t('spend.schedule.tableLabel')}>
            <TableHeader>
              <tr>
                <TableHead>{t('spend.schedule.columns.name')}</TableHead>
                <TableHead>{t('spend.schedule.columns.sends')}</TableHead>
                <TableHead>{t('spend.schedule.columns.recipients')}</TableHead>
                <TableHead>{t('spend.schedule.columns.lastSent')}</TableHead>
                <TableHead>{t('spend.schedule.columns.nextSend')}</TableHead>
                <TableHead>
                  <span className="sr-only">
                    {t('spend.schedule.columns.actions')}
                  </span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map((report) => {
                const manage = canScheduleKind(role, report.kind)
                return (
                  <TableRow key={report.id}>
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="font-medium text-fg">
                          {report.name}
                        </span>
                        <span className="text-label text-fg-muted">
                          {t(`spend.schedule.kinds.${report.kind}`)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>{describeSchedule(report)}</TableCell>
                    <TableCell>
                      {t('spend.schedule.recipientCount', {
                        count: report.recipientUserIds.length,
                      })}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {resultLabel(report)}
                    </TableCell>
                    <TableCell>
                      {report.active ? (
                        formatDate(report.nextRunAt, { time: true })
                      ) : (
                        <Status tone="none">
                          {t('spend.schedule.paused')}
                        </Status>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {manage ? (
                        <span className="flex justify-end gap-1.5">
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
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableBox>
      )}
      {creating ? (
        <ScheduleReportDialog
          open
          onOpenChange={(open) => !open && setCreating(false)}
        />
      ) : null}
      {editing ? (
        <ScheduleReportDialog
          open
          report={editing}
          onOpenChange={(open) => !open && setEditing(null)}
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
