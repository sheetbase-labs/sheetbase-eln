/**
 * Reagent ordering screens: the Orders list on the Materials page and the
 * dialogs that move an order along (request, mark ordered, receive, cancel).
 */
import { useMemo, useState } from 'react'
import { Link, useRouteContext } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { toast } from '#/components/ui/sonner'
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
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { ListFooter, Textarea } from '#/components/inventory/list'
import { materialListQueryKeys } from '#/components/materials/materials-data'
import { useWorkspaceMemberNames } from '#/components/projects/project-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { now as appNow } from '#/lib/clock'
import { formatDate } from '#/lib/format-date'
import {
  cancelReagentOrder,
  fetchReagentOrders,
  isOpenOrder,
  markReagentOrdered,
  reagentOrderQueryKeys,
  receiveReagentOrder,
  requestReagentOrder,
} from '#/lib/reagent-orders'
import type { ReagentOrder, ReagentOrderStatus } from '#/lib/reagent-orders'
import { t } from '#/copy'

const client = notebookDataClient

export function useReagentOrders() {
  return useQuery({
    queryKey: reagentOrderQueryKeys.all,
    queryFn: () => fetchReagentOrders(client),
    staleTime: 15_000,
  })
}

/** The open order for a material, if one is waiting. */
export function openOrderFor(
  orders: readonly ReagentOrder[] | undefined,
  materialRecordId: string,
): ReagentOrder | undefined {
  return orders?.find(
    (order) =>
      order.materialRecordId === materialRecordId && isOpenOrder(order.status),
  )
}

export const ORDER_TONE: Record<ReagentOrderStatus, Tone> = {
  requested: 'warn',
  ordered: 'progress',
  received: 'ok',
  cancelled: 'none',
}

export function orderStatusLabel(status: ReagentOrderStatus): string {
  return t(`library.materials.orders.status.${status}`)
}

