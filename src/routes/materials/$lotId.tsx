import { useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  PageHeader,
} from '#/components/v3/ui/layout'
import { ReplacementForm, stockOfTotal } from '../materials'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { Textarea } from '#/components/v3/inventory/list'
import {
  materialListQueryKeys,
  toMaterialListRow,
} from '#/components/v3/materials/materials-data'
import {
  MOVEMENT_LABELS,
  fetchCertificateFile,
  fetchReagent,
  fetchReagentMovements,
  fetchReagentUsage,
  fetchReplacementLot,
  recordReagentMovement,
  registerReplacementLot,
} from '#/lib/reagent-data'
import type { ReagentMovement } from '#/lib/reagent-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useUserNames } from '#/lib/user-names'

/** Roadmap Phase 6 (stock): the reagent lot page. A lot has a page of its own
 * with the Use action, the full movement ledger and its certificate, rather
 * than only the registry's inspector. */
export const Route = createFileRoute('/materials/$lotId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    await resolveIdentifierParam({
      entity: 'record',
      ref: params.lotId,
      href: location.href,
    })
    return { context }
  },
  component: LotPage,
})

export const lotQueryKey = (lotId: string) =>
  ['ui-port', 'materials', 'lot', lotId] as const
export const lotLedgerQueryKey = (lotId: string) =>
  ['ui-port', 'materials', 'ledger', lotId] as const

function dayLabel(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    .replace('Sept', 'Sep')
}

function dateTimeLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date
    .toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })
    .replace('Sept', 'Sep')
}

function amount(value: number, unit: string | null): string {
  // "1 unit", "2 units": a unit stored in the plural reads as one at one.
  const shown = unit && value === 1 ? unit.replace(/s$/, '') : unit
  return `${value.toLocaleString('en-GB', { maximumFractionDigits: 3 })}${shown ? ` ${shown}` : ''}`
}

/** A movement's signed change, or a dash for the operations that move no stock. */
export function movementChange(movement: ReagentMovement): string {
  if (movement.operation === 'consume')
    return `−${amount(Math.abs(movement.quantityDelta), movement.unit)}`
  if (movement.operation === 'receive')
    return `+${amount(Math.abs(movement.quantityDelta), movement.unit)}`
  return '—'
}

type LotTab = 'details' | 'ledger' | 'used'

