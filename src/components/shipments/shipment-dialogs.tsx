/**
 * Setting up a shipment and handling one: the manifest, sending it on its way,
 * receiving it line by line, or calling it off.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useRecordModelProjects } from '#/components/models/models-data'
import { RecordPickerDialog } from '#/components/record-picker/record-picker'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { DateField } from '#/components/ui/date-field'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  cancelShipment,
  createShipment,
  fetchShipmentItems,
  markShipmentInTransit,
  messageOf,
  receiveShipment,
  shipmentKeys,
  shipmentReference,
} from '#/lib/shipments'
import type {
  ManifestLine,
  ShipmentDirection,
  ShipmentRow,
} from '#/lib/shipments'

import { shipmentStatusLabel, shipmentTone } from './shipments-shared'

const client = notebookDataClient

let lineCounter = 0

/** The direction a chosen option names; anything else is outbound. */
const DIRECTIONS = ['outbound', 'inbound'] as const

function directionOf(optionValue: string): ShipmentDirection {
  return DIRECTIONS.find((direction) => direction === optionValue) ?? 'outbound'
}

function blankLine(): ManifestLine {
  lineCounter += 1

  return {
    key: `line-${lineCounter}`,
    record_id: null,
    identifier: null,
    title: '',
    quantity: '',
    unit: '',
    note: '',
  }
}

