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
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
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
import {
  ORDER_TONE,
  orderStatusLabel,
} from '#/components/materials/reagent-order-model'
import { useWorkspaceMemberNames } from '#/components/projects/project-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { now as appNow } from '#/lib/clock'
import { formatDate } from '#/lib/format-date'
import {
  cancelReagentOrder,
  fetchReagentOrderPrices,
  fetchReagentOrders,
  isOpenOrder,
  markReagentOrdered,
  reagentOrderQueryKeys,
  receiveReagentOrder,
  requestReagentOrder,
  setReagentOrderPrice,
} from '#/lib/reagent-orders'
import type {
  OrderPrice,
  ReagentOrder,
  ReagentOrderStatus,
} from '#/lib/reagent-orders'
import {
  currencyOptions,
  isCurrencyCode,
  lastCurrency,
  rememberCurrency,
} from '#/lib/currency'
import { formatMoney } from '#/lib/report-period'
import {
  SetUpSuppliers,
  useSuppliers,
} from '#/components/materials/supplier-list'
import { t } from '#/copy'

const client = notebookDataClient

export function useReagentOrders() {
  return useQuery({
    queryKey: reagentOrderQueryKeys.all,
    queryFn: () => fetchReagentOrders(client),
    staleTime: 15_000,
  })
}