function LotPage() {
  const { lotId } = Route.useParams()
  const queryClient = useQueryClient()
  const [useOpen, setUseOpen] = useState(false)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const [quarantineOpen, setQuarantineOpen] = useState(false)
  const [quarantineReason, setQuarantineReason] = useState('')
  const [tab, setTab] = useState<LotTab>('details')

  const lot = useQuery({
    queryKey: lotQueryKey(lotId),
    queryFn: () => fetchReagent(notebookDataClient, lotId),
  })
  const reagent = lot.data ?? null
  const ledger = useQuery({
    queryKey: lotLedgerQueryKey(lotId),
    queryFn: () => fetchReagentMovements(notebookDataClient, lotId, 200),
  })
  const usage = useQuery({
    queryKey: ['ui-port', 'materials', 'usage', reagent?.identifier ?? ''],
    queryFn: () => fetchReagentUsage(notebookDataClient, reagent!.identifier),
    enabled: Boolean(reagent),
  })
  const certificate = useQuery({
    queryKey: ['ui-port', 'materials', 'certificate', lotId],
    queryFn: () => fetchCertificateFile(notebookDataClient, lotId),
  })
  const replacementLink = useQuery({
    queryKey: [
      'ui-port',
      'materials',
      'replacement',
      reagent?.identifier ?? '',
    ],
    queryFn: () => fetchReplacementLot(notebookDataClient, reagent!.identifier),
    enabled: Boolean(reagent),
  })
  const { userLabel } = useUserNames(
    (ledger.data ?? []).map((m) => m.actorUserId ?? '').filter(Boolean),
  )

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: lotQueryKey(lotId) })
    void queryClient.invalidateQueries({ queryKey: lotLedgerQueryKey(lotId) })
    void queryClient.invalidateQueries({
      queryKey: materialListQueryKeys.page,
    })
  }

  const use = useMutation({
    mutationFn: (input: { quantity: number; reason?: string }) =>
      recordReagentMovement(notebookDataClient, {
        recordId: lotId,
        operation: 'consume',
        quantityDelta: input.quantity,
        reason: input.reason,
        expectedMetadataVersion: reagent!.metadataVersion,
      }),
    onSuccess: () => {
      refresh()
      toast('Use recorded')
      setUseOpen(false)
    },
    onError: (error: unknown) => {
      toast(error instanceof Error ? error.message : 'Could not record use')
    },
  })
  // A quarantined lot is isolated, not gone: the same call restores it.
  const hold = useMutation({
    mutationFn: (input: {
      operation: 'quarantine' | 'restore'
      reason?: string
    }) =>
      recordReagentMovement(notebookDataClient, {
        recordId: lotId,
        operation: input.operation,
        quantityDelta: 0,
        reason: input.reason?.trim() || undefined,
        expectedMetadataVersion: reagent!.metadataVersion,
      }),
    onSuccess: (_result, input) => {
      refresh()
      toast(
        input.operation === 'quarantine' ? 'Lot quarantined' : 'Lot restored',
      )
      setQuarantineOpen(false)
      setQuarantineReason('')
    },
    onError: (error: unknown) => {
      toast(error instanceof Error ? error.message : 'Could not change the lot')
    },
  })
  const replacement = useMutation({
    mutationFn: (input: {
      lot: string
      expiry: string
      quantity: number
      unit?: string
      reason?: string
    }) =>
      registerReplacementLot(notebookDataClient, {
        recordId: lotId,
        lot: input.lot,
        expiry: input.expiry,
        quantity: input.quantity,
        unit: input.unit ?? reagent!.unit,
        reason: input.reason,
      }),
    onSuccess: () => {
      refresh()
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'materials', 'replacement'],
      })
      toast('Replacement lot registered')
      setReplacementOpen(false)
    },
    onError: (error: unknown) => {
      toast(
        error instanceof Error
          ? error.message
          : 'Could not register the replacement lot',
      )
    },
  })

  if (!reagent) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Materials', link: { to: '/materials' } }]}
          title={lot.isLoading ? 'Loading lot…' : 'Lot not found'}
        />
      </div>
    )
  }

  const row = toMaterialListRow(reagent)
  const quarantined = reagent.status === 'quarantined'
  const usable =
    !quarantined &&
    !row.tabs.includes('expired') &&
    reagent.status !== 'consumed' &&
    (reagent.quantity ?? 0) > 0
  const certificateLabel = certificate.data ? (
    <Link
      to="/records/$recordId"
      params={{ recordId: certificate.data.fileRecordId }}
      className="hover:underline"
    >
      {certificate.data.displayName}
    </Link>
  ) : (
    (row.certificate ?? '—')
  )
  const usedCount = usage.data?.length ?? 0
  const ledgerCount = ledger.data?.length ?? 0

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Materials', link: { to: '/materials' } },
          { label: reagent.identifier, mono: true },
        ]}
        title={reagent.title}
        meta={
          <>
            <span>lot {row.lot}</span>
            <Status tone={row.status.tone}>
              {row.expiryNote ?? row.status.label}
            </Status>
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setReplacementOpen(true)}
            >
              Register replacement lot
            </Button>
            <Button
              variant="primary"
              disabled={!usable}
              title={
                usable
                  ? undefined
                  : 'A quarantined, expired or empty lot cannot be used.'
              }
              onClick={() => setUseOpen(true)}
            >
              Use
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="secondary"
                    aria-label="More lot actions"
                    icon="more"
                  />
                }
              />
              <DropdownMenuContent align="end">
                {quarantined ? (
                  <DropdownMenuItem
                    disabled={hold.isPending}
                    onClick={() => hold.mutate({ operation: 'restore' })}
                  >
                    Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    danger
                    onClick={() => setQuarantineOpen(true)}
                  >
                    Quarantine…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        tabs={
          <Tabs
            mode="state"
            label="Lot sections"
            value={tab}
            onValueChange={(next) => setTab(next as LotTab)}
            items={[
              { key: 'details', label: 'Details' },
              {
                key: 'ledger',
                label: 'Ledger',
                count: ledger.data ? ledgerCount : undefined,
              },
              {
                key: 'used',
                label: 'Used in',
                count: usage.data ? usedCount : undefined,
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto px-6 py-5">
          {tab === 'details' ? (
            <>
              <section aria-label="Lot" className="max-w-xl">
                <h2 className="mb-1.5 font-sans text-label font-semibold">
                  Lot
                </h2>
                <DescriptionList
                  labelWidth={96}
                  items={[
                    [
                      'Supplier',
                      row.catalogNo
                        ? `${row.supplier} · cat. ${row.catalogNo}`
                        : row.supplier,
                    ],
                    ['Stock', stockOfTotal(row)],
                    ['Location', row.location],
                    ['Expiry', dayLabel(reagent.expiry)],
                    ['Received', dayLabel(row.received)],
                  ]}
                />
              </section>
              <section aria-label="Certificate" className="max-w-xl">
                <h2 className="mb-1.5 font-sans text-label font-semibold">
                  Certificate of analysis
                </h2>
                {certificate.data ? (
                  <span className="text-label">{certificateLabel}</span>
                ) : (
                  <p className="text-label text-fg-muted">
                    {row.certificate ??
                      'No certificate is attached to this lot.'}
                  </p>
                )}
              </section>
            </>
          ) : null}
          {tab === 'ledger' ? (
            <section aria-label="Ledger">
              {ledger.data && ledger.data.length > 0 ? (
                <table className="w-full max-w-4xl border-collapse text-label">
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th className="py-1 pr-3 font-medium">When</th>
                      <th className="py-1 pr-3 font-medium">Movement</th>
                      <th className="py-1 pr-3 text-right font-medium">
                        Change
                      </th>
                      <th className="py-1 pr-3 text-right font-medium">
                        Balance
                      </th>
                      <th className="py-1 pr-3 font-medium">By</th>
                      <th className="py-1 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="py-1 pr-3">
                          {dateTimeLabel(m.createdAt)}
                        </td>
                        <td className="py-1 pr-3">
                          {MOVEMENT_LABELS[m.operation]}
                        </td>
                        <td className="mono py-1 pr-3 text-right">
                          {movementChange(m)}
                        </td>
                        <td className="mono py-1 pr-3 text-right">
                          {amount(m.resultingQuantity, m.unit)}
                        </td>
                        <td className="py-1 pr-3">
                          {m.actorUserId ? userLabel(m.actorUserId) : '—'}
                        </td>
                        <td className="py-1">{m.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-label text-fg-muted">
                  {ledger.isLoading ? 'Loading ledger…' : 'No movements yet.'}
                </p>
              )}
            </section>
          ) : null}
          {tab === 'used' ? (
            <section aria-label="Used in">
              {usage.data?.length ? (
                <ul className="flex flex-col gap-1">
                  {usage.data.map((link) => (
                    <li key={link.id} className="text-label">
                      <Link
                        to="/records/$recordId"
                        params={{
                          recordId:
                            link.sourceRecordId ?? link.sourceIdentifier,
                        }}
                        className="mono hover:underline"
                      >
                        {link.sourceIdentifier}
                      </Link>
                      {link.quantity != null
                        ? ` · ${amount(link.quantity, link.unit)}`
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-label text-fg-muted">
                  {usage.isLoading
                    ? 'Loading…'
                    : 'No experiment has used this lot yet.'}
                </p>
              )}
            </section>
          ) : null}
        </div>
        <Inspector aria-label="Lot context" className="w-[300px]">
          <InspectorSection title="Release">
            <DescriptionList
              labelWidth={88}
              items={[
                [
                  'Released by',
                  row.releasedBy
                    ? `${row.releasedBy} · ${dayLabel(row.releasedAt)}`
                    : '—',
                ],
                ['Certificate', certificateLabel],
              ]}
            />
          </InspectorSection>
          <InspectorSection
            title={
              replacementLink.data ? 'Replacement lot' : 'No replacement lot'
            }
          >
            <p className="text-label text-fg-muted">
              {replacementLink.data
                ? `${replacementLink.data.targetIdentifier}${replacementLink.data.reason ? ` · ${replacementLink.data.reason}` : ''}`
                : 'No lot has been registered to replace this one.'}
            </p>
          </InspectorSection>
          <InspectorSection title="Recent movements">
            {ledger.data && ledger.data.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {ledger.data.slice(0, 3).map((m) => (
                  <li key={m.id} className="text-label">
                    {MOVEMENT_LABELS[m.operation]} {movementChange(m)},{' '}
                    {dayLabel(m.createdAt)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-label text-fg-muted">No movements yet.</p>
            )}
          </InspectorSection>
        </Inspector>
      </div>

      <Dialog open={replacementOpen} onOpenChange={setReplacementOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title="Register replacement lot"
            description={`${reagent.identifier} · ${reagent.title}`}
          />
          <DialogBody>
            <ReplacementForm
              busy={replacement.isPending}
              unit={reagent.unit}
              onSubmit={(input) => replacement.mutate(input)}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="replacement-lot-form"
              disabled={replacement.isPending}
            >
              {replacement.isPending ? 'Registering…' : 'Register'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={quarantineOpen} onOpenChange={setQuarantineOpen}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>Quarantine this lot?</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {reagent.identifier} · {reagent.title}. A quarantined lot is held
              aside and experiments cannot use it until it is restored.
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <Textarea
            className="min-h-[70px]"
            placeholder="Why is this lot held? (optional)…"
            value={quarantineReason}
            onChange={(event) => setQuarantineReason(event.target.value)}
          />
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={hold.isPending}
              onClick={() =>
                hold.mutate({
                  operation: 'quarantine',
                  reason: quarantineReason,
                })
              }
            >
              {hold.isPending ? 'Quarantining…' : 'Quarantine'}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>

      <Dialog open={useOpen} onOpenChange={setUseOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title="Use from this lot"
            description={`${reagent.identifier} · ${reagent.title} · ${row.stock} left`}
          />
          <DialogBody>
            <UseForm
              busy={use.isPending}
              available={reagent.quantity}
              unit={reagent.unit}
              onSubmit={(input) => use.mutate(input)}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="use-lot-form"
              disabled={use.isPending}
            >
              {use.isPending ? 'Recording…' : 'Use'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function UseForm({
  busy,
  available,
  unit,
  onSubmit,
}: {
  busy: boolean
  available: number | null
  unit: string | null
  onSubmit: (input: { quantity: number; reason?: string }) => void
}) {
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      id="use-lot-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(quantity)
        if (quantity.trim() === '' || !Number.isFinite(n) || n <= 0) {
          setError('Enter the quantity used, greater than zero.')
          return
        }
        if (available != null && n > available) {
          setError(
            `Only ${amount(available, unit)} is left in this lot, so ${amount(n, unit)} cannot be used.`,
          )
          return
        }
        setError(null)
        onSubmit({ quantity: n, reason: reason.trim() || undefined })
      }}
    >
      <Field
        label={unit ? `Quantity (${unit})` : 'Quantity'}
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
          disabled={busy}
        />
      </Field>
      <Field label="Reason">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}
