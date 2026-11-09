/**
 * Spend on reagent orders: what was spent in a period, by project, by
 * supplier or by month, with the orders behind it. Prices are readable only by
 * the people who place orders, so this tab is theirs.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'

import {
  PeriodPicker,
  ReportFigures,
  useReportRange,
} from '#/components/facility/report-controls'
import { ScheduleReportDialog } from '#/components/facility/scheduled-reports'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { ListFooter } from '#/components/inventory/list'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { toast } from '#/components/ui/sonner'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import { downloadTextFile } from '#/lib/download'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { formatMoney, formatMonthKey, formatTotals } from '#/lib/report-period'
import {
  fetchSpendLines,
  groupSpend,
  spendCsv,
  spendKeys,
  totalSpend,
} from '#/lib/spend-report'
import type { SpendGrouping, SpendGroup, SpendLine } from '#/lib/spend-report'
import { orderStatusLabel } from '#/components/materials/reagent-orders'
import type { ReagentOrderStatus } from '#/lib/reagent-orders'

const client = notebookDataClient

type View = SpendGrouping | 'orders'

const VIEWS: readonly View[] = ['project', 'supplier', 'month', 'orders']

export function SpendReportPanel() {
  const { auth } = useRouteContext({ from: '__root__' })
  const workspaceId = auth?.workspace?.id ?? ''
  const state = useReportRange('last_month')
  const [view, setView] = useState<View>('project')
  const [emailing, setEmailing] = useState(false)

  const lines = useQuery({
    queryKey: spendKeys.lines(
      workspaceId,
      state.range?.from.toISOString() ?? '',
      state.range?.to.toISOString() ?? '',
    ),
    queryFn: () => fetchSpendLines(client, workspaceId, state.range!),
    enabled: workspaceId !== '' && state.range !== null,
    staleTime: 15_000,
  })

  const all = useMemo(() => lines.data ?? [], [lines.data])
  const total = useMemo(() => totalSpend(all), [all])

  const groups = useMemo(
    () => (view === 'orders' ? [] : groupSpend(all, view, state.zone)),
    [all, view, state.zone],
  )

  const exportCsv = () => {
    try {
      downloadTextFile(
        `${t('spend.spendReport.exportName')}-${state.range?.from.toISOString().slice(0, 10) ?? ''}.csv`,
        spendCsv(all, {
          project: t('spend.noProject'),
          supplier: t('spend.noSupplier'),
        }),
        'text/csv',
      )
    } catch {
      toast.error(t('spend.actions.couldNotExport'))
    }
  }

  const groupColumns = useMemo<RegistryColumn<SpendGroup>[]>(
    () => [
      {
        id: 'label',
        header: t(
          `spend.spendReport.columns.${view === 'orders' ? 'project' : view}`,
        ),
        accessorFn: (g) =>
          view === 'month'
            ? formatMonthKey(g.key)
            : g.label ||
              (view === 'project'
                ? t('spend.noProject')
                : t('spend.noSupplier')),
        enableHiding: false,
      },
      {
        id: 'orders',
        header: t('spend.spendReport.columns.orders'),
        accessorFn: (g) => g.orders,
        size: 100,
        cell: ({ row }) => <span className="num">{row.original.orders}</span>,
      },
      {
        id: 'spent',
        header: t('spend.spendReport.columns.spent'),
        accessorFn: (g) => formatTotals(g.totals),
        size: 200,
        cell: ({ row }) => (
          <span className="num">
            {formatTotals(row.original.totals) || '—'}
          </span>
        ),
      },
      {
        id: 'unpriced',
        header: t('spend.spendReport.columns.unpriced'),
        accessorFn: (g) => g.unpriced,
        size: 140,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {row.original.unpriced || '—'}
          </span>
        ),
      },
    ],
    [view],
  )

  const orderColumns = useMemo<RegistryColumn<SpendLine>[]>(
    () => [
      {
        id: 'order',
        header: t('spend.spendReport.columns.order'),
        accessorFn: (l) => l.reference,
        size: 100,
        cell: ({ row }) => (
          <span className="mono">{row.original.reference}</span>
        ),
      },
      {
        id: 'ordered',
        header: t('spend.spendReport.columns.ordered'),
        accessorFn: (l) => l.orderedAt,
        size: 120,
        cell: ({ row }) => formatDate(row.original.orderedAt),
      },
      {
        id: 'material',
        header: t('spend.spendReport.columns.material'),
        accessorFn: (l) => l.materialTitle,
      },
      {
        id: 'supplier',
        header: t('spend.spendReport.columns.supplier'),
        accessorFn: (l) => l.supplier ?? t('spend.noSupplier'),
      },
      {
        id: 'project',
        header: t('spend.spendReport.columns.project'),
        accessorFn: (l) => l.projectTitle ?? t('spend.noProject'),
      },
      {
        id: 'status',
        header: t('spend.spendReport.columns.status'),
        accessorFn: (l) => orderStatusLabel(l.status as ReagentOrderStatus),
        size: 110,
      },
      {
        id: 'price',
        header: t('spend.spendReport.columns.price'),
        accessorFn: (l) =>
          l.totalPrice === null || !l.currency
            ? ''
            : formatMoney(l.totalPrice, l.currency),
        size: 130,
        cell: ({ row }) => (
          <span className="num">
            {row.original.totalPrice === null || !row.original.currency
              ? '—'
              : formatMoney(row.original.totalPrice, row.original.currency)}
          </span>
        ),
      },
    ],
    [],
  )

  const empty = !lines.isPending && all.length === 0

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-2 max-md:px-4">
        <Tabs
          mode="state"
          variant="segment"
          label={t('spend.spendReport.label')}
          value={view}
          onValueChange={(value) => setView(value as View)}
          items={VIEWS.map((key) => ({
            key,
            label: t(`spend.spendReport.groupings.${key}`),
          }))}
        />
        <PeriodPicker state={state} />
        <span className="flex-1" />
        <Button
          size="sm"
          disabled={empty || lines.isPending}
          onClick={exportCsv}
        >
          {t('spend.actions.exportCsv')}
        </Button>
        <Button size="sm" onClick={() => setEmailing(true)}>
          {t('spend.actions.email')}
        </Button>
      </div>
      <ReportFigures
        figures={[
          {
            label: t('spend.summary.spent'),
            value:
              formatTotals(total.totals) || t('spend.summary.nothingSpent'),
          },
          { label: t('spend.summary.orders'), value: String(total.orders) },
          {
            label: t('spend.summary.unpriced'),
            value: String(total.unpriced),
            tip: t('spend.summary.unpricedTip'),
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
              icon="box"
              title={t('spend.spendReport.empty')}
              description={t('spend.spendReport.emptyBody')}
            />
          </div>
        ) : view === 'orders' ? (
          <RegistryGrid
            label={t('spend.spendReport.tableLabel')}
            rows={all}
            columns={orderColumns}
            getRowId={(line) => line.orderId}
            selectable={false}
            isLoading={lines.isPending}
          />
        ) : (
          <RegistryGrid
            label={t('spend.spendReport.tableLabel')}
            rows={groups}
            columns={groupColumns}
            getRowId={(group) => group.key}
            selectable={false}
            isLoading={lines.isPending}
          />
        )}
      </div>
      <ListFooter loading={lines.isPending}>
        {t('spend.spendReport.footer', { count: total.orders })}
      </ListFooter>
      {emailing ? (
        <ScheduleReportDialog
          open
          onOpenChange={(open) => !open && setEmailing(false)}
          initial={{ kind: 'spend' }}
        />
      ) : null}
    </>
  )
}