function todayISO(): string {
  const now = appNow()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function quantityLabel(order: ReagentOrder): string {
  const amount = order.quantity.toLocaleString('en-GB', {
    maximumFractionDigits: 2,
  })
  return order.unit ? `${amount} ${order.unit}` : amount
}

function useRefreshOrders() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({
      queryKey: reagentOrderQueryKeys.all,
    })
    void queryClient.invalidateQueries({
      queryKey: materialListQueryKeys.page,
    })
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface ReorderMaterial {
  uuid: string
  id: string
  name: string
  unit: string | null
}

export function RequestReorderDialog({
  open,
  onOpenChange,
  material,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  material: ReorderMaterial | undefined
}) {
  const refresh = useRefreshOrders()
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const request = useMutation({
    mutationFn: () =>
      requestReagentOrder(client, {
        materialRecordId: material!.uuid,
        quantity: Number(quantity),
        unit: (unit ?? material?.unit ?? '').trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: (order) => {
      refresh()
      toast(
        t('library.materials.orders.requested', {
          reference: `RO-${String(order.number).padStart(4, '0')}`,
        }),
      )
      setQuantity('')
      setUnit(null)
      setNote('')
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast(messageOf(e, t('library.materials.orders.couldNotRequest'))),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.materials.orders.requestReorderTitle')}
          description={
            material ? `${material.id} · ${material.name}` : undefined
          }
        />
        <DialogBody>
          <form
            id="request-reorder-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const n = Number(quantity)
              if (quantity.trim() === '' || !Number.isFinite(n) || n <= 0) {
                setError(t('library.materials.orders.enterAQuantity'))
                return
              }
              setError(null)
              request.mutate()
            }}
          >
            <p className="text-label text-fg-muted">
              {t('library.materials.orders.requestReorderHelp')}
            </p>
            <Field
              label={t('library.materials.orders.quantityToOrder')}
              required
              error={error}
            >
              <Input
                type="number"
                value={quantity}
                aria-invalid={error !== null}
                onChange={(e) => {
                  setQuantity(e.target.value)
                  setError(null)
                }}
                autoFocus
                disabled={request.isPending}
              />
            </Field>
            <Field label={t('library.materials.orders.unit')}>
              <Input
                value={unit ?? material?.unit ?? ''}
                onChange={(e) => setUnit(e.target.value)}
                disabled={request.isPending}
              />
            </Field>
            <Field label={t('library.materials.orders.note')}>
              <Textarea
                value={note}
                placeholder={t('library.materials.orders.notePlaceholder')}
                onChange={(e) => setNote(e.target.value)}
                disabled={request.isPending}
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
            form="request-reorder-form"
            disabled={request.isPending}
          >
            {request.isPending
              ? t('library.materials.orders.requesting')
              : t('library.materials.orders.request')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Mark ordered
// ---------------------------------------------------------------------------

function MarkOrderedDialog({
  order,
  onClose,
}: {
  order: ReagentOrder | null
  onClose: () => void
}) {
  const refresh = useRefreshOrders()
  const [reference, setReference] = useState('')
  const [expectedOn, setExpectedOn] = useState('')
  const [supplier, setSupplier] = useState<string | null>(null)

  const mark = useMutation({
    mutationFn: () =>
      markReagentOrdered(client, {
        orderId: order!.id,
        orderReference: reference.trim() || null,
        expectedOn: expectedOn || null,
        supplier: (supplier ?? order?.supplier ?? '').trim() || null,
      }),
    onSuccess: () => {
      refresh()
      toast(
        t('library.materials.orders.markedOrdered', {
          reference: order!.reference,
        }),
      )
      setReference('')
      setExpectedOn('')
      setSupplier(null)
      onClose()
    },
    onError: (e: unknown) =>
      toast(messageOf(e, t('library.materials.orders.couldNotMarkOrdered'))),
  })

  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.materials.orders.markOrderedTitle')}
          description={
            order ? `${order.reference} · ${order.materialTitle}` : undefined
          }
        />
        <DialogBody>
          <form
            id="mark-ordered-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              mark.mutate()
            }}
          >
            <p className="text-label text-fg-muted">
              {t('library.materials.orders.markOrderedHelp')}
            </p>
            <Field label={t('library.materials.orders.supplier')}>
              <Input
                value={supplier ?? order?.supplier ?? ''}
                onChange={(e) => setSupplier(e.target.value)}
                disabled={mark.isPending}
              />
            </Field>
            <Field label={t('library.materials.orders.purchaseOrder')}>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                autoFocus
                disabled={mark.isPending}
              />
            </Field>
            <Field label={t('library.materials.orders.expectedOn')}>
              <Input
                type="date"
                value={expectedOn}
                min={todayISO()}
                onChange={(e) => setExpectedOn(e.target.value)}
                disabled={mark.isPending}
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
            form="mark-ordered-form"
            disabled={mark.isPending}
          >
            {mark.isPending
              ? t('library.materials.orders.saving')
              : t('library.materials.orders.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Receive
// ---------------------------------------------------------------------------

function ReceiveOrderDialog({
  order,
  onClose,
}: {
  order: ReagentOrder | null
  onClose: () => void
}) {
  const refresh = useRefreshOrders()
  const [lot, setLot] = useState('')
  const [expiry, setExpiry] = useState('')
  const [quantity, setQuantity] = useState<string | null>(null)
  const [errors, setErrors] = useState<{
    lot?: string
    expiry?: string
    quantity?: string
  }>({})

  const receive = useMutation({
    mutationFn: () =>
      receiveReagentOrder(client, {
        orderId: order!.id,
        lot: lot.trim(),
        expiry,
        quantity: Number(quantity ?? order!.quantity),
      }),
    onSuccess: (done) => {
      refresh()
      toast(
        t('library.materials.orders.received', {
          reference: order!.reference,
          lot: done.received_lot ?? lot.trim(),
        }),
      )
      setLot('')
      setExpiry('')
      setQuantity(null)
      onClose()
    },
    onError: (e: unknown) =>
      toast(messageOf(e, t('library.materials.orders.couldNotReceive'))),
  })

  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.materials.orders.receiveTitle')}
          description={
            order ? `${order.reference} · ${order.materialTitle}` : undefined
          }
        />
        <DialogBody>
          <form
            id="receive-order-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const n = Number(quantity ?? order?.quantity)
              const next = {
                lot: lot.trim()
                  ? undefined
                  : t('library.materials.orders.enterTheLot'),
                expiry: !expiry
                  ? t('library.materials.orders.enterTheExpiry')
                  : expiry < todayISO()
                    ? t('library.materials.orders.expiryInThePast')
                    : undefined,
                quantity:
                  Number.isFinite(n) && n > 0
                    ? undefined
                    : t('library.materials.orders.enterAQuantity'),
              }
              setErrors(next)
              if (next.lot || next.expiry || next.quantity) return
              receive.mutate()
            }}
          >
            <p className="text-label text-fg-muted">
              {t('library.materials.orders.receiveHelp')}
            </p>
            <Field
              label={t('library.materials.orders.lotNumber')}
              required
              error={errors.lot}
            >
              <Input
                value={lot}
                aria-invalid={Boolean(errors.lot)}
                onChange={(e) => setLot(e.target.value)}
                autoFocus
                disabled={receive.isPending}
              />
            </Field>
            <Field
              label={t('library.materials.orders.expiry')}
              required
              error={errors.expiry}
            >
              <Input
                type="date"
                value={expiry}
                aria-invalid={Boolean(errors.expiry)}
                onChange={(e) => setExpiry(e.target.value)}
                disabled={receive.isPending}
              />
            </Field>
            <Field
              label={`${t('library.materials.orders.quantityReceived')}${order?.unit ? ` (${order.unit})` : ''}`}
              required
              error={errors.quantity}
            >
              <Input
                type="number"
                value={quantity ?? String(order?.quantity ?? '')}
                aria-invalid={Boolean(errors.quantity)}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={receive.isPending}
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
            form="receive-order-form"
            disabled={receive.isPending}
          >
            {receive.isPending
              ? t('library.materials.orders.receiving')
              : t('library.materials.orders.receive')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

function CancelOrderDialog({
  order,
  onClose,
}: {
  order: ReagentOrder | null
  onClose: () => void
}) {
  const refresh = useRefreshOrders()
  const [reason, setReason] = useState('')
  const cancel = useMutation({
    mutationFn: () => cancelReagentOrder(client, order!.id, reason.trim()),
    onSuccess: () => {
      refresh()
      toast(
        t('library.materials.orders.cancelled', {
          reference: order!.reference,
        }),
      )
      setReason('')
      onClose()
    },
    onError: (e: unknown) =>
      toast(messageOf(e, t('library.materials.orders.couldNotCancel'))),
  })
  return (
    <ConfirmDialog
      open={order !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t('library.materials.orders.cancelTitle')}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {order ? `${order.reference} · ${order.materialTitle}. ` : ''}
            {t('library.materials.orders.cancelHelp')}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <Textarea
          className="min-h-[70px]"
          placeholder={t('library.materials.orders.cancelReason')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>
            {t('library.materials.orders.keepOrder')}
          </ConfirmDialogCancel>
          <ConfirmDialogAction
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending
              ? t('library.materials.orders.cancelling')
              : t('library.materials.orders.cancel')}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

// ---------------------------------------------------------------------------
// The Orders list
// ---------------------------------------------------------------------------

type OrderFilter = 'open' | ReagentOrderStatus | 'all'
const FILTERS: readonly OrderFilter[] = [
  'open',
  'requested',
  'ordered',
  'received',
  'cancelled',
  'all',
]

function matches(order: ReagentOrder, filter: OrderFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return isOpenOrder(order.status)
  return order.status === filter
}

export function ReagentOrdersPanel({
  canPlace,
  canWrite,
}: {
  canPlace: boolean
  canWrite: boolean
}) {
  const { auth } = useRouteContext({ from: '__root__' })
  const currentUserId = auth?.user.id ?? null
  const orders = useReagentOrders()
  const names = useWorkspaceMemberNames()
  const [filter, setFilter] = useState<OrderFilter>('open')
  const [ordering, setOrdering] = useState<ReagentOrder | null>(null)
  const [receiving, setReceiving] = useState<ReagentOrder | null>(null)
  const [cancelling, setCancelling] = useState<ReagentOrder | null>(null)

  const all = orders.data ?? []
  const visible = useMemo(
    () => all.filter((order) => matches(order, filter)),
    [all, filter],
  )

  const columns = useMemo<RegistryColumn<ReagentOrder>[]>(
    () => [
      {
        id: 'reference',
        header: t('library.materials.orders.columns.order'),
        cell: ({ row }) => (
          <span className="mono">{row.original.reference}</span>
        ),
      },
      {
        id: 'material',
        header: t('library.materials.orders.columns.material'),
        cell: ({ row }) => {
          const order = row.original
          return order.materialRecordId ? (
            <Link
              to="/materials/$lotId"
              params={{ lotId: order.materialRecordId }}
              className="hover:underline"
            >
              {order.materialTitle}
            </Link>
          ) : (
            order.materialTitle
          )
        },
      },
      {
        id: 'quantity',
        header: t('library.materials.orders.columns.quantity'),
        accessorFn: quantityLabel,
      },
      {
        id: 'supplier',
        header: t('library.materials.orders.columns.supplier'),
        accessorFn: (order) =>
          [order.supplier, order.catalogNo].filter(Boolean).join(' · ') || '—',
      },
      {
        id: 'requested',
        header: t('library.materials.orders.columns.requested'),
        accessorFn: (order) =>
          `${
            (order.requestedBy && names.data?.get(order.requestedBy)) ||
            t('library.materials.orders.colleague')
          } · ${formatDate(order.requestedAt)}`,
      },
      {
        id: 'expected',
        header: t('library.materials.orders.columns.expected'),
        accessorFn: (order) =>
          order.status === 'received'
            ? t('library.materials.orders.receivedLot', {
                lot: order.receivedLot ?? '—',
              })
            : [
                order.orderReference,
                order.expectedOn ? formatDate(order.expectedOn) : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—',
      },
      {
        id: 'status',
        header: t('library.materials.orders.columns.status'),
        cell: ({ row }) => (
          <Status tone={ORDER_TONE[row.original.status]}>
            {orderStatusLabel(row.original.status)}
          </Status>
        ),
      },
      {
        id: 'actions',
        header: t('library.materials.orders.columns.actions'),
        cell: ({ row }) => {
          const order = row.original
          if (!isOpenOrder(order.status)) {
            return order.status === 'received' && order.receivedRecordId ? (
              <Link
                to="/materials/$lotId"
                params={{ lotId: order.receivedRecordId }}
                className="text-label hover:underline"
              >
                {t('library.materials.orders.openNewLot')}
              </Link>
            ) : null
          }
          const mine = order.requestedBy === currentUserId
          return (
            <span className="flex gap-1.5">
              {canPlace && order.status === 'requested' ? (
                <Button size="sm" onClick={() => setOrdering(order)}>
                  {t('library.materials.orders.markOrdered')}
                </Button>
              ) : null}
              {canWrite ? (
                <Button
                  size="sm"
                  variant={order.status === 'ordered' ? 'primary' : 'secondary'}
                  onClick={() => setReceiving(order)}
                >
                  {t('library.materials.orders.receive')}
                </Button>
              ) : null}
              {canWrite && (canPlace || mine) ? (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setCancelling(order)}
                >
                  {t('common.actions.cancel')}
                </Button>
              ) : null}
            </span>
          )
        },
      },
    ],
    [names.data, canPlace, canWrite, currentUserId],
  )

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-6 py-2 max-md:px-4">
        <Tabs
          mode="state"
          variant="segment"
          label={t('library.materials.orders.tabLabel')}
          value={filter}
          onValueChange={(value) => setFilter(value as OrderFilter)}
          items={FILTERS.map((key) => ({
            key,
            label: t(`library.materials.orders.filters.${key}`),
            count: orders.isPending
              ? undefined
              : all.filter((order) => matches(order, key)).length,
          }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {orders.isPending || visible.length > 0 ? (
          <RegistryGrid
            label={t('library.materials.orders.tableLabel')}
            rows={visible}
            columns={columns}
            getRowId={(order) => order.id}
            selectable={false}
            isLoading={orders.isPending}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="box"
              title={
                filter === 'open' || filter === 'all'
                  ? t('library.materials.orders.emptyTitle')
                  : t('library.materials.orders.emptyFilteredTitle', {
                      status: t(
                        `library.materials.orders.filters.${filter}`,
                      ).toLowerCase(),
                    })
              }
              description={
                filter === 'open' || filter === 'all'
                  ? t('library.materials.orders.emptyBody')
                  : t('library.materials.orders.emptyFilteredBody')
              }
            />
          </div>
        )}
      </div>
      <ListFooter loading={orders.isPending}>
        {t('library.materials.orders.footer', {
          shown: visible.length,
          total: all.length,
        })}
      </ListFooter>
      <MarkOrderedDialog order={ordering} onClose={() => setOrdering(null)} />
      <ReceiveOrderDialog
        order={receiving}
        onClose={() => setReceiving(null)}
      />
      <CancelOrderDialog
        order={cancelling}
        onClose={() => setCancelling(null)}
      />
    </>
  )
}