export function NewShipmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const projects = useRecordModelProjects().data ?? []
  const [direction, setDirection] = useState<ShipmentDirection>('outbound')
  const [counterparty, setCounterparty] = useState('')
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [expectedOn, setExpectedOn] = useState<string | undefined>()
  const [projectId, setProjectId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<ManifestLine[]>([])
  const [picking, setPicking] = useState(false)
  const [interacted, setInteracted] = useState(false)

  useEffect(() => {
    if (!open) return
    setDirection('outbound')
    setCounterparty('')
    setCarrier('')
    setTracking('')
    setExpectedOn(undefined)
    setProjectId('')
    setNotes('')
    setLines([])
    setInteracted(false)
  }, [open])

  const counterpartyError = counterparty.trim()
    ? null
    : t('shipments.form.counterpartyRequired')

  const save = useMutation({
    mutationFn: async (send: boolean) => {
      const created = await createShipment(client, {
        direction,
        counterparty: counterparty.trim(),
        carrier,
        trackingReference: tracking,
        expectedOn: expectedOn ?? '',
        notes,
        projectId: projectId || null,
        lines,
      })

      if (send) {
        await markShipmentInTransit(client, {
          shipmentId: created.id,
          shippedOn: '',
          carrier: '',
          trackingReference: '',
          expectedOn: '',
        })
      }

      return created
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['work-items'] })
      toast.success(
        t('shipments.form.created', {
          reference: shipmentReference(created.number),
        }),
      )
      onOpenChange(false)
    },
    onError: (e) => toast.error(messageOf(e, t('shipments.form.couldNotSave'))),
  })

  function submit(send: boolean) {
    setInteracted(true)

    if (counterpartyError || save.isPending) return
    save.mutate(send)
  }

  function update(key: string, patch: Partial<ManifestLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(760px,calc(100vw-32px))]">
          <DialogHeader title={t('shipments.form.title')} />
          <DialogBody>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={t('shipments.form.direction')}>
                  <Select
                    value={direction}
                    onChange={(e) => setDirection(directionOf(e.target.value))}
                  >
                    <option value="outbound">
                      {t('shipments.directions.outbound')}
                    </option>
                    <option value="inbound">
                      {t('shipments.directions.inbound')}
                    </option>
                  </Select>
                </Field>
                <Field
                  label={t('shipments.form.counterparty')}
                  hint={t('shipments.form.counterpartyHint')}
                  error={interacted ? counterpartyError : null}
                  required
                >
                  <Input
                    value={counterparty}
                    maxLength={200}
                    onChange={(e) => {
                      setCounterparty(e.target.value)
                      setInteracted(true)
                    }}
                  />
                </Field>
                <Field label={t('shipments.form.carrier')}>
                  <Input
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                  />
                </Field>
                <Field label={t('shipments.form.tracking')}>
                  <Input
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                  />
                </Field>
                <div className="flex flex-col gap-1 text-label">
                  <span className="font-medium text-fg">
                    {t('shipments.form.expected')}
                  </span>
                  <DateField
                    value={expectedOn}
                    onChange={setExpectedOn}
                    label={t('shipments.form.expected')}
                    placeholder={t('shipments.form.expected')}
                  />
                </div>
                {projects.length > 0 ? (
                  <Field label={t('shipments.form.project')}>
                    <Select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      <option value="">{t('shipments.form.noProject')}</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
              <Field label={t('shipments.form.notes')}>
                <Input
                  value={notes}
                  maxLength={2000}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-label font-medium text-fg">
                    {t('shipments.form.manifest')}
                  </span>
                  <Button size="sm" onClick={() => setPicking(true)}>
                    {t('shipments.form.addRecords')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setLines((c) => [...c, blankLine()])}
                  >
                    {t('shipments.form.addLine')}
                  </Button>
                </div>
                <TableBox>
                  <Table aria-label={t('shipments.form.manifest')}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('shipments.form.lineName')}</TableHead>
                        <TableHead className="w-24">
                          {t('shipments.form.lineQuantity')}
                        </TableHead>
                        <TableHead className="w-24">
                          {t('shipments.form.lineUnit')}
                        </TableHead>
                        <TableHead>{t('shipments.form.lineNote')}</TableHead>
                        <TableHead className="w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody
                      empty={t('shipments.form.emptyManifest')}
                      colSpan={5}
                    >
                      {lines.map((line) => (
                        <TableRow key={line.key}>
                          <TableCell>
                            {line.record_id ? (
                              <span className="flex items-baseline gap-2">
                                <span className="mono text-fg-muted">
                                  {line.identifier}
                                </span>
                                <span className="truncate">{line.title}</span>
                              </span>
                            ) : (
                              <Input
                                aria-label={t('shipments.form.lineName')}
                                value={line.title}
                                onChange={(e) =>
                                  update(line.key, { title: e.target.value })
                                }
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <Input
                              aria-label={t('shipments.form.lineQuantity')}
                              inputMode="decimal"
                              value={line.quantity}
                              onChange={(e) =>
                                update(line.key, { quantity: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              aria-label={t('shipments.form.lineUnit')}
                              value={line.unit}
                              onChange={(e) =>
                                update(line.key, { unit: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              aria-label={t('shipments.form.lineNote')}
                              value={line.note}
                              onChange={(e) =>
                                update(line.key, { note: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="quiet"
                              onClick={() =>
                                setLines((c) =>
                                  c.filter((l) => l.key !== line.key),
                                )
                              }
                            >
                              {t('shipments.form.remove')}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="quiet" />}>
              {t('shipments.form.cancel')}
            </DialogClose>
            <Button disabled={save.isPending} onClick={() => submit(false)}>
              {save.isPending
                ? t('shipments.form.saving')
                : t('shipments.form.save')}
            </Button>
            <Button
              variant="primary"
              disabled={save.isPending || lines.length === 0}
              onClick={() => submit(true)}
            >
              {direction === 'outbound'
                ? t('shipments.form.saveAndSend')
                : t('shipments.form.saveAndExpect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RecordPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title={t('shipments.form.pickerTitle')}
        allowed={['Sample', 'Material']}
        multiple
        exclude={lines.flatMap((l) => (l.record_id ? [l.record_id] : []))}
        confirmLabel={(count) => t('shipments.form.pickerConfirm', { count })}
        onPick={(items) =>
          setLines((current) => [
            ...current,
            ...items.map((item) => ({
              ...blankLine(),
              record_id: item.id,
              identifier: item.identifier,
              title: item.name,
            })),
          ])
        }
      />
    </>
  )
}

export function ShipmentDialog({
  shipment,
  canWrite,
  onClose,
}: {
  shipment: ShipmentRow | null
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const items = useQuery({
    queryKey: shipmentKeys.items(shipment?.id ?? ''),
    queryFn: () => fetchShipmentItems(client, shipment?.id ?? ''),
    enabled: shipment !== null,
    staleTime: 5_000,
  })

  const [receiving, setReceiving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [arrived, setArrived] = useState<Record<string, boolean>>({})
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({})
  const [condition, setCondition] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    setReceiving(false)
    setCancelling(false)
    setArrived({})
    setLineNotes({})
    setCondition('')
    setReason('')
  }, [shipment?.id])

  function done() {
    void queryClient.invalidateQueries({ queryKey: shipmentKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['work-items'] })
    toast.success(t('shipments.detail.saved'))
    onClose()
  }

  const failed = (e: Error) =>
    toast.error(messageOf(e, t('shipments.detail.couldNotSave')))

  const send = useMutation({
    mutationFn: () =>
      markShipmentInTransit(client, {
        shipmentId: shipment?.id ?? '',
        shippedOn: '',
        carrier: '',
        trackingReference: '',
        expectedOn: '',
      }),
    onSuccess: done,
    onError: failed,
  })

  const receive = useMutation({
    mutationFn: () =>
      receiveShipment(client, {
        shipmentId: shipment?.id ?? '',
        results: (items.data ?? []).map((item) => ({
          item_id: item.id,
          received: arrived[item.id] ?? true,
          note: (lineNotes[item.id] ?? '').trim() || null,
        })),
        conditionNote: condition,
      }),
    onSuccess: done,
    onError: failed,
  })

  const cancel = useMutation({
    mutationFn: () => cancelShipment(client, shipment?.id ?? '', reason),
    onSuccess: done,
    onError: failed,
  })

  const s = shipment

  const facts: Array<[string, string]> = s
    ? [
        [t('shipments.detail.with'), s.counterparty],
        [t('shipments.detail.carrier'), s.carrier ?? ''],
        [t('shipments.detail.tracking'), s.tracking_reference ?? ''],
        [
          t('shipments.detail.shipped'),
          s.shipped_on ? formatDate(s.shipped_on) : '',
        ],
        [
          t('shipments.detail.expected'),
          s.expected_on ? formatDate(s.expected_on) : '',
        ],
        [
          s.direction === 'outbound'
            ? t('shipments.detail.delivered')
            : t('shipments.detail.receivedOn'),
          s.received_at ? formatDate(s.received_at, { time: true }) : '',
        ],
        [t('shipments.detail.condition'), s.condition_note ?? ''],
        [t('shipments.detail.notes'), s.notes ?? ''],
        [t('shipments.detail.cancelReason'), s.cancel_reason ?? ''],
      ].filter((row): row is [string, string] => row[1] !== '')
    : []

  return (
    <Dialog open={s !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader
          title={t('shipments.detail.title', {
            reference: s ? shipmentReference(s.number) : '',
          })}
        />
        <DialogBody>
          {s ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Status tone={shipmentTone(s.status)}>
                  {shipmentStatusLabel(s)}
                </Status>
                <span className="text-label text-fg-muted">
                  {t(`shipments.directions.${s.direction}`)}
                </span>
              </div>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
                {facts.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-fg-muted">{label}</dt>
                    <dd className="m-0">{value}</dd>
                  </div>
                ))}
              </dl>
              <TableBox>
                <Table aria-label={t('shipments.detail.manifest')}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t('shipments.detail.columns.item')}
                      </TableHead>
                      <TableHead>
                        {t('shipments.detail.columns.kind')}
                      </TableHead>
                      <TableHead>
                        {t('shipments.detail.columns.amount')}
                      </TableHead>
                      <TableHead>
                        {t('shipments.detail.columns.note')}
                      </TableHead>
                      <TableHead>
                        {t('shipments.detail.columns.arrived')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody
                    loading={items.isPending}
                    empty={t('shipments.form.emptyManifest')}
                    colSpan={5}
                  >
                    {(items.data ?? []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className="flex items-baseline gap-2">
                            {item.identifier ? (
                              <span className="mono text-fg-muted">
                                {item.identifier}
                              </span>
                            ) : null}
                            <span className="truncate">{item.title}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-fg-muted">
                          {item.kind ?? ''}
                        </TableCell>
                        <TableCell>
                          {item.quantity != null
                            ? `${Number(item.quantity)} ${item.unit ?? ''}`.trim()
                            : ''}
                        </TableCell>
                        <TableCell className="text-fg-muted">
                          {item.note ?? ''}
                        </TableCell>
                        <TableCell>
                          {receiving ? (
                            <span className="flex items-center gap-2">
                              <Checkbox
                                aria-label={t('shipments.detail.arrived')}
                                checked={arrived[item.id] ?? true}
                                onCheckedChange={(checked) =>
                                  setArrived((c) => ({
                                    ...c,
                                    [item.id]: checked === true,
                                  }))
                                }
                              />
                              <Input
                                aria-label={t('shipments.detail.columns.note')}
                                value={lineNotes[item.id] ?? ''}
                                onChange={(e) =>
                                  setLineNotes((c) => ({
                                    ...c,
                                    [item.id]: e.target.value,
                                  }))
                                }
                              />
                            </span>
                          ) : item.received === null ? (
                            ''
                          ) : item.received ? (
                            <Status tone="ok">
                              {t('shipments.detail.arrived')}
                            </Status>
                          ) : (
                            <Status tone="bad">
                              {item.received_note
                                ? `${t('shipments.detail.missing')}: ${item.received_note}`
                                : t('shipments.detail.missing')}
                            </Status>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableBox>
              {receiving ? (
                <Field
                  label={t('shipments.detail.conditionLabel')}
                  hint={t('shipments.detail.conditionHint')}
                >
                  <Input
                    value={condition}
                    maxLength={2000}
                    onChange={(e) => setCondition(e.target.value)}
                  />
                </Field>
              ) : null}
              {cancelling ? (
                <Field label={t('shipments.detail.cancelWhy')}>
                  <Input
                    value={reason}
                    maxLength={2000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              ) : null}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {s &&
          canWrite &&
          (s.status === 'draft' || s.status === 'in_transit') ? (
            cancelling ? (
              <>
                <Button variant="quiet" onClick={() => setCancelling(false)}>
                  {t('shipments.detail.keep')}
                </Button>
                <Button
                  variant="danger"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  {t('shipments.detail.confirmCancel')}
                </Button>
              </>
            ) : receiving ? (
              <>
                <Button variant="quiet" onClick={() => setReceiving(false)}>
                  {t('shipments.form.cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={receive.isPending || items.isPending}
                  onClick={() => receive.mutate()}
                >
                  {t('shipments.detail.confirmReceive')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="quiet" onClick={() => setCancelling(true)}>
                  {t('shipments.detail.cancelShipment')}
                </Button>
                <span className="flex-1" />
                <DialogClose render={<Button variant="quiet" />}>
                  {t('shipments.detail.close')}
                </DialogClose>
                {s.status === 'draft' ? (
                  <Button
                    variant="primary"
                    disabled={send.isPending}
                    onClick={() => send.mutate()}
                  >
                    {s.direction === 'outbound'
                      ? t('shipments.detail.markInTransit')
                      : t('shipments.detail.markOnItsWay')}
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => setReceiving(true)}>
                    {s.direction === 'outbound'
                      ? t('shipments.detail.deliver')
                      : t('shipments.detail.receive')}
                  </Button>
                )}
              </>
            )
          ) : (
            <DialogClose render={<Button variant="quiet" />}>
              {t('shipments.detail.close')}
            </DialogClose>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
