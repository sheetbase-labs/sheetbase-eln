/**
 * A finished count: what was found, and the one-click fix for each difference.
 */
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useWorkspaceMemberNames } from '#/components/projects/project-data'
import { Icon } from '#/components/icons'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
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
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  actionsFor,
  resolveStocktakeItem,
  sortItems,
  stocktakeKeys,
  summariseItems,
} from '#/lib/stocktake'
import type { Stocktake, StocktakeAction, StocktakeItem } from '#/lib/stocktake'

import {
  ITEM_TONE,
  itemStateLabel,
  messageOf,
  relativePath,
} from './stocktake-shared'

const client = notebookDataClient

function useRefresh(stocktakeId: string) {
  const queryClient = useQueryClient()

  return () => {
    void queryClient.invalidateQueries({
      queryKey: stocktakeKeys.items(stocktakeId),
    })
    void queryClient.invalidateQueries({ queryKey: stocktakeKeys.list })
    // A fix moves a sample or changes a lot, so lists that show them go stale.
    void queryClient.invalidateQueries({ queryKey: ['storage-positions'] })
    void queryClient.invalidateQueries({ queryKey: ['ui-port'] })
  }
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'ok' | 'warn' | 'bad'
}) {
  return (
    <div className="flex min-w-[96px] flex-1 flex-col gap-0.5 border-l border-border px-4 first:border-l-0 first:pl-0">
      <span
        className={`num text-[22px] leading-7 font-semibold ${
          value > 0 && tone === 'bad'
            ? 'text-danger-text'
            : value > 0 && tone === 'warn'
              ? 'text-warning-text'
              : ''
        }`}
      >
        {value.toLocaleString('en-GB')}
      </span>
      <span className="text-label text-fg-muted">{label}</span>
    </div>
  )
}

