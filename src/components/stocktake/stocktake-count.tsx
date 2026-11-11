/**
 * One stocktake: the walk while it is open, the summary once it is finished.
 */
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { CameraScanner } from '#/components/scan/camera-scanner'
import { ListHeader } from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useScanCodeResolver } from '#/components/scan/plugin-scan'
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
import { EmptyState } from '#/components/ui/empty-state'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchStorageTree } from '#/lib/storage-locations'
import {
  boxesInScope,
  cancelStocktake,
  completeStocktake,
  fetchStocktake,
  fetchStocktakeItems,
  matchBoxCode,
  recordStocktakeScan,
  sortItems,
  stocktakeKeys,
  summariseItems,
  toStocktakeItem,
} from '#/lib/stocktake'
import type { CountBox, Stocktake, StocktakeItem } from '#/lib/stocktake'

import { StocktakeSummaryView } from './stocktake-summary'
import {
  ITEM_TONE,
  STATUS_TONE,
  itemStateLabel,
  messageOf,
  relativePath,
  statusLabel,
} from './stocktake-shared'

const client = notebookDataClient

export function useStocktakeItems(id: string) {
  return useQuery({
    queryKey: stocktakeKeys.items(id),
    queryFn: () => fetchStocktakeItems(client, id),
    staleTime: 0,
  })
}

export function StocktakeCount({
  stocktakeId,
  canWrite,
}: {
  stocktakeId: string
  canWrite: boolean
}) {
  const header = useQuery({
    queryKey: stocktakeKeys.detail(stocktakeId),
    queryFn: () => fetchStocktake(client, stocktakeId),
  })

  const items = useStocktakeItems(stocktakeId)

  if (header.isPending) return <div className="flex-1" aria-busy="true" />

  if (!header.data)
    return (
      <div className="flex flex-1 justify-center px-6">
        <EmptyState
          className="items-center py-14 text-center"
          icon="scan"
          title={t('library.stocktake.notFoundTitle')}
          description={t('library.stocktake.notFoundBody')}
          action={
            <Button nativeButton={false} render={<Link to="/stocktake" />}>
              {t('library.stocktake.back')}
            </Button>
          }
        />
      </div>
    )
  const stocktake = header.data

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={`${stocktake.reference} · ${stocktake.scopeName}`}
        subtitle={stocktake.scopePath}
        actions={
          <>
            <Status tone={STATUS_TONE[stocktake.status]}>
              {statusLabel(stocktake.status)}
            </Status>
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link to="/stocktake" />}
            >
              {t('library.stocktake.back')}
            </Button>
          </>
        }
      />
      {stocktake.status === 'open' ? (
        <OpenCount
          stocktake={stocktake}
          items={items.data ?? []}
          loading={items.isPending}
          canWrite={canWrite}
        />
      ) : (
        <StocktakeSummaryView
          stocktake={stocktake}
          items={items.data ?? []}
          loading={items.isPending}
          canWrite={canWrite}
        />
      )}
    </div>
  )
}

const TABS = ['toFind', 'counted', 'all'] as const

type Tab = (typeof TABS)[number]

function isTab(value: string): value is Tab {
  return TABS.some((tab) => tab === value)
}

