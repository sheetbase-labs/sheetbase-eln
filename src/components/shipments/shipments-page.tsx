/**
 * The Shipments page: boxes leaving the lab or arriving at it, each with a
 * manifest, followed from packing to received.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import {
  ListHeader,
  ListToolbar,
  ReadOnlyNote,
} from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import { now as appNow } from '#/lib/clock'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchManifestCounts,
  fetchShipments,
  isOpenShipment,
  messageOf,
  shipmentKeys,
  shipmentReference,
} from '#/lib/shipments'
import type { ShipmentRow } from '#/lib/shipments'

import { NewShipmentDialog, ShipmentDialog } from './shipment-dialogs'
import {
  isLate,
  shipmentStatusLabel,
  shipmentText,
  shipmentTone,
} from './shipments-shared'

const tabSchema = z.enum(['open', 'received', 'all'])
const directionSchema = z.enum(['all', 'outbound', 'inbound'])

type Tab = z.infer<typeof tabSchema>

/** Whether one shipment's searchable text carries the needle. */
function matchesSearch(text: string, needle: string): boolean {
  return text.includes(needle)
}

type Direction = z.infer<typeof directionSchema>

/** Rows of one tab: still open, received, or all of the chosen direction. */
function inTabOf(rows: ShipmentRow[], tab: Tab): ShipmentRow[] {
  if (tab === 'open') return rows.filter((s) => isOpenShipment(s.status))

  if (tab === 'received') return rows.filter((s) => s.status === 'received')

  return rows
}

/** What the empty list says: the searched tab, or the tab itself. */
function emptyTitleFor(tab: Tab, filtered: boolean): string {
  if (filtered) return t('shipments.empty.filtered')

  if (tab === 'open') return t('shipments.empty.open')

  if (tab === 'received') return t('shipments.empty.received')

  return t('shipments.empty.all')
}