export function StocktakeSummaryView({
  stocktake,
  items,
  loading,
  canWrite,
}: {
  stocktake: Stocktake
  items: StocktakeItem[]
  loading: boolean
  canWrite: boolean
}) {
  const refresh = useRefresh(stocktake.id)
  const names = useWorkspaceMemberNames()
  const summary = summariseItems(items)
  const [showConfirmed, setShowConfirmed] = useState(false)
  const [confirmLost, setConfirmLost] = useState<StocktakeItem | null>(null)
  const [fixingAll, setFixingAll] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const called = stocktake.status === 'cancelled'

  const resolve = useMutation({
    mutationFn: (input: { item: StocktakeItem; action: StocktakeAction }) => {
      setBusyId(input.item.id)

      return resolveStocktakeItem(client, {
        itemId: input.item.id,
        action: input.action,
      })
    },
    onSuccess: (_wire, input) => {
      refresh()
      toast(
        t('library.stocktake.resolvedToast', {
          action: t(`library.stocktake.resolved.${input.action}`).toLowerCase(),
        }),
      )
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('library.stocktake.couldNotResolve'))),
    onSettled: () => setBusyId(null),
  })

  const differences = sortItems(
    items.filter((i) =>
      ['misplaced', 'unexpected', 'missing'].includes(i.state),
    ),
  )

  const refilable = differences.filter(
    (i) => !i.resolvedAt && actionsFor(i).includes('refile'),
  )

  const confirmed = items.filter((i) => i.state === 'confirmed')

  const fixAll = useMutation({
    mutationFn: async () => {
      let done = 0
      let failed = 0

      for (const item of refilable) {
        try {
          await resolveStocktakeItem(client, {
            itemId: item.id,
            action: 'refile',
          })
          done += 1
        } catch {
          failed += 1
        }
      }

      return { done, failed }
    },
    onSuccess: ({ done, failed }) => {
      setFixingAll(false)
      refresh()
      toast(
        failed > 0
          ? t('library.stocktake.summary.fixAllPartial', { done, failed })
          : t('library.stocktake.summary.fixAllDone', { count: done }),
      )
    },
  })

  const who = (id: string | null) => (id && names.data?.get(id)) || null

  const when = formatDate(
    stocktake.completedAt ?? stocktake.cancelledAt ?? stocktake.startedAt,
    { time: true },
  )

  const finishedBy = who(stocktake.completedBy)

  const onAction = (item: StocktakeItem, action: StocktakeAction) => {
    if (action === 'mark_lost') setConfirmLost(item)
    else resolve.mutate({ item, action })
  }

  const columns = useMemo<RegistryColumn<StocktakeItem>[]>(
    () => [
      {
        id: 'item',
        header: t('library.stocktake.columns2.item'),
        size: 210,
        cell: ({ row }) => {
          const item = row.original

          return (
            <span className="flex min-w-0">
              <span className="flex min-w-0 gap-2">
                <span className="mono shrink-0 text-fg-muted">
                  {item.identifier}
                </span>
                {item.kind === 'sample' ? (
                  <Link
                    to="/samples/$sampleId"
                    params={{ sampleId: item.recordId }}
                    className="block max-w-[130px] truncate font-medium text-link"
                  >
                    {item.title ?? item.identifier}
                  </Link>
                ) : (
                  <Link
                    to="/r/$identifier"
                    params={{ identifier: item.identifier }}
                    className="block max-w-[130px] truncate font-medium text-link"
                  >
                    {item.title ?? item.identifier}
                  </Link>
                )}
              </span>
            </span>
          )
        },
      },
      {
        id: 'state',
        header: t('library.stocktake.columns2.state'),
        size: 130,
        cell: ({ row }) => (
          <Status tone={ITEM_TONE[row.original.state]}>
            {itemStateLabel(row.original.state)}
          </Status>
        ),
      },
      {
        id: 'recorded',
        header: t('library.stocktake.columns2.recorded'),
        size: 185,
        cell: ({ row }) => (
          <span className="block max-w-[185px] truncate text-fg-muted">
            {row.original.expectedPath
              ? relativePath(stocktake.scopePath, row.original.expectedPath)
              : t('library.stocktake.notRecorded')}
          </span>
        ),
      },
      {
        id: 'found',
        header: t('library.stocktake.columns2.found'),
        size: 175,
        cell: ({ row }) => (
          <span className="block max-w-[185px] truncate text-fg-muted">
            {row.original.foundPath
              ? relativePath(stocktake.scopePath, row.original.foundPath)
              : row.original.state === 'missing'
                ? t('library.stocktake.notFoundHere')
                : '—'}
          </span>
        ),
      },
      {
        id: 'fix',
        header: t('library.stocktake.columns2.action'),
        size: 220,
        cell: ({ row }) => {
          const item = row.original

          if (item.resolution)
            return (
              <span className="inline-flex items-center gap-1.5 text-fg-muted">
                <Icon name="check" size={14} />
                {t(`library.stocktake.resolved.${item.resolution}`)}
              </span>
            )

          if (!canWrite || called) return null
          const actions = actionsFor(item)

          return (
            <span className="flex gap-1 whitespace-nowrap">
              {actions.map((action, index) => (
                <Tooltip
                  key={action}
                  content={t(`library.stocktake.actionHelp.${action}`)}
                >
                  <Button
                    size="sm"
                    variant={index === 0 ? 'secondary' : 'quiet'}
                    disabled={busyId === item.id}
                    onClick={() => onAction(item, action)}
                  >
                    {t(`library.stocktake.action.${action}`)}
                  </Button>
                </Tooltip>
              ))}
            </span>
          )
        },
      },
    ],
    [stocktake.scopePath, canWrite, called, busyId],
  )

  return (
    <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <p className="m-0 text-label text-fg-muted">
          {called
            ? t('library.stocktake.summary.calledOff', { when })
            : finishedBy
              ? t('library.stocktake.summary.finishedBy', {
                  when,
                  who: finishedBy,
                })
              : t('library.stocktake.summary.finishedByUnknown', { when })}
          {stocktake.note ? ` · ${stocktake.note}` : ''}
        </p>

        {!called ? (
          <div className="flex flex-wrap gap-y-3 rounded-lg border border-border bg-surface px-4 py-3">
            <StatBox
              label={t('library.stocktake.summary.counted')}
              value={summary.total}
            />
            <StatBox
              label={t('library.stocktake.summary.confirmed')}
              value={summary.confirmed}
            />
            <StatBox
              label={t('library.stocktake.summary.misplaced')}
              value={summary.misplaced}
              tone="warn"
            />
            <StatBox
              label={t('library.stocktake.summary.unexpected')}
              value={summary.unexpected}
              tone="warn"
            />
            <StatBox
              label={t('library.stocktake.summary.missing')}
              value={summary.missing}
              tone="bad"
            />
          </div>
        ) : null}

        {!called && !loading && differences.length === 0 ? (
          <Notice
            tone="info"
            icon="check"
            title={t('library.stocktake.summary.allGood')}
          >
            {t('library.stocktake.summary.allGoodBody')}
          </Notice>
        ) : null}

        {!called && differences.length > 0 ? (
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-body font-semibold">
                {t('library.stocktake.summary.differencesTitle')}
              </h2>
              <span className="text-label text-fg-muted">
                {summary.toFix > 0
                  ? t('library.stocktake.summary.toFix', {
                      count: summary.toFix,
                    })
                  : t('library.stocktake.summary.allDealtWith')}
              </span>
              <span className="flex-1" />
              {canWrite && refilable.length > 1 ? (
                <Button size="sm" onClick={() => setFixingAll(true)}>
                  {t('library.stocktake.summary.fixAll')}
                </Button>
              ) : null}
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <RegistryGrid
                label={t('library.stocktake.summary.differencesTitle')}
                rows={differences}
                columns={columns}
                getRowId={(item) => item.id}
                selectable={false}
                isLoading={loading}
              />
            </div>
          </section>
        ) : null}

        {confirmed.length > 0 || called ? (
          <section className="flex flex-col gap-2">
            {!called ? (
              <div>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setShowConfirmed((v) => !v)}
                >
                  {showConfirmed
                    ? t('library.stocktake.summary.hideConfirmed')
                    : t('library.stocktake.summary.showConfirmed', {
                        count: confirmed.length,
                      })}
                </Button>
              </div>
            ) : null}
            {showConfirmed || called ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <RegistryGrid
                  label={t('library.stocktake.summary.confirmedTitle')}
                  rows={called ? sortItems(items) : confirmed}
                  columns={columns}
                  getRowId={(item) => item.id}
                  selectable={false}
                  isLoading={loading}
                />
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmLost !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmLost(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('library.stocktake.action.mark_lost')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {confirmLost
                ? `${confirmLost.identifier} · ${t('library.stocktake.actionHelp.mark_lost')}`
                : ''}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                if (confirmLost)
                  resolve.mutate({ item: confirmLost, action: 'mark_lost' })
                setConfirmLost(null)
              }}
            >
              {t('library.stocktake.action.mark_lost')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>

      <ConfirmDialog open={fixingAll} onOpenChange={setFixingAll}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('library.stocktake.summary.fixAllTitle')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('library.stocktake.summary.fixAllBody', {
                count: refilable.length,
              })}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={fixAll.isPending}
              onClick={() => fixAll.mutate()}
            >
              {fixAll.isPending
                ? t('library.stocktake.working')
                : t('library.stocktake.summary.fixAllConfirm')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