function OpenCount({
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
  const queryClient = useQueryClient()

  const tree = useQuery({
    queryKey: stocktakeKeys.tree,
    queryFn: () => fetchStorageTree(client, { occupancy: false }),
    staleTime: 30_000,
  })

  const boxes = useMemo<CountBox[]>(
    () => (tree.data ? boxesInScope(tree.data, stocktake) : []),
    [tree.data, stocktake],
  )

  const [pickedBox, setPickedBox] = useState<string | null>(null)

  // A count of one box is always standing at that box; a count of a rack or
  // freezer with one box in it has nowhere else to stand.
  const standingAt =
    pickedBox ??
    (stocktake.scopeLevel === 'box' ? stocktake.scopeId : null) ??
    (boxes.length === 1 ? boxes[0].id : null)

  const box = boxes.find((b) => b.id === standingAt) ?? null

  const [code, setCode] = useState('')
  const [tab, setTab] = useState<Tab>('toFind')

  const [last, setLast] = useState<{
    tone: 'ok' | 'warn' | 'bad' | 'info'
    text: string
  } | null>(null)

  const [finishing, setFinishing] = useState(false)
  const [callingOff, setCallingOff] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: stocktakeKeys.items(stocktake.id),
    })
    void queryClient.invalidateQueries({ queryKey: stocktakeKeys.all })
  }

  const resolveScanCode = useScanCodeResolver()

  const scan = useMutation({
    mutationFn: async (raw: string) => {
      const trimmed = raw.trim()

      if (!trimmed) return null
      const boxHit = matchBoxCode(boxes, trimmed)

      if (boxHit) {
        setPickedBox(boxHit.id)
        setLast({
          tone: 'info',
          text: t('library.stocktake.count.nowAt', { name: boxHit.name }),
        })

        return null
      }

      const resolved = await resolveScanCode(trimmed)
      const hit = resolved.hit

      if (!resolved.found || !hit) {
        setLast({
          tone: 'warn',
          text: t('library.stocktake.count.notFound', { code: trimmed }),
        })

        return null
      }

      const isLot = hit.kind === 'record' && hit.recordKind === 'material'

      if (hit.kind !== 'sample' && !isLot) {
        setLast({
          tone: 'warn',
          text: t('library.stocktake.count.cantCountThis', {
            code: hit.identifier,
          }),
        })

        return null
      }

      if (hit.kind === 'sample' && !standingAt) {
        setLast({
          tone: 'warn',
          text: t('library.stocktake.count.scanBoxFirst'),
        })

        return null
      }

      const wire = await recordStocktakeScan(client, {
        stocktakeId: stocktake.id,
        recordId: hit.id,
        boxId: standingAt,
      })

      return toStocktakeItem(wire)
    },
    onSuccess: (item) => {
      setCode('')

      if (!item) return
      setLast(describeScan(item, stocktake.scopePath))
      refresh()
    },
    onError: (e) => {
      setLast({
        tone: 'bad',
        text: messageOf(e, t('library.stocktake.count.couldNotCount')),
      })
    },
  })

  const finish = useMutation({
    mutationFn: () => completeStocktake(client, stocktake.id),
    onSuccess: () => {
      setFinishing(false)
      refresh()
    },
    onError: (e) =>
      toast.error(messageOf(e, t('library.stocktake.count.couldNotFinish'))),
  })

  const callOff = useMutation({
    mutationFn: () => cancelStocktake(client, stocktake.id),
    onSuccess: () => {
      setCallingOff(false)
      refresh()
    },
    onError: (e) =>
      toast.error(messageOf(e, t('library.stocktake.count.couldNotCallOff'))),
  })

  const summary = summariseItems(items)
  const expectedTotal = items.filter((i) => i.expected).length

  const expectedSeen = items.filter(
    (i) => i.expected && i.state !== 'expected',
  ).length

  const extra = items.filter((i) => !i.expected).length

  const shown = sortItems(
    items.filter((item) =>
      tab === 'all'
        ? true
        : tab === 'toFind'
          ? item.state === 'expected'
          : item.state !== 'expected',
    ),
  )

  const columns = useMemo<RegistryColumn<StocktakeItem>[]>(
    () => [
      {
        id: 'item',
        header: t('library.stocktake.columns2.item'),
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="flex gap-2">
              <span className="mono text-fg-muted">
                {row.original.identifier}
              </span>
              <span className="truncate font-medium">
                {row.original.title ?? ''}
              </span>
            </span>
            <span className="text-label text-fg-muted">
              {t(`library.stocktake.kind.${row.original.kind}`)}
            </span>
          </span>
        ),
      },
      {
        id: 'state',
        header: t('library.stocktake.columns2.state'),
        size: 170,
        cell: ({ row }) => (
          <Status tone={ITEM_TONE[row.original.state]}>
            {itemStateLabel(row.original.state)}
          </Status>
        ),
      },
      {
        id: 'recorded',
        header: t('library.stocktake.columns2.recorded'),
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {row.original.expectedPath
              ? relativePath(stocktake.scopePath, row.original.expectedPath)
              : t('library.stocktake.notRecorded')}
          </span>
        ),
      },
      {
        id: 'found',
        header: t('library.stocktake.columns2.found'),
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {row.original.foundPath
              ? relativePath(stocktake.scopePath, row.original.foundPath)
              : '—'}
          </span>
        ),
      },
    ],
    [stocktake.scopePath],
  )

  const left = items.filter((i) => i.state === 'expected').length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 px-4 py-4 md:px-6">
        <StandingAtHeader
          stocktake={stocktake}
          boxes={boxes}
          box={box}
          standingAt={standingAt}
          onPickBox={setPickedBox}
          expectedTotal={expectedTotal}
          expectedSeen={expectedSeen}
          extra={extra}
        />
        {canWrite ? (
          <ScanPanel
            code={code}
            onCodeChange={setCode}
            busy={scan.isPending}
            onScan={(raw) => scan.mutate(raw)}
            last={last}
            box={box}
            onFinish={() => setFinishing(true)}
            onCallOff={() => setCallingOff(true)}
          />
        ) : null}
      </div>

      <CountTable
        tab={tab}
        onTabChange={setTab}
        loading={loading}
        items={items}
        shown={shown}
        columns={columns}
        left={left}
        counted={summary.total - left}
        total={summary.total}
      />

      <ConfirmCount
        open={finishing}
        onOpenChange={setFinishing}
        title={t('library.stocktake.count.finishTitle')}
        body={
          left > 0
            ? t('library.stocktake.count.finishBody', { count: left })
            : t('library.stocktake.count.finishAllFound')
        }
        confirmLabel={t('library.stocktake.count.finishConfirm')}
        pendingLabel={t('library.stocktake.count.finishing')}
        pending={finish.isPending}
        onConfirm={() => finish.mutate()}
      />

      <ConfirmCount
        open={callingOff}
        onOpenChange={setCallingOff}
        title={t('library.stocktake.count.callOffTitle')}
        body={t('library.stocktake.count.callOffBody')}
        confirmLabel={t('library.stocktake.count.callOffConfirm')}
        pendingLabel={t('library.stocktake.count.callOffConfirm')}
        pending={callOff.isPending}
        onConfirm={() => callOff.mutate()}
      />
    </div>
  )
}