/** The list's columns: what each shipment is, where it is and its state. */
function shipmentColumns(
  itemCounts: Map<string, number> | undefined,
  today: string,
): RegistryColumn<ShipmentRow>[] {
  return [
    {
      id: 'number',
      header: t('shipments.columns.number'),
      size: 110,
      cell: ({ row }) => (
        <span className="mono text-fg-muted">
          {shipmentReference(row.original.number)}
        </span>
      ),
    },
    {
      id: 'direction',
      header: t('shipments.columns.direction'),
      size: 110,
      cell: ({ row }) => (
        <span>{t(`shipments.directions.${row.original.direction}`)}</span>
      ),
    },
    {
      id: 'counterparty',
      header: t('shipments.columns.counterparty'),
      size: 260,
      cell: ({ row }) => (
        <span className="truncate font-medium text-fg">
          {row.original.counterparty}
        </span>
      ),
    },
    {
      id: 'items',
      header: t('shipments.columns.items'),
      size: 100,
      cell: ({ row }) => (
        <span className="num text-fg-muted">
          {itemCounts?.get(row.original.id) ?? ''}
        </span>
      ),
    },
    {
      id: 'carrier',
      header: t('shipments.columns.carrier'),
      cell: ({ row }) => (
        <span className="truncate text-fg-muted">
          {[row.original.carrier, row.original.tracking_reference]
            .filter(Boolean)
            .join(' · ')}
        </span>
      ),
    },
    {
      id: 'expected',
      header: t('shipments.columns.expected'),
      size: 150,
      cell: ({ row }) => (
        <span
          className={
            isLate(row.original, today) ? 'text-danger-text' : 'text-fg-muted'
          }
        >
          {row.original.expected_on ? formatDate(row.original.expected_on) : ''}
          {isLate(row.original, today) ? ` · ${t('shipments.overdue')}` : ''}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('shipments.columns.status'),
      size: 130,
      cell: ({ row }) => (
        <Status tone={shipmentTone(row.original.status)}>
          {shipmentStatusLabel(row.original)}
        </Status>
      ),
    },
  ]
}

/** A count per tab, or none while the list is still loading. */
function shipmentTabItems(
  counts: {
    open: number
    received: number
    all: number
  } | null,
) {
  const count = (value: number) => (counts === null ? undefined : value)

  return [
    {
      key: 'open',
      label: t('shipments.tabs.open'),
      count: count(counts?.open ?? 0),
    },
    {
      key: 'received',
      label: t('shipments.tabs.received'),
      count: count(counts?.received ?? 0),
    },
    {
      key: 'all',
      label: t('shipments.tabs.all'),
      count: count(counts?.all ?? 0),
    },
  ]
}

/** The direction filter, which keeps the list to one side of a shipment. */
function DirectionFilter({
  direction,
  onChange,
}: {
  direction: Direction
  onChange: (direction: Direction) => void
}) {
  return (
    <Select
      size="sm"
      aria-label={t('shipments.columns.direction')}
      value={direction}
      onChange={(e) => {
        const next = directionSchema.safeParse(e.target.value)

        if (next.success) onChange(next.data)
      }}
    >
      <option value="all">{t('shipments.tabs.all')}</option>
      <option value="outbound">{t('shipments.directions.outbound')}</option>
      <option value="inbound">{t('shipments.directions.inbound')}</option>
    </Select>
  )
}

/** The list itself: the failure, the rows, or why there are none. */
function ShipmentResults({
  isError,
  isPending,
  error,
  visible,
  columns,
  tab,
  filtered,
  newButton,
  canWrite,
  onRowClick,
}: {
  isError: boolean
  isPending: boolean
  error: unknown
  visible: ShipmentRow[]
  columns: RegistryColumn<ShipmentRow>[]
  tab: Tab
  filtered: boolean
  newButton: ReactNode
  canWrite: boolean
  onRowClick: (shipment: ShipmentRow) => void
}) {
  return (
    <>
      {isError ? (
        <div className="p-6">
          <Notice tone="bad" title={t('shipments.loadError')}>
            {messageOf(error, '')}
          </Notice>
        </div>
      ) : isPending || visible.length > 0 ? (
        <RegistryGrid
          label={t('shipments.tableLabel')}
          rows={visible}
          columns={columns}
          getRowId={(shipment) => shipment.id}
          selectable
          onRowClick={onRowClick}
          isLoading={isPending}
        />
      ) : (
        <div role="status" className="flex justify-center px-6">
          <EmptyState
            className="items-center py-14 text-center"
            icon="move"
            title={emptyTitleFor(tab, filtered)}
            description={
              filtered || tab !== 'open'
                ? undefined
                : t('shipments.empty.openBody')
            }
            action={tab === 'open' ? (newButton ?? undefined) : undefined}
          />
        </div>
      )}
      {!canWrite && !isPending ? (
        <div className="px-6 pb-4">
          <ReadOnlyNote>{t('shipments.readOnly')}</ReadOnlyNote>
        </div>
      ) : null}
    </>
  )
}

export function ShipmentsPage({ canWrite }: { canWrite: boolean }) {
  const [tab, setTab] = useState<Tab>('open')
  const [direction, setDirection] = useState<Direction>('all')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<ShipmentRow | null>(null)

  const shipments = useQuery({
    queryKey: shipmentKeys.list,
    queryFn: () => fetchShipments(notebookDataClient),
    staleTime: 10_000,
  })

  const counts = useQuery({
    queryKey: shipmentKeys.counts,
    queryFn: () => fetchManifestCounts(notebookDataClient),
    staleTime: 10_000,
  })

  const all = useMemo(() => shipments.data ?? [], [shipments.data])
  const today = appNow().toISOString().slice(0, 10)

  const inDirection = all.filter(
    (s) => direction === 'all' || s.direction === direction,
  )

  const needle = q.trim().toLowerCase()

  const visible = inTabOf(inDirection, tab).filter(
    (s) => needle === '' || matchesSearch(shipmentText(s), needle),
  )

  const columns = useMemo(
    () => shipmentColumns(counts.data, today),
    [counts.data, today],
  )

  const newButton = canWrite ? (
    <Button variant="primary" onClick={() => setCreating(true)}>
      {t('shipments.newShipment')}
    </Button>
  ) : null

  const countsByTab = shipments.isPending
    ? null
    : {
        open: inDirection.filter((s) => isOpenShipment(s.status)).length,
        received: inDirection.filter((s) => s.status === 'received').length,
        all: inDirection.length,
      }

  const onTabChange = (value: string) => {
    const next = tabSchema.safeParse(value)

    if (next.success) setTab(next.data)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('shipments.title')}
        subtitle={t('shipments.subtitle')}
        actions={newButton}
        tabs={
          <Tabs
            mode="state"
            variant="strip"
            label={t('shipments.title')}
            value={tab}
            onValueChange={onTabChange}
            items={shipmentTabItems(countsByTab)}
          />
        }
      />
      <ListToolbar
        q={q}
        onSearch={setQ}
        placeholder={t('shipments.searchPlaceholder')}
        label={t('shipments.searchPlaceholder')}
        right={
          <DirectionFilter direction={direction} onChange={setDirection} />
        }
      />
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        <ShipmentResults
          isError={shipments.isError}
          isPending={shipments.isPending}
          error={shipments.error}
          visible={visible}
          columns={columns}
          tab={tab}
          filtered={needle !== ''}
          newButton={newButton}
          canWrite={canWrite}
          onRowClick={setSelected}
        />
      </div>
      <NewShipmentDialog open={creating} onOpenChange={setCreating} />
      <ShipmentDialog
        shipment={selected}
        canWrite={canWrite}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
