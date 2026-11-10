/**
 * The Stocktake page: counts that are open or finished, and the dialog that
 * starts a new one.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ListHeader, Textarea } from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useWorkspaceMemberNames } from '#/components/projects/project-data'
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
import { Notice } from '#/components/ui/alert'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import type { DataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchStorageTree, isArchived, nodePath } from '#/lib/storage-locations'
import type { StorageTree } from '#/lib/storage-locations'
import {
  fetchStocktakes,
  isStocktakeLevel,
  startStocktake,
  stocktakeKeys,
  summariseItems,
} from '#/lib/stocktake'
import type {
  Stocktake,
  StocktakeItem,
  StocktakeItemState,
  StocktakeLevel,
  StocktakeStatus,
  StocktakeSummary,
} from '#/lib/stocktake'

import { STATUS_TONE, messageOf, statusLabel } from './stocktake-shared'

const client: DataClient = notebookDataClient

type Filter = 'all' | StocktakeStatus

const FILTERS = [
  'all',
  'open',
  'completed',
  'cancelled',
] as const satisfies readonly Filter[]

/** True for the tab keys the filter bar offers. */
function isFilter(value: string): value is Filter {
  return FILTERS.some((filter) => filter === value)
}

interface PlaceOption {
  id: string
  level: StocktakeLevel
  label: string
}

/** Every part of the storage tree a count can cover, that holds at least one box. */
// react-doctor-disable-next-line react-doctor/only-export-components -- Exported so the storage-tree walk is unit-tested without rendering the list.
export function placeOptions(tree: StorageTree): PlaceOption[] {
  const hasBox = new Map<string, boolean>()

  const check = (id: string): boolean => {
    const cached = hasBox.get(id)

    if (cached !== undefined) return cached
    const node = tree.byId.get(id)

    const found =
      !!node &&
      (node.level === 'box' ||
        tree.childrenOf(node).some((child) => check(child.id)))

    hasBox.set(id, found)

    return found
  }

  const options: PlaceOption[] = []

  for (const node of tree.nodes) {
    if (!isStocktakeLevel(node.level)) continue

    if (isArchived(tree, node) || !check(node.id)) continue
    const level = node.level
    const path = nodePath(tree, node).join(' / ')

    options.push({
      id: node.id,
      level,
      label: t('library.stocktake.optionLabel', {
        path,
        level: t(`library.stocktake.levels.${level}`),
      }),
    })
  }

  return options.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }),
  )
}

interface ItemSummaryWire {
  stocktake_id: string
  /** The database's `chk_stocktake_items_state` check holds the item state. */
  state: StocktakeItemState
  resolved_at: string | null
}

/** One summary per count, from the lightweight item rows. */
async function fetchSummaries(): Promise<Map<string, StocktakeSummary>> {
  const rows = await client.list<ItemSummaryWire>(
    'stocktake_items',
    '?select=stocktake_id,state,resolved_at&limit=20000',
  )

  const grouped = new Map<
    string,
    Pick<StocktakeItem, 'state' | 'resolvedAt'>[]
  >()

  for (const row of rows) {
    const list = grouped.get(row.stocktake_id) ?? []
    list.push({ state: row.state, resolvedAt: row.resolved_at })
    grouped.set(row.stocktake_id, list)
  }

  return new Map(
    [...grouped].map(([id, list]) => [id, summariseItems(list)] as const),
  )
}