/** Where the count stands, how far it has got, and the box being counted. */
function StandingAtHeader({
  stocktake,
  boxes,
  box,
  standingAt,
  onPickBox,
  expectedTotal,
  expectedSeen,
  extra,
}: {
  stocktake: Stocktake
  boxes: CountBox[]
  box: CountBox | null
  standingAt: string | null
  onPickBox: (id: string | null) => void
  expectedTotal: number
  expectedSeen: number
  extra: number
}) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-label font-medium text-fg-muted">
            {t('library.stocktake.count.standingAt')}
          </span>
          {stocktake.scopeLevel === 'box' ? (
            <span className="text-body font-medium">{box?.name}</span>
          ) : (
            <Select
              aria-label={t('library.stocktake.count.standingAtBox')}
              value={standingAt ?? ''}
              onChange={(e) => onPickBox(e.target.value || null)}
            >
              <option value="">{t('library.stocktake.count.chooseBox')}</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {relativePath(stocktake.scopePath, b.path)}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="flex flex-col gap-1 text-right max-md:text-left">
          <span className="num text-body font-medium">
            {expectedTotal > 0
              ? t('library.stocktake.count.progress', {
                  counted: expectedSeen,
                  total: expectedTotal,
                })
              : t('library.stocktake.count.progressNone')}
          </span>
          {extra > 0 ? (
            <span className="text-label text-fg-muted">
              {t('library.stocktake.count.progressExtra', { count: extra })}
            </span>
          ) : null}
        </div>
      </div>
      {expectedTotal > 0 ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={expectedTotal}
          aria-valuenow={expectedSeen}
          aria-label={t('library.stocktake.count.progress', {
            counted: expectedSeen,
            total: expectedTotal,
          })}
          className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
        >
          <div
            className="h-full rounded-full bg-success transition-[width]"
            style={{ width: `${(expectedSeen / expectedTotal) * 100}%` }}
          />
        </div>
      ) : null}
    </>
  )
}

/** The scanner, what the last scan said, and the two ways to close the count. */
function ScanPanel({
  code,
  onCodeChange,
  busy,
  onScan,
  last,
  box,
  onFinish,
  onCallOff,
}: {
  code: string
  onCodeChange: (code: string) => void
  busy: boolean
  onScan: (raw: string) => void
  last: { tone: 'ok' | 'warn' | 'bad' | 'info'; text: string } | null
  box: CountBox | null
  onFinish: () => void
  onCallOff: () => void
}) {
  return (
    <>
      <CameraScanner
        value={code}
        onValueChange={onCodeChange}
        busy={busy}
        onScan={onScan}
      >
        {last ? (
          <Notice
            tone={last.tone === 'ok' ? 'info' : last.tone}
            icon={last.tone === 'ok' ? 'check' : undefined}
            title={t('library.stocktake.count.scanSource')}
          >
            {last.text}
          </Notice>
        ) : (
          <p className="m-0 text-label text-fg-muted">
            {box
              ? t('library.stocktake.count.scanHelp')
              : t('library.stocktake.count.scanBoxFirst')}
          </p>
        )}
      </CameraScanner>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onFinish}>
          {t('library.stocktake.count.finish')}
        </Button>
        <Button variant="quiet" onClick={onCallOff}>
          {t('library.stocktake.count.callOff')}
        </Button>
      </div>
    </>
  )
}

