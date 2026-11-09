/**
 * The Shipments page: boxes leaving the lab or arriving at it, each with a
 * manifest, followed from packing to received.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

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

type Tab = 'open' | 'received' | 'all'

type Direction = 'all' | 'outbound' | 'inbound'

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

  const open = inDirection.filter((s) => isOpenShipment(s.status))
  const received = inDirection.filter((s) => s.status === 'received')

  const inTab =
    tab === 'open' ? open : tab === 'received' ? received : inDirection

  const needle = q.trim().toLowerCase()

  const visible = inTab.filter(
    (s) => needle === '' || shipmentText(s).includes(needle),
  )

  const columns = useMemo<RegistryColumn<ShipmentRow>[]>(
    () => [
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
            {counts.data?.get(row.original.id) ?? ''}
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
            {row.original.expected_on
              ? formatDate(row.original.expected_on)
              : ''}
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
    ],
    [counts.data, today],
  )

  const newButton = canWrite ? (
    <Button variant="primary" onClick={() => setCreating(true)}>
      {t('shipments.newShipment')}
    </Button>
  ) : null

  const emptyTitle =
    tab === 'open'
      ? t('shipments.empty.open')
      : tab === 'received'
        ? t('shipments.empty.received')
        : t('shipments.empty.all')

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
            onValueChange={(value) => setTab(value as Tab)}
            items={[
              {
                key: 'open',
                label: t('shipments.tabs.open'),
                count: shipments.isPending ? undefined : open.length,
              },
              {
                key: 'received',
                label: t('shipments.tabs.received'),
                count: shipments.isPending ? undefined : received.length,
              },
              {
                key: 'all',
                label: t('shipments.tabs.all'),
                count: shipments.isPending ? undefined : inDirection.length,
              },
            ]}
          />
        }
      />
      <ListToolbar
        q={q}
        onSearch={setQ}
        placeholder={t('shipments.searchPlaceholder')}
        label={t('shipments.searchPlaceholder')}
        right={
          <Select
            size="sm"
            aria-label={t('shipments.columns.direction')}
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
          >
            <option value="all">{t('shipments.tabs.all')}</option>
            <option value="outbound">
              {t('shipments.directions.outbound')}
            </option>
            <option value="inbound">{t('shipments.directions.inbound')}</option>
          </Select>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {shipments.isError ? (
          <div className="p-6">
            <Notice tone="bad" title={t('shipments.loadError')}>
              {messageOf(shipments.error, '')}
            </Notice>
          </div>
        ) : shipments.isPending || visible.length > 0 ? (
          <RegistryGrid
            label={t('shipments.tableLabel')}
            rows={visible}
            columns={columns}
            getRowId={(shipment) => shipment.id}
            selectable
            onRowClick={setSelected}
            isLoading={shipments.isPending}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="move"
              title={needle ? t('shipments.empty.filtered') : emptyTitle}
              description={
                needle || tab !== 'open'
                  ? undefined
                  : t('shipments.empty.openBody')
              }
              action={tab === 'open' ? (newButton ?? undefined) : undefined}
            />
          </div>
        )}
        {!canWrite && !shipments.isPending ? (
          <div className="px-6 pb-4">
            <ReadOnlyNote>{t('shipments.readOnly')}</ReadOnlyNote>
          </div>
        ) : null}
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