export function StartCountDialog({
  open,
  onOpenChange,
  canStart,
  onStarted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  canStart: boolean
  onStarted: (id: string) => void
}) {
  const queryClient = useQueryClient()

  const tree = useQuery({
    queryKey: stocktakeKeys.tree,
    queryFn: () => fetchStorageTree(client, { occupancy: false }),
    enabled: open,
  })

  const options = useMemo(
    () => (tree.data ? placeOptions(tree.data) : []),
    [tree.data],
  )

  const [choice, setChoice] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const start = useMutation({
    mutationFn: () => {
      const option = options.find((o) => o.id === choice)!

      return startStocktake(client, {
        level: option.level,
        scopeId: option.id,
        note: note.trim() || null,
      })
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: stocktakeKeys.all })
      setChoice('')
      setNote('')
      onOpenChange(false)
      onStarted(created.id)
    },
    onError: (e) =>
      toast.error(messageOf(e, t('library.stocktake.couldNotStart'))),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title={t('library.stocktake.startTitle')} />
        <DialogBody>
          <form
            id="start-count-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()

              if (!choice) {
                setError(t('library.stocktake.chooseAPlace'))

                return
              }

              setError(null)
              start.mutate()
            }}
          >
            <p className="text-label text-fg-muted">
              {t('library.stocktake.startHelp')}
            </p>
            {tree.isSuccess && options.length === 0 ? (
              <Notice tone="info" title={t('library.stocktake.noPlacesTitle')}>
                {t('library.stocktake.noPlacesBody')}
              </Notice>
            ) : (
              <Field
                label={t('library.stocktake.place')}
                required
                error={error}
              >
                <Select
                  value={choice}
                  invalid={error !== null}
                  disabled={!canStart || tree.isPending || start.isPending}
                  onChange={(e) => {
                    setChoice(e.target.value)
                    setError(null)
                  }}
                >
                  <option value="">
                    {t('library.stocktake.placePlaceholder')}
                  </option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t('library.stocktake.note')}>
              <Textarea
                value={note}
                placeholder={t('library.stocktake.notePlaceholder')}
                onChange={(e) => setNote(e.target.value)}
                disabled={start.isPending}
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="start-count-form"
            disabled={!canStart || start.isPending || options.length === 0}
          >
            {start.isPending
              ? t('library.stocktake.starting')
              : t('library.stocktake.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** How one count's outcome reads in the list. */
interface StocktakeResult {
  tone: 'ok' | 'warn' | 'none'
  label: string
}

function resultOf(
  count: Stocktake,
  summary: StocktakeSummary | undefined,
): StocktakeResult {
  if (count.status !== 'completed' || !summary)
    return { tone: 'none', label: t('library.stocktake.resultNone') }
  const differences = summary.misplaced + summary.unexpected + summary.missing

  if (differences === 0)
    return { tone: 'ok', label: t('library.stocktake.resultClean') }

  if (summary.toFix === 0)
    return { tone: 'ok', label: t('library.stocktake.resultFixed') }

  return {
    tone: 'warn',
    label: t('library.stocktake.resultDifferences', { count: summary.toFix }),
  }
}

export function StocktakeList({ canWrite }: { canWrite: boolean }) {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [starting, setStarting] = useState(false)

  const counts = useQuery({
    queryKey: stocktakeKeys.list,
    queryFn: () => fetchStocktakes(client),
    staleTime: 10_000,
  })

  const summaries = useQuery({
    queryKey: [...stocktakeKeys.list, 'summaries'],
    queryFn: fetchSummaries,
    staleTime: 10_000,
  })

  const names = useWorkspaceMemberNames()

  const all = counts.data ?? []
  const visible = all.filter((c) => filter === 'all' || c.status === filter)

  const columns = useMemo<RegistryColumn<Stocktake>[]>(
    () => [
      {
        id: 'count',
        header: t('library.stocktake.columns.count'),
        size: 110,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">{row.original.reference}</span>
        ),
      },
      {
        id: 'place',
        header: t('library.stocktake.columns.place'),
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              {row.original.scopeName}
            </span>
            <span className="truncate text-label text-fg-muted">
              {row.original.scopePath}
            </span>
          </span>
        ),
      },
      {
        id: 'status',
        header: t('library.stocktake.columns.status'),
        size: 130,
        cell: ({ row }) => (
          <Status tone={STATUS_TONE[row.original.status]}>
            {statusLabel(row.original.status)}
          </Status>
        ),
      },
      {
        id: 'started',
        header: t('library.stocktake.columns.started'),
        size: 200,
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span>{formatDate(row.original.startedAt)}</span>
            <span className="truncate text-label text-fg-muted">
              {(row.original.startedBy &&
                names.data?.get(row.original.startedBy)) ||
                ''}
            </span>
          </span>
        ),
      },
      {
        id: 'result',
        header: t('library.stocktake.columns.result'),
        size: 220,
        cell: ({ row }) => {
          const result = resultOf(
            row.original,
            summaries.data?.get(row.original.id),
          )

          return result.tone === 'none' ? (
            <span className="text-fg-muted">{result.label}</span>
          ) : (
            <Status tone={result.tone}>{result.label}</Status>
          )
        },
      },
    ],
    [names.data, summaries.data],
  )

  const open = (id: string) =>
    void navigate({
      to: '/stocktake/$stocktakeId',
      params: { stocktakeId: id },
    })

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('library.stocktake.title')}
        subtitle={t('library.stocktake.subtitle')}
        total={counts.data ? all.length : undefined}
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setStarting(true)}>
              {t('library.stocktake.startCount')}
            </Button>
          ) : null
        }
      />
      <div className="flex items-center gap-2 border-b border-border px-6 py-2 max-md:px-4">
        <Tabs
          mode="state"
          variant="segment"
          label={t('library.stocktake.filterLabel')}
          value={filter}
          onValueChange={(value) => {
            if (isFilter(value)) setFilter(value)
          }}
          items={FILTERS.map((key) => ({
            key,
            label: t(`library.stocktake.filters.${key}`),
            count: counts.isPending
              ? undefined
              : all.filter((c) => key === 'all' || c.status === key).length,
          }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {counts.isError ? (
          <div className="p-6">
            <Notice tone="bad" title={t('library.stocktake.loadError')}>
              {messageOf(counts.error, '')}
            </Notice>
          </div>
        ) : counts.isPending || visible.length > 0 ? (
          <RegistryGrid
            label={t('library.stocktake.tableLabel')}
            rows={visible}
            columns={columns}
            getRowId={(count) => count.id}
            selectable
            onRowClick={(count) => open(count.id)}
            isLoading={counts.isPending}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="scan"
              title={t('library.stocktake.emptyTitle')}
              description={t('library.stocktake.emptyBody')}
              action={
                canWrite ? (
                  <Button variant="primary" onClick={() => setStarting(true)}>
                    {t('library.stocktake.startCount')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>
      <StartCountDialog
        open={starting}
        onOpenChange={setStarting}
        canStart={canWrite}
        onStarted={open}
      />
    </div>
  )
}