/** The tab strip and the rows of the tab it shows. */
function CountTable({
  tab,
  onTabChange,
  loading,
  items,
  shown,
  columns,
  left,
  counted,
  total,
}: {
  tab: Tab
  onTabChange: (tab: Tab) => void
  loading: boolean
  items: StocktakeItem[]
  shown: StocktakeItem[]
  columns: RegistryColumn<StocktakeItem>[]
  left: number
  counted: number
  total: number
}) {
  const emptyTitle =
    tab === 'toFind' && items.length > 0
      ? t('library.stocktake.count.emptyToFindTitle')
      : tab === 'counted'
        ? t('library.stocktake.count.emptyCountedTitle')
        : t('library.stocktake.count.emptyAllTitle')

  const emptyBody =
    tab === 'toFind' && items.length > 0
      ? t('library.stocktake.count.emptyToFindBody')
      : tab === 'counted'
        ? t('library.stocktake.count.emptyCountedBody')
        : t('library.stocktake.count.emptyAllBody')

  return (
    <>
      <div className="flex items-center gap-2 border-y border-border px-6 py-2 max-md:px-4">
        <Tabs
          mode="state"
          variant="segment"
          label={t('library.stocktake.count.tabLabel')}
          value={tab}
          onValueChange={(value) => {
            if (isTab(value)) onTabChange(value)
          }}
          items={TABS.map((key) => ({
            key,
            label: t(`library.stocktake.count.tabs.${key}`),
            count: loading
              ? undefined
              : key === 'toFind'
                ? left
                : key === 'counted'
                  ? counted
                  : total,
          }))}
        />
      </div>
      <div>
        {loading || shown.length > 0 ? (
          <RegistryGrid
            label={t('library.stocktake.count.tableLabel')}
            rows={shown}
            columns={columns}
            getRowId={(item) => item.id}
            selectable={false}
            isLoading={loading}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon={tab === 'toFind' && items.length > 0 ? 'check' : 'scan'}
              title={emptyTitle}
              description={emptyBody}
            />
          </div>
        )}
      </div>
    </>
  )
}

/** One confirmation a count asks for: finishing it, or calling it off. */
function ConfirmCount({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  pendingLabel,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: string
  confirmLabel: string
  pendingLabel: string
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange}>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>{title}</ConfirmDialogTitle>
          <ConfirmDialogDescription>{body}</ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>
            {t('library.stocktake.count.keepCounting')}
          </ConfirmDialogCancel>
          <ConfirmDialogAction disabled={pending} onClick={onConfirm}>
            {pending ? pendingLabel : confirmLabel}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

/** The sentence a scan earns, in the words of what it found. */
interface ScanSentence {
  tone: 'ok' | 'warn'
  text: string
}

function describeScan(item: StocktakeItem, scopePath: string): ScanSentence {
  const identifier = item.identifier

  switch (item.state) {
    case 'confirmed':
      return {
        tone: 'ok',
        text:
          item.kind === 'material'
            ? t('library.stocktake.scan.lotFound', { identifier })
            : t('library.stocktake.scan.confirmedIn', {
                identifier,
                box: item.foundPath?.split(' / ').at(-1) ?? '',
              }),
      }
    case 'misplaced':
      return {
        tone: 'warn',
        text: t('library.stocktake.scan.misplaced', {
          identifier,
          expected: relativePath(scopePath, item.expectedPath ?? ''),
          found: item.foundPath?.split(' / ').at(-1) ?? '',
        }),
      }
    default:
      return {
        tone: 'warn',
        text: item.expectedPath
          ? t('library.stocktake.scan.unexpected', {
              identifier,
              expected: relativePath(scopePath, item.expectedPath),
            })
          : t('library.stocktake.scan.unexpectedNowhere', { identifier }),
      }
  }
}
