/**
 * Instrument usage: the hours each instrument was booked, how much of its open
 * time that is, who used it and for which project, and what that use costs at
 * the instrument's hourly rate. The recharge export hands a finance office a
 * file per project or per person.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'

import {
  PeriodPicker,
  ReportFigures,
  useReportRange,
} from '#/components/facility/report-controls'
import {
  ScheduleReportDialog,
  canScheduleKind,
} from '#/components/facility/scheduled-reports'
import { useInstruments } from '#/components/instruments/instruments-data'
import { ListFooter } from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useWorkspaceMemberNames } from '#/components/projects/project-data'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { EmptyState } from '#/components/ui/empty-state'
import { Input } from '#/components/ui/input'
import { Progress } from '#/components/ui/progress'
import { toast } from '#/components/ui/sonner'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import { downloadTextFile } from '#/lib/download'
import { formatDate } from '#/lib/format-date'
import {
  bookingsCsv,
  fetchInstrumentRates,
  fetchUsageLines,
  groupUsage,
  rechargeCsv,
  usageKeys,
  utilisationByInstrument,
} from '#/lib/facility-usage'
import type {
  InstrumentUtilisation,
  UsageGroup,
  UsageLabels,
  UsageLine,
} from '#/lib/facility-usage'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  formatHours,
  formatMoney,
  formatShare,
  formatTotals,
} from '#/lib/report-period'
import type { MoneyTotals } from '#/lib/report-period'

const client = notebookDataClient

type View = 'instrument' | 'person' | 'project' | 'bookings'
const VIEWS: readonly View[] = ['instrument', 'person', 'project', 'bookings']

function totalOf(groups: readonly { charges: MoneyTotals }[]): MoneyTotals {
  const totals: MoneyTotals = {}
  for (const group of groups) {
    for (const [currency, amount] of Object.entries(group.charges)) {
      totals[currency] =
        Math.round(((totals[currency] ?? 0) + amount) * 100) / 100
    }
  }
  return totals
}

export function InstrumentUsagePanel() {
  const { auth } = useRouteContext({ from: '__root__' })
  const workspaceId = auth?.workspace?.id ?? ''
  const canEmail = canScheduleKind(auth?.workspace?.role, 'instrument_usage')
  const state = useReportRange('last_month')
  const [view, setView] = useState<View>('instrument')
  const [openHours, setOpenHours] = useState('10')
  const [emailing, setEmailing] = useState(false)
  const names = useWorkspaceMemberNames()
  const instruments = useInstruments()

  const lines = useQuery({
    queryKey: usageKeys.lines(
      workspaceId,
      state.range?.from.toISOString() ?? '',
      state.range?.to.toISOString() ?? '',
    ),
    queryFn: () => fetchUsageLines(client, workspaceId, state.range!),
    enabled: workspaceId !== '' && state.range !== null,
    staleTime: 15_000,
  })
  const rates = useQuery({
    queryKey: usageKeys.rates,
    queryFn: () => fetchInstrumentRates(client),
    staleTime: 30_000,
  })

  const all = useMemo(() => lines.data ?? [], [lines.data])
  const hoursOpen = Number(openHours)
  const validHours =
    Number.isFinite(hoursOpen) && hoursOpen > 0 && hoursOpen <= 24

  const labels = useMemo<UsageLabels>(
    () => ({
      person: (userId) =>
        userId ? (names.data?.get(userId) ?? userId) : t('spend.noPerson'),
      project: (line) => line.projectTitle ?? t('spend.noProject'),
    }),
    [names.data],
  )

  // Every instrument in service shows, so one that nobody booked reads 0%.
  const utilisation = useMemo<InstrumentUtilisation[]>(() => {
    if (!state.range || !validHours) return []
    const booked = utilisationByInstrument(
      all,
      state.range,
      hoursOpen,
      state.zone,
    )
    const seen = new Set(booked.map((row) => row.key))
    const open = booked.at(0)?.openHours ?? 0
    const idle: InstrumentUtilisation[] = (instruments.data ?? [])
      .filter((i) => !i.retiredAt && !seen.has(i.id))
      .map((i) => ({
        key: i.id,
        id: i.id,
        bookings: 0,
        hours: 0,
        charges: {},
        name: i.name,
        code: i.displayId,
        openHours: open,
        utilisation: 0,
        people: 0,
      }))
    return [...booked, ...idle]
  }, [all, instruments.data, state.range, state.zone, hoursOpen, validHours])

  const people = useMemo(() => groupUsage(all, 'person'), [all])
  const projects = useMemo(() => groupUsage(all, 'project'), [all])
  const totalHours = all.reduce((sum, line) => sum + line.hours, 0)
  const charges = useMemo(() => totalOf(projects), [projects])
  const rated = (rates.data ?? []).length > 0
  const lineByGroup = useMemo(() => {
    const byPerson = new Map<string, UsageLine>()
    const byProject = new Map<string, UsageLine>()
    for (const line of all) {
      if (line.userId) byPerson.set(line.userId, line)
      if (line.projectId) byProject.set(line.projectId, line)
    }
    return { byPerson, byProject }
  }, [all])

  const overall = useMemo(() => {
    const open = utilisation.at(0)?.openHours ?? 0
    const count = utilisation.length
    return open > 0 && count > 0 ? totalHours / (open * count) : 0
  }, [utilisation, totalHours])

  const save = (name: string, contents: string) => {
    try {
      downloadTextFile(
        `${name}-${state.range?.from.toISOString().slice(0, 10) ?? ''}.csv`,
        contents,
        'text/csv',
      )
    } catch {
      toast.error(t('spend.actions.couldNotExport'))
    }
  }

  const instrumentColumns = useMemo<RegistryColumn<InstrumentUtilisation>[]>(
    () => [
      {
        id: 'instrument',
        header: t('spend.usage.columns.instrument'),
        accessorFn: (row) => row.name,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="flex min-w-0 items-baseline gap-2">
            {row.original.code ? (
              <span className="mono text-fg-muted">{row.original.code}</span>
            ) : null}
            <span className="truncate font-medium text-fg">
              {row.original.name}
            </span>
          </span>
        ),
      },
      {
        id: 'bookings',
        header: t('spend.usage.columns.bookings'),
        accessorFn: (row) => row.bookings,
        size: 100,
        cell: ({ row }) => <span className="num">{row.original.bookings}</span>,
      },
      {
        id: 'people',
        header: t('spend.usage.columns.people'),
        accessorFn: (row) => row.people,
        size: 90,
        cell: ({ row }) => <span className="num">{row.original.people}</span>,
      },
      {
        id: 'hours',
        header: t('spend.usage.columns.hours'),
        accessorFn: (row) => row.hours,
        size: 90,
        cell: ({ row }) => (
          <span className="num">{formatHours(row.original.hours)}</span>
        ),
      },
      {
        id: 'utilisation',
        header: t('spend.usage.columns.utilisation'),
        accessorFn: (row) => row.utilisation,
        size: 180,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <Progress
              className="w-20"
              label={t('spend.usage.columns.utilisation')}
              value={Math.min(row.original.utilisation, 1) * 100}
              valueText={formatShare(row.original.utilisation)}
              tone={row.original.utilisation > 1 ? 'warning' : 'accent'}
            />
            <span className="num w-10 text-right">
              {formatShare(row.original.utilisation)}
            </span>
          </span>
        ),
      },
      {
        id: 'rate',
        header: t('spend.usage.columns.rate'),
        accessorFn: (row) => {
          const rate = rates.data?.find((r) => r.instrumentId === row.key)
          return rate ? formatMoney(rate.ratePerHour, rate.currency) : ''
        },
        size: 110,
        cell: ({ row }) => {
          const rate = rates.data?.find(
            (r) => r.instrumentId === row.original.key,
          )
          return rate ? (
            <span className="num">
              {formatMoney(rate.ratePerHour, rate.currency)}
            </span>
          ) : (
            <span className="text-fg-muted">—</span>
          )
        },
      },
      {
        id: 'charge',
        header: t('spend.usage.columns.charge'),
        accessorFn: (row) => formatTotals(row.charges),
        size: 130,
        cell: ({ row }) => (
          <span className="num">
            {formatTotals(row.original.charges) || '—'}
          </span>
        ),
      },
    ],
    [rates.data],
  )

  const groupColumns = useMemo<RegistryColumn<UsageGroup>[]>(
    () => [
      {
        id: 'who',
        header:
          view === 'person'
            ? t('spend.usage.columns.person')
            : t('spend.usage.columns.project'),
        accessorFn: (g) =>
          view === 'person'
            ? labels.person(g.id)
            : g.id
              ? (lineByGroup.byProject.get(g.id)?.projectTitle ??
                t('spend.noProject'))
              : t('spend.noProject'),
        enableHiding: false,
      },
      {
        id: 'bookings',
        header: t('spend.usage.columns.bookings'),
        accessorFn: (g) => g.bookings,
        size: 100,
        cell: ({ row }) => <span className="num">{row.original.bookings}</span>,
      },
      {
        id: 'hours',
        header: t('spend.usage.columns.hours'),
        accessorFn: (g) => g.hours,
        size: 100,
        cell: ({ row }) => (
          <span className="num">{formatHours(row.original.hours)}</span>
        ),
      },
      {
        id: 'charge',
        header: t('spend.usage.columns.charge'),
        accessorFn: (g) => formatTotals(g.charges),
        size: 160,
        cell: ({ row }) => (
          <span className="num">
            {formatTotals(row.original.charges) || '—'}
          </span>
        ),
      },
    ],
    [view, labels, lineByGroup],
  )

  const bookingColumns = useMemo<RegistryColumn<UsageLine>[]>(
    () => [
      {
        id: 'booking',
        header: t('spend.usage.columns.booking'),
        accessorFn: (l) => l.title,
        enableHiding: false,
      },
      {
        id: 'instrument',
        header: t('spend.usage.columns.instrument'),
        accessorFn: (l) => l.instrumentName,
      },
      {
        id: 'person',
        header: t('spend.usage.columns.person'),
        accessorFn: (l) => labels.person(l.userId),
      },
      {
        id: 'project',
        header: t('spend.usage.columns.project'),
        accessorFn: (l) => l.projectTitle ?? t('spend.noProject'),
      },
      {
        id: 'starts',
        header: t('spend.usage.columns.starts'),
        accessorFn: (l) => l.startsAt,
        size: 170,
        cell: ({ row }) => formatDate(row.original.startsAt, { time: true }),
      },
      {
        id: 'hours',
        header: t('spend.usage.columns.hours'),
        accessorFn: (l) => l.hours,
        size: 90,
        cell: ({ row }) => (
          <span className="num">{formatHours(row.original.hours)}</span>
        ),
      },
    ],
    [labels],
  )

  const empty = !lines.isPending && all.length === 0 && view !== 'instrument'
  const groups = view === 'person' ? people : projects

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-2 max-md:px-4">
        <Tabs
          mode="state"
          variant="segment"
          label={t('spend.usage.label')}
          value={view}
          onValueChange={(value) => setView(value as View)}
          items={VIEWS.map((key) => ({
            key,
            label: t(`spend.usage.groupings.${key}`),
          }))}
        />
        <PeriodPicker state={state} />
        <label className="flex items-center gap-1 text-label text-fg-muted">
          {t('spend.usage.openHours')}
          <Input
            type="number"
            inputMode="decimal"
            min="1"
            max="24"
            step="0.5"
            className="h-[26px] w-16 text-label"
            aria-label={t('spend.usage.openHours')}
            aria-describedby="usage-open-hours-tip"
            title={t('spend.usage.openHoursTip')}
            value={openHours}
            onChange={(e) => setOpenHours(e.target.value)}
          />
        </label>
        <span id="usage-open-hours-tip" className="sr-only">
          {t('spend.usage.openHoursTip')}
        </span>
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="sm" disabled={all.length === 0} />}
          >
            {t('spend.usage.exportMenu')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[220px]">
            <DropdownMenuItem
              icon="download"
              onClick={() =>
                save(
                  t('spend.usage.exportNames.project'),
                  rechargeCsv(all, 'project', labels),
                )
              }
            >
              {t('spend.usage.exportRecharge')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon="download"
              onClick={() =>
                save(
                  t('spend.usage.exportNames.person'),
                  rechargeCsv(all, 'person', labels),
                )
              }
            >
              {t('spend.usage.exportRechargePerson')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon="download"
              onClick={() =>
                save(
                  t('spend.usage.exportNames.bookings'),
                  bookingsCsv(all, labels),
                )
              }
            >
              {t('spend.usage.exportBookings')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {canEmail ? (
          <Button size="sm" onClick={() => setEmailing(true)}>
            {t('spend.actions.email')}
          </Button>
        ) : null}
      </div>
      <ReportFigures
        figures={[
          {
            label: t('spend.usage.summary.booked'),
            value: t('spend.usage.hoursUnit', {
              hours: formatHours(totalHours),
            }),
          },
          {
            label: t('spend.usage.summary.utilisation'),
            value: formatShare(overall),
            tip: t('spend.usage.openHoursTip'),
          },
          {
            label: t('spend.usage.summary.bookings'),
            value: String(all.length),
          },
          {
            label: t('spend.usage.summary.charge'),
            value: rated
              ? formatTotals(charges) ||
                formatMoney(0, rates.data?.at(0)?.currency ?? 'GBP')
              : t('spend.usage.summary.noRates'),
          },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {lines.isError ? (
          <div role="alert" className="px-6 py-6 text-body text-danger-text">
            {t('spend.loadError')}
          </div>
        ) : empty ? (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="calendar"
              title={t('spend.usage.empty')}
              description={t('spend.usage.emptyBody')}
            />
          </div>
        ) : view === 'instrument' ? (
          <RegistryGrid
            label={t('spend.usage.tableLabel')}
            rows={utilisation}
            columns={instrumentColumns}
            getRowId={(row) => row.key}
            selectable={false}
            isLoading={lines.isPending || instruments.isPending}
          />
        ) : view === 'bookings' ? (
          <RegistryGrid
            label={t('spend.usage.tableLabel')}
            rows={all}
            columns={bookingColumns}
            getRowId={(line) => line.bookingId}
            selectable={false}
            isLoading={lines.isPending}
          />
        ) : (
          <RegistryGrid
            label={t('spend.usage.tableLabel')}
            rows={groups}
            columns={groupColumns}
            getRowId={(group) => group.key}
            selectable={false}
            isLoading={lines.isPending}
          />
        )}
      </div>
      <ListFooter loading={lines.isPending}>
        {t('spend.usage.footer', { count: all.length })}
      </ListFooter>
      {emailing ? (
        <ScheduleReportDialog
          open
          onOpenChange={(open) => !open && setEmailing(false)}
          initial={{ kind: 'instrument_usage' }}
        />
      ) : null}
    </>
  )
}