/** What each order cost; empty for anyone who may not read prices. */
export function useReagentOrderPrices(enabled: boolean) {
  return useQuery({
    queryKey: reagentOrderQueryKeys.prices,
    queryFn: () => fetchReagentOrderPrices(client),
    enabled,
    staleTime: 15_000,
  })
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

function messageOf<Cause>(error: Cause, fallback: string): string {
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
    onError: (e) =>
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

const OTHER_SUPPLIER = '__other__'

/** The price and currency fields shared by placing an order and editing its price. */
function PriceFields({
  price,
  currency,
  onPrice,
  onCurrency,
  error,
  disabled,
  autoFocus,
}: {
  price: string
  currency: string
  onPrice: (value: string) => void
  onCurrency: (value: string) => void
  error?: string | null
  disabled?: boolean
  autoFocus?: boolean
}) {
  return (
    <div className="grid grid-cols-[1fr_120px] items-start gap-3">
      <Field
        label={t('spend.price.amount')}
        hint={t('spend.price.amountHint')}
        error={error}
      >
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={price}
          aria-invalid={error != null && error !== ''}
          autoFocus={autoFocus}
          onChange={(e) => onPrice(e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label={t('spend.price.currency')}>
        <Select
          value={currency}
          onChange={(e) => onCurrency(e.target.value)}
          disabled={disabled}
        >
          {currencyOptions(currency).map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}

/** A price typed in a form: empty means none, otherwise zero or more. */
function parsePrice(text: string): number | null | 'invalid' {
  if (text.trim() === '') return null
  const value = Number(text)

  return Number.isFinite(value) && value >= 0 ? value : 'invalid'
}

function MarkOrderedDialog({
  order,
  onClose,
  canSetUpSuppliers,
}: {
  order: ReagentOrder | null
  onClose: () => void
  canSetUpSuppliers: boolean
}) {
  const refresh = useRefreshOrders()
  const list = useSuppliers()
  const [reference, setReference] = useState('')
  const [expectedOn, setExpectedOn] = useState('')
  const [supplierChoice, setSupplierChoice] = useState<string | null>(null)
  const [supplierName, setSupplierName] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(lastCurrency)
  const [priceError, setPriceError] = useState<string | null>(null)

  const hasList = list.suppliers.length > 0

  // With a supplier list the order starts on the supplier whose name matches
  // what the material says; without one it is a plain name.
  const matching = hasList
    ? list.suppliers.find(
        (s) =>
          s.title.trim().toLowerCase() ===
          (order?.supplier ?? '').trim().toLowerCase(),
      )
    : undefined

  const choice =
    supplierChoice ??
    (hasList
      ? (matching?.id ?? (order?.supplier ? OTHER_SUPPLIER : ''))
      : OTHER_SUPPLIER)

  const typedName = supplierName ?? order?.supplier ?? ''

  const reset = () => {
    setReference('')
    setExpectedOn('')
    setSupplierChoice(null)
    setSupplierName(null)
    setPrice('')
    setPriceError(null)
  }

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- The mutation's onSuccess calls refresh(), which invalidates the order and material list queries.
  const mark = useMutation({
    mutationFn: () => {
      const parsed = parsePrice(price)

      return markReagentOrdered(client, {
        orderId: order!.id,
        orderReference: reference.trim() || null,
        expectedOn: expectedOn || null,
        supplier: choice === OTHER_SUPPLIER ? typedName.trim() || null : null,
        supplierRecordId: choice && choice !== OTHER_SUPPLIER ? choice : null,
        totalPrice: parsed === 'invalid' ? null : parsed,
        currency: parsed === null || parsed === 'invalid' ? null : currency,
      })
    },
    onSuccess: () => {
      refresh()

      if (parsePrice(price) !== null) rememberCurrency(currency)
      toast(
        t('library.materials.orders.markedOrdered', {
          reference: order!.reference,
        }),
      )
      reset()
      onClose()
    },
    onError: (e) =>
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
              const parsed = parsePrice(price)

              if (parsed === 'invalid') {
                setPriceError(t('spend.price.enterAPrice'))

                return
              }

              setPriceError(null)
              mark.mutate()
            }}
          >
            <p className="text-label text-fg-muted">
              {t('library.materials.orders.markOrderedHelp')}
            </p>
            {hasList ? (
              <Field label={t('spend.suppliers.field')}>
                <Select
                  value={choice}
                  onChange={(e) => setSupplierChoice(e.target.value)}
                  disabled={mark.isPending}
                >
                  <option value="">{t('spend.suppliers.none')}</option>
                  {list.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                  <option value={OTHER_SUPPLIER}>
                    {t('spend.suppliers.anotherSupplier')}
                  </option>
                </Select>
              </Field>
            ) : null}
            {choice === OTHER_SUPPLIER ? (
              <Field
                label={
                  hasList
                    ? t('spend.suppliers.anotherName')
                    : t('library.materials.orders.supplier')
                }
              >
                <Input
                  value={typedName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  disabled={mark.isPending}
                />
              </Field>
            ) : null}
            {!hasList && !list.isPending ? (
              <SetUpSuppliers canSetUp={canSetUpSuppliers} />
            ) : null}
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
            <PriceFields
              price={price}
              currency={currency}
              onPrice={(value) => {
                setPrice(value)
                setPriceError(null)
              }}
              onCurrency={setCurrency}
              error={priceError}
              disabled={mark.isPending}
            />
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
// Price
// ---------------------------------------------------------------------------

/** Enter, change or remove what an order cost. */
export function OrderPriceDialog({
  order,
  current,
  onClose,
}: {
  order: ReagentOrder | null
  current: OrderPrice | undefined
  onClose: () => void
}) {
  const refresh = useRefreshOrders()
  const [price, setPrice] = useState<string | null>(null)
  const [currency, setCurrency] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const shownPrice = price ?? (current ? String(current.totalPrice) : '')
  const shownCurrency = currency ?? current?.currency ?? lastCurrency()

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- The mutation's onSuccess calls refresh(), which invalidates the order and material list queries.
  const save = useMutation({
    mutationFn: (value: number | null) =>
      setReagentOrderPrice(client, {
        orderId: order!.id,
        totalPrice: value,
        currency: value === null ? null : shownCurrency,
      }),
    onSuccess: (_result, value) => {
      refresh()

      if (value !== null) rememberCurrency(shownCurrency)
      toast(value === null ? t('spend.price.removed') : t('spend.price.saved'))
      setPrice(null)
      setCurrency(null)
      onClose()
    },
    onError: (e) => toast(messageOf(e, t('spend.price.couldNotSave'))),
  })

  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader
          title={t('spend.price.dialogTitle')}
          description={
            order ? `${order.reference} · ${order.materialTitle}` : undefined
          }
        />
        <DialogBody>
          {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- The dialog is a client form with no server action to post to; Enter submits it in place. */}
          <form
            id="order-price-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const parsed = parsePrice(shownPrice)

              if (parsed === null || parsed === 'invalid') {
                setError(t('spend.price.enterAPrice'))

                return
              }

              if (!isCurrencyCode(shownCurrency)) {
                setError(t('spend.price.enterACurrency'))

                return
              }

              setError(null)
              save.mutate(parsed)
            }}
          >
            <PriceFields
              price={shownPrice}
              currency={shownCurrency}
              onPrice={(value) => {
                setPrice(value)
                setError(null)
              }}
              onCurrency={setCurrency}
              error={error}
              disabled={save.isPending}
              autoFocus
            />
          </form>
        </DialogBody>
        <DialogFooter>
          {current ? (
            <Button
              variant="quiet"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              {t('spend.price.remove')}
            </Button>
          ) : null}
          <span className="flex-1" />
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="order-price-form"
            disabled={save.isPending}
          >
            {t('spend.price.save')}
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

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- The mutation's onSuccess calls refresh(), which invalidates the order and material list queries.
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
    onError: (e) =>
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

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- The mutation's onSuccess calls refresh(), which invalidates the order and material list queries.
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
    onError: (e) =>
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
          className="mx-5 my-3 box-border min-h-[70px] w-[calc(100%-2.5rem)]"
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

/** Whether a tab's key names one of the order filters. */
function isOrderFilter(value: string): value is OrderFilter {
  return FILTERS.some((filter) => filter === value)
}

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
  const prices = useReagentOrderPrices(canPlace)
  const names = useWorkspaceMemberNames()
  const [filter, setFilter] = useState<OrderFilter>('open')
  const [pricing, setPricing] = useState<ReagentOrder | null>(null)
  const [ordering, setOrdering] = useState<ReagentOrder | null>(null)
  const [receiving, setReceiving] = useState<ReagentOrder | null>(null)
  const [cancelling, setCancelling] = useState<ReagentOrder | null>(null)

  const all = useMemo(() => orders.data ?? [], [orders.data])

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
      ...(canPlace
        ? [
            {
              id: 'price',
              header: t('spend.price.column'),
              accessorFn: (order: ReagentOrder) => {
                const price = prices.data?.get(order.id)

                return price
                  ? formatMoney(price.totalPrice, price.currency)
                  : ''
              },
              cell: ({ row }: { row: { original: ReagentOrder } }) => {
                const order = row.original
                const price = prices.data?.get(order.id)

                if (price) {
                  return (
                    <span className="num">
                      {formatMoney(price.totalPrice, price.currency)}
                    </span>
                  )
                }

                if (
                  order.status === 'requested' ||
                  order.status === 'cancelled'
                ) {
                  return <span className="text-fg-muted">—</span>
                }

                return (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setPricing(order)}
                  >
                    {t('spend.price.edit')}
                  </Button>
                )
              },
            } satisfies RegistryColumn<ReagentOrder>,
          ]
        : []),
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
    [names.data, canPlace, canWrite, currentUserId, prices.data],
  )

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-6 py-2 max-md:px-4">
        <Tabs
          mode="state"
          variant="segment"
          label={t('library.materials.orders.tabLabel')}
          value={filter}
          onValueChange={(value) => {
            if (isOrderFilter(value)) setFilter(value)
          }}
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
      <MarkOrderedDialog
        order={ordering}
        onClose={() => setOrdering(null)}
        canSetUpSuppliers={canPlace}
      />
      <OrderPriceDialog
        order={pricing}
        current={pricing ? prices.data?.get(pricing.id) : undefined}
        onClose={() => setPricing(null)}
      />
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
