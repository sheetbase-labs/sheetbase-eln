/**
 * Liquid handler worklists: making a transfer file from a plate run, and
 * reading the robot's log back to complete it and record what was used.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  SendToRobotDialog,
  WorklistJobLine,
} from '#/components/instruments/robot-section'
import { RecordPickerDialog } from '#/components/record-picker/record-picker'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { FileDrop } from '#/components/ui/file-drop'
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
import { downloadTextFile } from '#/lib/download'
import { notebookDataClient } from '#/lib/notebook-data'
import { PLATE_FORMATS } from '#/lib/plate-map'
import type { PlateFormat } from '#/lib/plate-map'
import {
  cancelPlateWorklist,
  completePlateWorklist,
  createPlateWorklist,
  messageOf,
  plateRunKeys,
  plateRunReference,
  worklistReference,
} from '#/lib/plate-runs'
import type { PlateRunRow, PlateWorklistRow } from '#/lib/plate-runs'
import {
  WORKLIST_FILE_EXTENSION,
  WORKLIST_FORMATS,
  WORKLIST_MODES,
  buildWorklist,
  parseRunLog,
  reconcileRunLog,
  writeWorklist,
} from '#/lib/plate-worklist'
import type {
  DestinationWell,
  ReconciledTransfer,
  Transfer,
  WorklistFormat,
  WorklistMode,
} from '#/lib/plate-worklist'

const client = notebookDataClient

function positive(text: string): number | undefined {
  const n = Number(text)
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined
}

export function WorklistBuilderDialog({
  run,
  open,
  onOpenChange,
}: {
  run: PlateRunRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const reference = plateRunReference(run.number)
  const [name, setName] = useState('')
  const [format, setFormat] = useState<WorklistFormat>('csv')
  const [mode, setMode] = useState<WorklistMode>('stamp')
  const [sourcePlate, setSourcePlate] = useState('')
  const [sourceFormat, setSourceFormat] = useState<PlateFormat>(run.format)
  const [destPlate, setDestPlate] = useState('')
  const [defaultVolume, setDefaultVolume] = useState('10')
  const [wellVolume, setWellVolume] = useState('')
  const [minVolume, setMinVolume] = useState('')
  const [maxVolume, setMaxVolume] = useState('')
  const [experiment, setExperiment] = useState<{
    id: string
    name: string
  } | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(`${reference} ${run.name}`)
    setFormat('csv')
    setMode('stamp')
    setSourcePlate('SRC1')
    setSourceFormat(run.format)
    setDestPlate(reference)
    setDefaultVolume('10')
    setWellVolume('')
    setMinVolume('')
    setMaxVolume('')
    setExperiment(null)
  }, [open, reference, run.name, run.format])

  const destinations = useMemo<DestinationWell[]>(
    () =>
      run.wells
        .filter((w) => w.role !== 'empty' && w.role !== 'blank')
        .map((w) => ({
          wellCode: w.wellCode,
          sampleId: w.sampleId ?? null,
          label: w.sampleLabel ?? t(`plates.worklist.roles.${w.role}`),
          volumeUl: w.volumeUl ?? null,
        })),
    [run.wells],
  )
  const plan = useMemo(
    () =>
      buildWorklist(destinations, {
        mode,
        sourcePlate: sourcePlate.trim() || 'SRC1',
        sourceFormat,
        destFormat: run.format,
        destPlate: destPlate.trim() || reference,
        defaultVolumeUl: positive(defaultVolume),
        sourceWellVolumeUl: positive(wellVolume),
        minVolumeUl: positive(minVolume),
        maxVolumeUl: positive(maxVolume),
      }),
    [
      destinations,
      mode,
      sourcePlate,
      sourceFormat,
      run.format,
      destPlate,
      reference,
      defaultVolume,
      wellVolume,
      minVolume,
      maxVolume,
    ],
  )

  const save = useMutation({
    mutationFn: async () => {
      const worklist = await createPlateWorklist(client, {
        name,
        format,
        mode,
        sourcePlate: sourcePlate.trim() || 'SRC1',
        sourceFormat,
        destPlate: destPlate.trim() || reference,
        destFormat: run.format,
        transfers: plan.transfers,
        runId: run.id,
        recordId: experiment?.id ?? null,
        options: {
          defaultVolumeUl: positive(defaultVolume) ?? null,
          sourceWellVolumeUl: positive(wellVolume) ?? null,
        },
      })
      const file = writeWorklist(format, plan.transfers, {
        sourceFormat,
        destFormat: run.format,
        title: name,
      })
      const filename = `${worklistReference(worklist.number)}.${WORKLIST_FILE_EXTENSION[format]}`
      downloadTextFile(filename, file)
      return { worklist, filename }
    },
    onSuccess: ({ worklist, filename }) => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      toast.success(
        t('plates.worklist.created', {
          reference: worklistReference(worklist.number),
        }),
      )
      toast.message(t('plates.worklist.downloaded', { file: filename }))
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('plates.worklist.couldNotSave'))),
  })

  const blocking = plan.transfers.length === 0 || name.trim() === ''

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(720px,calc(100vw-32px))]">
          <DialogHeader title={t('plates.worklist.title')} />
          <DialogBody>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field
                label={t('plates.worklist.name')}
                className="md:col-span-2"
              >
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t('plates.worklist.format')}>
                <Select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as WorklistFormat)}
                >
                  {WORKLIST_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {t(`plates.worklist.formats.${f}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('plates.worklist.mode')}>
                <Select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as WorklistMode)}
                >
                  {WORKLIST_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`plates.worklist.modes.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('plates.worklist.sourcePlate')}>
                <Input
                  value={sourcePlate}
                  onChange={(e) => setSourcePlate(e.target.value)}
                />
              </Field>
              <Field label={t('plates.worklist.sourceFormat')}>
                <Select
                  value={sourceFormat}
                  onChange={(e) =>
                    setSourceFormat(e.target.value as PlateFormat)
                  }
                >
                  {PLATE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {t(`plates.formats.${f}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('plates.worklist.destPlate')}>
                <Input
                  value={destPlate}
                  onChange={(e) => setDestPlate(e.target.value)}
                />
              </Field>
              <Field label={t('plates.worklist.defaultVolume')}>
                <Input
                  inputMode="decimal"
                  value={defaultVolume}
                  onChange={(e) => setDefaultVolume(e.target.value)}
                />
              </Field>
              <Field label={t('plates.worklist.wellVolume')}>
                <Input
                  inputMode="decimal"
                  value={wellVolume}
                  onChange={(e) => setWellVolume(e.target.value)}
                />
              </Field>
              <Field label={t('plates.worklist.minVolume')}>
                <Input
                  inputMode="decimal"
                  value={minVolume}
                  onChange={(e) => setMinVolume(e.target.value)}
                />
              </Field>
              <Field label={t('plates.worklist.maxVolume')}>
                <Input
                  inputMode="decimal"
                  value={maxVolume}
                  onChange={(e) => setMaxVolume(e.target.value)}
                />
              </Field>
              <div className="flex flex-col gap-1 text-label">
                <span className="font-medium">
                  {t('plates.worklist.experiment')}
                </span>
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-fg-muted">
                    {experiment?.name ?? t('plates.worklist.noExperiment')}
                  </span>
                  <Button size="sm" onClick={() => setPicking(true)}>
                    {t('plates.worklists.complete.choose')}
                  </Button>
                </div>
              </div>
            </div>
            <div
              role="status"
              className="mt-3 rounded-md bg-muted px-3 py-2 text-label text-fg-muted"
            >
              {plan.transfers.length === 0
                ? t('plates.worklist.previewNone')
                : t('plates.worklist.preview', {
                    transfers: plan.transfers.length,
                    sources: plan.sources.length,
                  })}
              {plan.issues.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-warning-text">
                  {plan.issues.slice(0, 5).map((issue, i) => (
                    <li key={`${issue.code}-${issue.wellCode ?? i}`}>
                      {t(`plates.worklist.issues.${issue.code}`, {
                        well: issue.wellCode ?? '',
                        message: issue.message,
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="quiet" />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              disabled={blocking || save.isPending}
              onClick={() => save.mutate()}
            >
              {t('plates.worklist.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RecordPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title={t('plates.worklists.complete.choose')}
        allowed={['Experiment']}
        onPick={(items) =>
          setExperiment(
            items[0] ? { id: items[0].id, name: items[0].name } : null,
          )
        }
      />
    </>
  )
}

/** A worklist opened: its transfers, and completing or cancelling it. */
export function WorklistDialog({
  worklist,
  canWrite,
  onClose,
}: {
  worklist: PlateWorklistRow | null
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [unit, setUnit] = useState<'ul' | 'nl' | 'ml'>('ul')
  const [logText, setLogText] = useState<string | null>(null)
  const [withdraw, setWithdraw] = useState(true)
  const [experiment, setExperiment] = useState<{
    id: string
    name: string
  } | null>(null)
  const [picking, setPicking] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    setSending(false)
    setUnit('ul')
    setLogText(null)
    setWithdraw(true)
    setExperiment(null)
    setCompleting(false)
  }, [worklist?.id])

  const planned = useMemo<Transfer[]>(
    () =>
      (worklist?.transfers ?? []).map((tr) => ({
        sourcePlate: worklist?.source_plate ?? '',
        destPlate: worklist?.dest_plate ?? '',
        sourceWell: tr.sourceWell,
        destWell: tr.destWell,
        volumeUl: tr.volumeUl,
        label: tr.label,
        sampleId: tr.sampleId ?? null,
      })),
    [worklist],
  )

  const reconciled = useMemo<ReconciledTransfer[]>(() => {
    if (logText === null) {
      return planned.map((tr) => ({
        ...tr,
        status: 'done' as const,
        movedUl: tr.volumeUl,
      }))
    }
    return reconcileRunLog(
      planned,
      parseRunLog(logText, { volumeUnit: unit }).entries,
    )
  }, [planned, logText, unit])

  const counts = useMemo(() => {
    const c = { done: 0, short: 0, failed: 0, skipped: 0, missing: 0 }
    for (const r of reconciled) c[r.status] += 1
    return c
  }, [reconciled])

  const complete = useMutation({
    mutationFn: async () => {
      if (!worklist) throw new Error('')
      return completePlateWorklist(client, {
        worklistId: worklist.id,
        reconciled: reconciled.map((r) => ({
          sourceWell: r.sourceWell,
          destWell: r.destWell,
          volumeUl: r.volumeUl,
          movedUl: r.movedUl,
          status: r.status,
          label: r.label,
          sampleId: r.sampleId,
        })),
        purposeRecordId: experiment?.id ?? null,
        recordWithdrawals: withdraw,
      })
    },
    onSuccess: (done) => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['records'] })
      toast.success(
        t('plates.worklists.complete.completed', {
          reference: worklistReference(done.number),
        }),
      )
      const w = done.withdrawals
      if (w && w.withdrawn.length > 0)
        toast.message(
          t('plates.worklists.complete.withdrawn', {
            count: w.withdrawn.length,
          }),
        )
      if (w && w.skipped.length > 0)
        toast.warning(
          t('plates.worklists.complete.skipped', { count: w.skipped.length }),
        )
      onClose()
    },
    onError: (e: unknown) =>
      toast.error(
        messageOf(e, t('plates.worklists.complete.couldNotComplete')),
      ),
  })

  const cancel = useMutation({
    mutationFn: async () => {
      if (worklist) await cancelPlateWorklist(client, worklist.id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      if (worklist)
        toast.success(
          t('plates.worklists.cancelled', {
            reference: worklistReference(worklist.number),
          }),
        )
      onClose()
    },
    onError: (e: unknown) => toast.error(messageOf(e, '')),
  })

  if (!worklist) return null
  const reference = worklistReference(worklist.number)
  const isPlanned = worklist.status === 'planned'
  const needExperiment = withdraw && !experiment && !worklist.record_id
  const shown = isPlanned
    ? reconciled
    : ((worklist.reconciled as unknown as ReconciledTransfer[] | null) ??
      planned.map((p) => ({
        ...p,
        status: 'done' as const,
        movedUl: p.volumeUl,
      })))

  function download() {
    if (!worklist) return
    const file = writeWorklist(worklist.format, planned, {
      sourceFormat: worklist.source_format,
      destFormat: worklist.dest_format,
      title: worklist.name,
    })
    try {
      downloadTextFile(
        `${reference}.${WORKLIST_FILE_EXTENSION[worklist.format]}`,
        file,
      )
    } catch (e) {
      toast.error(messageOf(e, ''))
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="w-[min(780px,calc(100vw-32px))]">
          <DialogHeader
            title={
              completing
                ? t('plates.worklists.complete.title', { reference })
                : `${reference} · ${worklist.name}`
            }
          />
          <DialogBody>
            <div className="flex flex-col gap-3">
              {completing ? (
                <>
                  <p className="text-label text-fg-muted">
                    {t('plates.worklists.complete.intro')}
                  </p>
                  <FileDrop
                    label={t('plates.worklists.complete.log')}
                    hint={t('plates.worklists.complete.logHint')}
                    accept=".csv,.tsv,.txt,.log"
                    onFile={async (file) =>
                      setLogText(file ? await file.text() : null)
                    }
                  />
                  <Field label={t('plates.worklists.complete.unit')}>
                    <Select
                      value={unit}
                      onChange={(e) =>
                        setUnit(e.target.value as 'ul' | 'nl' | 'ml')
                      }
                    >
                      {(['ul', 'nl', 'ml'] as const).map((u) => (
                        <option key={u} value={u}>
                          {t(`plates.worklists.complete.units.${u}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <p role="status" className="text-label text-fg-muted">
                    {logText === null
                      ? t('plates.worklists.complete.noLog')
                      : t('plates.worklists.complete.summary', counts)}
                  </p>
                  <label className="flex items-start gap-2 text-label">
                    <Checkbox
                      checked={withdraw}
                      onCheckedChange={(v) => setWithdraw(v === true)}
                    />
                    <span className="flex flex-col">
                      {t('plates.worklists.complete.withdraw')}
                      <span className="text-fg-muted">
                        {t('plates.worklists.complete.withdrawHint')}
                      </span>
                    </span>
                  </label>
                  {withdraw && !worklist.record_id ? (
                    <div className="flex items-center gap-2 text-label">
                      <span className="font-medium">
                        {t('plates.worklists.complete.experiment')}
                      </span>
                      <span className="flex-1 truncate text-fg-muted">
                        {experiment?.name ?? ''}
                      </span>
                      <Button size="sm" onClick={() => setPicking(true)}>
                        {t('plates.worklists.complete.choose')}
                      </Button>
                    </div>
                  ) : null}
                  {needExperiment ? (
                    <p className="text-label text-danger-text">
                      {t('plates.worklists.complete.needExperiment')}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-label text-fg-muted">
                    {t(`plates.worklist.formats.${worklist.format}`)} ·{' '}
                    {worklist.source_plate} → {worklist.dest_plate}
                    {' · '}
                    <Status
                      tone={
                        worklist.status === 'complete'
                          ? 'ok'
                          : worklist.status === 'cancelled'
                            ? 'draft'
                            : 'progress'
                      }
                    >
                      {t(`plates.worklists.statuses.${worklist.status}`)}
                    </Status>
                  </p>
                  {isPlanned ? <WorklistJobLine worklistId={worklist.id} /> : null}
                  {worklist.withdrawals ? (
                    <div className="flex flex-col gap-1 text-label">
                      {worklist.withdrawals.withdrawn.length > 0 ? (
                        <span>
                          <b>{t('plates.worklists.result.withdrawn')}:</b>{' '}
                          {worklist.withdrawals.withdrawn
                            .map(
                              (w) => `${w.identifier} ${w.quantity} ${w.unit}`,
                            )
                            .join(', ')}
                        </span>
                      ) : null}
                      {worklist.withdrawals.skipped.length > 0 ? (
                        <span className="text-warning-text">
                          <b>{t('plates.worklists.result.skipped')}:</b>{' '}
                          {worklist.withdrawals.skipped
                            .map((s) =>
                              `${s.identifier ?? ''} ${t(`plates.worklists.result.reasons.${s.reason as 'not_found' | 'not_a_volume' | 'refused'}`)}`.trim(),
                            )
                            .join(', ')}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
              <TableBox className="max-h-[320px] overflow-auto">
                <Table aria-label={t('plates.worklists.transfers')}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t('plates.worklists.transferColumns.sourceWell')}
                      </TableHead>
                      <TableHead>
                        {t('plates.worklists.transferColumns.destWell')}
                      </TableHead>
                      <TableHead>
                        {t('plates.worklists.transferColumns.volume')}
                      </TableHead>
                      <TableHead>
                        {t('plates.worklists.transferColumns.sample')}
                      </TableHead>
                      {!isPlanned || completing ? (
                        <TableHead>
                          {t('plates.worklists.transferColumns.status')}
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody colSpan={5}>
                    {shown.slice(0, 500).map((r, i) => (
                      <TableRow key={`${r.sourceWell}-${r.destWell}-${i}`}>
                        <TableCell className="mono">{r.sourceWell}</TableCell>
                        <TableCell className="mono">{r.destWell}</TableCell>
                        <TableCell className="num">{r.volumeUl}</TableCell>
                        <TableCell className="truncate">{r.label}</TableCell>
                        {!isPlanned || completing ? (
                          <TableCell>
                            {t(`plates.worklists.transferStatus.${r.status}`)}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableBox>
            </div>
          </DialogBody>
          <DialogFooter>
            {completing ? (
              <>
                <Button variant="quiet" onClick={() => setCompleting(false)}>
                  {t('common.actions.back')}
                </Button>
                <span className="flex-1" />
                <Button
                  variant="primary"
                  disabled={complete.isPending || needExperiment}
                  onClick={() => complete.mutate()}
                >
                  {t('plates.worklists.complete.submit')}
                </Button>
              </>
            ) : (
              <>
                {canWrite && isPlanned ? (
                  <Button
                    variant="quiet"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate()}
                  >
                    {t('plates.worklists.cancel')}
                  </Button>
                ) : null}
                <span className="flex-1" />
                <Button onClick={download}>
                  {t('plates.worklist.download')}
                </Button>
                {canWrite && isPlanned ? (
                  <Button onClick={() => setSending(true)}>
                    {t('automation.robot.send.button')}
                  </Button>
                ) : null}
                {canWrite && isPlanned ? (
                  <Button variant="primary" onClick={() => setCompleting(true)}>
                    {t('plates.worklists.complete.submit')}
                  </Button>
                ) : (
                  <DialogClose render={<Button variant="quiet" />}>
                    {t('common.actions.close')}
                  </DialogClose>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RecordPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title={t('plates.worklists.complete.choose')}
        allowed={['Experiment']}
        onPick={(items) =>
          setExperiment(
            items[0] ? { id: items[0].id, name: items[0].name } : null,
          )
        }
      />
      {sending ? (
        <SendToRobotDialog
          worklistId={worklist.id}
          reference={reference}
          onClose={() => setSending(false)}
        />
      ) : null}
    </>
  )
}
