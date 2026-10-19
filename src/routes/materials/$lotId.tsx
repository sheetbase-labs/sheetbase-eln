import { useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { Notice } from '#/components/v3/ui/alert'
import { DescriptionList, PageHeader } from '#/components/v3/ui/layout'
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
  recordReagentMovement,
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
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function dateTimeLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function amount(value: number, unit: string | null): string {
  return `${value.toLocaleString('en-GB', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`
}

/** A movement's signed change, or a dash for the operations that move no stock. */
export function movementChange(movement: ReagentMovement): string {
  if (movement.operation === 'consume')
    return `−${amount(Math.abs(movement.quantityDelta), movement.unit)}`
  if (movement.operation === 'receive')
    return `+${amount(Math.abs(movement.quantityDelta), movement.unit)}`
  return '—'
}

function LotPage() {
  const { lotId } = Route.useParams()
  const queryClient = useQueryClient()
  const [useOpen, setUseOpen] = useState(false)

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
  const { userLabel } = useUserNames(
    (ledger.data ?? []).map((m) => m.actorUserId ?? '').filter(Boolean),
  )

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
      void queryClient.invalidateQueries({ queryKey: lotQueryKey(lotId) })
      void queryClient.invalidateQueries({
        queryKey: lotLedgerQueryKey(lotId),
      })
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast('Use recorded')
      setUseOpen(false)
    },
    onError: (error: unknown) => {
      toast(error instanceof Error ? error.message : 'Could not record use')
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

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Materials', link: { to: '/materials' } },
          { label: reagent.identifier },
        ]}
        title={reagent.title}
        meta={
          <>
            <span className="mono">{reagent.identifier}</span>
            <span>lot {row.lot}</span>
            <Status tone={row.status.tone}>{row.status.label}</Status>
          </>
        }
        actions={
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
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-6 py-5">
        {row.expiryNote ? (
          <Notice tone={row.status.tone === 'bad' ? 'bad' : 'warn'}>
            {row.expiryNote}
          </Notice>
        ) : null}
        <section aria-label="Lot" className="max-w-xl">
          <h2 className="mb-1.5 font-sans text-label font-semibold">Lot</h2>
          <DescriptionList
            labelWidth={96}
            items={[
              [
                'Supplier',
                row.catalogNo
                  ? `${row.supplier} · cat. ${row.catalogNo}`
                  : row.supplier,
              ],
              ['Stock', row.stock],
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
            <Link
              to="/records/$recordId"
              params={{ recordId: certificate.data.fileRecordId }}
              className="text-label hover:underline"
            >
              {certificate.data.displayName}
            </Link>
          ) : (
            <p className="text-label text-fg-muted">
              {row.certificate ?? 'No certificate is attached to this lot.'}
            </p>
          )}
        </section>
        <section aria-label="Ledger">
          <h2 className="mb-1.5 font-sans text-label font-semibold">Ledger</h2>
          {ledger.data && ledger.data.length > 0 ? (
            <table className="w-full max-w-4xl border-collapse text-label">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="py-1 pr-3 font-medium">When</th>
                  <th className="py-1 pr-3 font-medium">Movement</th>
                  <th className="py-1 pr-3 text-right font-medium">Change</th>
                  <th className="py-1 pr-3 text-right font-medium">Balance</th>
                  <th className="py-1 pr-3 font-medium">By</th>
                  <th className="py-1 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="py-1 pr-3">{dateTimeLabel(m.createdAt)}</td>
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
        {usage.data?.length ? (
          <section aria-label="Used in">
            <h2 className="mb-1.5 font-sans text-label font-semibold">
              Used in
            </h2>
            <ul className="flex flex-col gap-1">
              {usage.data.map((link) => (
                <li key={link.id} className="text-label">
                  <Link
                    to="/records/$recordId"
                    params={{
                      recordId: link.sourceRecordId ?? link.sourceIdentifier,
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
          </section>
        ) : null}
      </div>

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
